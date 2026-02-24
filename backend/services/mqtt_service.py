import json
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

import paho.mqtt.client as mqtt
from sqlalchemy import delete, func

from extensions import db, socketio
from models import Blacklist, Device, DeviceNetworkProfile, DeviceToken, Log, SystemSettings, User


class MQTTService:
    """Background MQTT client that stores incoming logs and pushes them via Socket.IO."""

    def __init__(self) -> None:
        self.client: Optional[mqtt.Client] = None
        self.app = None
        self.topics: list[str] = []
        self.fallback_topics: set[str] = set()
        self.discovery_topic = "esp/Entrance"
        self.discovery_interval = 0
        self.auto_discovery_enabled = False
        self.settings_poll_interval = 0
        self.device_prune_hours = 24
        self.device_prune_interval = 3600
        self.allow_reregister = True
        self.reregister_once: set[str] = set()
        self.pending_registrations: dict[str, dict] = {}
        self.registration_lock = threading.Lock()
        self.discovery_thread_started = False
        self.settings_poll_thread_started = False
        self.device_cleanup_thread_started = False
        self.latest_settings: dict[int, dict] = {}
        self.pending_blocks: dict[int, set[str]] = {}
        self.session_codes: dict[str, str] = {}
        self.last_whitelist_sync: dict[int, float] = {}
        self.pending_settings_requests: dict[str, list[int]] = {}
        self.pending_settings_lock = threading.Lock()

    def init_app(self, app) -> None:
        self.app = app
        broker = app.config.get("MQTT_BROKER_URL")
        if not broker:
            app.logger.warning("MQTT broker URL missing; skipping MQTT startup")
            return

        self.client = mqtt.Client()
        username = app.config.get("MQTT_USERNAME")
        password = app.config.get("MQTT_PASSWORD")
        if username:
            self.client.username_pw_set(username, password)

        if app.config.get("MQTT_TLS_ENABLED"):
            ca = app.config.get("MQTT_TLS_CA_CERTS")
            self.client.tls_set(ca_certs=ca)
            self.client.tls_insecure_set(bool(app.config.get("MQTT_TLS_INSECURE")))

        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        self.discovery_interval = int(app.config.get("MQTT_DISCOVERY_INTERVAL", 0) or 0)
        self.settings_poll_interval = int(app.config.get("MQTT_SETTINGS_POLL_INTERVAL", 0) or 0)
        self.device_prune_hours = int(app.config.get("DEVICE_PRUNE_HOURS", 24) or 24)
        self.device_prune_interval = int(app.config.get("DEVICE_PRUNE_INTERVAL", 3600) or 3600)
        self.allow_reregister = bool(app.config.get("MQTT_ALLOW_REREGISTER", True))
        self.auto_discovery_enabled = bool(app.config.get("MQTT_AUTO_DISCOVERY", False))
        self.topics = self._resolve_topics()
        self.fallback_topics = {
            topic.lower()
            for topic in self.topics
            if topic.lower() not in {"esp/alert", "esp/setting/now", "esp/alive"}
        }

        def _runner():
            try:
                self.client.connect(
                    app.config.get("MQTT_BROKER_URL"),
                    int(app.config.get("MQTT_BROKER_PORT", 1883)),
                    keepalive=60,
                )
                self.client.loop_forever()
            except Exception as exc:  # noqa: BLE001
                app.logger.exception("MQTT connection error: %s", exc)

        threading.Thread(target=_runner, daemon=True).start()
        self._start_discovery_loop()
        self._start_settings_poll()
        self._start_device_cleanup()

    def _resolve_topics(self) -> list[str]:
        raw_topics = self.app.config.get("MQTT_TOPICS") if self.app else None
        topics = self._normalize_topics(raw_topics)
        if not topics:
            mqtt_topic = self.app.config.get("MQTT_TOPIC") if self.app else None
            if mqtt_topic and mqtt_topic != "tinyids/logs":
                topics = self._normalize_topics(mqtt_topic)
        if not topics:
            topics = [
                "esp/alert",
                "esp/setting/now",
                "esp/setting/control",
                "esp/alive",
                "esp/entrance",
                "esp/esp/entrance",
            ]
        normalized = {topic.lower() for topic in topics if topic}
        if any(topic.startswith("esp/") for topic in normalized):
            if "esp/#" not in normalized:
                topics.append("esp/#")
        if normalized and normalized.issubset({"esp/alert", "esp/setting/now", "esp/alive"}):
            return ["esp/#"]
        return topics

    def _normalize_topics(self, value) -> list[str]:
        if not value:
            return []
        if isinstance(value, str):
            return [topic.strip() for topic in value.split(",") if topic.strip()]
        if isinstance(value, (list, tuple, set)):
            return [str(topic).strip() for topic in value if str(topic).strip()]
        return []

    def _on_connect(self, client, userdata, flags, reason_code):  # noqa: D401
        if reason_code == 0:
            for topic in self.topics:
                client.subscribe(topic)
            self.app.logger.info("Connected to MQTT. Listening on %s", ", ".join(self.topics))
        else:
            self.app.logger.error("MQTT connection failed: code=%s", reason_code)

    def _on_message(self, client, userdata, msg):
        if not self.app:
            return
        topic = (msg.topic or "").strip()
        topic_key = topic.lower()
        raw_payload = msg.payload.decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw_payload)
        except json.JSONDecodeError:
            if topic_key == "esp/alive/check":
                return
            self.app.logger.warning("Invalid MQTT payload on %s: %s", topic, raw_payload)
            return
        if not isinstance(payload, dict):
            payload = {"message": payload}

        with self.app.app_context():
            if topic_key in {"esp/entrance", "esp/esp/entrance"}:
                if self._handle_registration_reply(payload, topic):
                    return
            if topic_key == "esp/alert":
                self._handle_alert(payload, topic)
            elif topic_key in {"esp/setting/now", "esp/setting/control"}:
                self._handle_settings(payload, topic)
            elif topic_key == "esp/alive":
                self._handle_alive(payload)
            elif topic_key in self.fallback_topics:
                self._handle_generic_log(payload, topic)

    def _handle_alert(self, payload: dict, topic: str) -> None:
        device = self._resolve_device(payload)
        if not device:
            return
        self._touch_device(device, payload, mark_active=True)
        enriched = self._enrich_payload(payload, topic, default_type="System Alert")
        if "description" not in enriched and "alert_msg" in enriched:
            enriched["description"] = enriched.get("alert_msg")
        severity = payload.get("severity") or payload.get("level") or payload.get("priority") or "high"
        event_time = self._parse_timestamp(payload)
        source_ip = self._derive_ip(payload, "source")
        log = Log(
            user_id=device.user_id,
            device=device,
            payload=enriched,
            severity=severity,
            source_ip=source_ip,
            destination_ip=self._derive_ip(payload, "destination"),
        )
        if source_ip and self._auto_block_allowed(device.user_id):
            self._auto_block_ip(device.user_id, source_ip, enriched)
            self._queue_block_for_device(device, source_ip)
        if event_time:
            log.created_at = event_time
        db.session.add(log)
        db.session.commit()
        self._emit_log(log, device)

    def _handle_settings(self, payload: dict, topic: str) -> None:
        device = self._resolve_device(payload)
        if not device:
            token_value = self._coerce_str(payload.get("token"))
            if token_value:
                device = self._pop_pending_settings_device(token_value)
        if not device:
            return
        token_value = self._coerce_str(payload.get("token"))
        if token_value:
            self._clear_pending_settings_request(token_value, device.id)
        self._touch_device(device, payload, mark_active=True)
        enriched = self._enrich_payload(payload, topic, default_type="ESP Settings")
        received_at = datetime.utcnow().isoformat() + "Z"
        enriched.setdefault("_received_at", received_at)
        enriched.setdefault("received_at", received_at)
        enriched.setdefault("description", "Current configuration snapshot reported by ESP.")
        self.latest_settings[device.id] = dict(enriched)
        # Apply any pending block IPs once we have a fresh settings payload.
        pending = self.pending_blocks.get(device.id)
        if pending:
            self._apply_blocklist_update(device, pending, enriched)
            self.pending_blocks.pop(device.id, None)
        try:
            self._sync_mqtt_whitelist_for_user(device.user_id)
        except Exception as exc:  # noqa: BLE001
            if self.app:
                self.app.logger.warning("Failed to sync MQTT whitelist: %s", exc)
        log = Log(
            user_id=device.user_id,
            device=device,
            payload=enriched,
            severity=payload.get("severity") or "info",
            source_ip=self._derive_ip(payload, "source"),
            destination_ip=self._derive_ip(payload, "destination"),
        )
        db.session.add(log)
        db.session.commit()
        self._emit_log(log, device)

    def _handle_alive(self, payload: dict) -> None:
        device = self._resolve_device(payload)
        if not device:
            return
        alert_raw = self._coerce_str(payload.get("alert_mode") or payload.get("alertMode"))
        status_raw = self._coerce_str(payload.get("status") or payload.get("state"))
        if not alert_raw and status_raw and status_raw.lower() in {"on", "off", "enabled", "disabled", "true", "false"}:
            alert_raw = status_raw
        if alert_raw:
            normalized = alert_raw.lower()
            device.is_active = normalized in {"on", "enabled", "true", "1"}
        self._touch_device(device, payload, mark_active=None)
        db.session.commit()
        socketio.emit("device:updated", {"device_id": device.id})

    def _handle_generic_log(self, payload: dict, topic: str) -> None:
        device = self._resolve_device(payload)
        if not device:
            return
        self._touch_device(device, payload, mark_active=True)
        enriched = self._enrich_payload(payload, topic)
        log = Log(
            user_id=device.user_id,
            device=device,
            payload=enriched,
            severity=payload.get("severity", "info"),
            source_ip=self._derive_ip(payload, "source"),
            destination_ip=self._derive_ip(payload, "destination"),
        )
        db.session.add(log)
        db.session.commit()
        self._emit_log(log, device)

    def publish_discover(self, topic: str | None = None) -> bool:
        if not self.client:
            return False
        payload = {"cmd": "DISCOVER"}
        target_topic = topic or self.discovery_topic
        self.client.publish(target_topic, json.dumps(payload), qos=0, retain=False)
        return True

    def request_registration(self, mac_address: str, token: str, topic: str | None = None) -> bool:
        if not self.client:
            return False
        mac_value = self._coerce_str(mac_address)
        token_value = self._coerce_str(token)
        if not mac_value or not token_value:
            return False
        now = time.time()
        with self.registration_lock:
            self._prune_pending_registrations()
            self.pending_registrations[mac_value.lower()] = {
                "token": token_value.lower(),
                "ts": now,
            }
        return self.publish_discover(topic=topic)

    def _handle_registration_reply(self, payload: dict, topic: str) -> bool:
        mac_value = self._coerce_str(
            payload.get("mac")
            or payload.get("mac_address")
            or payload.get("macAddress")
        )
        token_value = self._coerce_str(payload.get("token"))
        if not mac_value or not token_value:
            return False
        key = mac_value.lower()
        with self.registration_lock:
            entry = self.pending_registrations.get(key)
            if not entry:
                return False
            if entry.get("token") != token_value.lower():
                return False
            self.pending_registrations.pop(key, None)

        device = self._register_device_from_registration(mac_value, token_value)
        if device and self.client:
            session_code = self._generate_session_code()
            self._store_session_code(device, session_code)
            confirm_message = f"Confirm-{session_code}-{token_value}"
            self.client.publish(self.discovery_topic, confirm_message, qos=0, retain=False)
            if self.app:
                self.app.logger.info("Registration confirmed for %s with code %s", mac_value, session_code)
            socketio.emit(
                "device:registered",
                {"device_id": device.id, "esp_id": device.esp_id},
            )
        return True

    def _register_device_from_registration(self, mac_address: str, token: str) -> Device | None:
        owner = User.query.first()
        if not owner:
            if self.app:
                self.app.logger.warning("No user found; skipping registration for %s", mac_address)
            return None
        mac_value = mac_address.strip()
        device = Device.query.filter_by(esp_id=mac_value).first()
        if not device:
            device = (
                Device.query.filter(Device.user_id == owner.id)
                .filter(func.lower(Device.mac_address) == mac_value.lower())
                .first()
            )
        if not device:
            device = Device(
                user_id=owner.id,
                name="ESP32",
                esp_id=mac_value,
                mac_address=mac_value,
                is_active=True,
            )
            db.session.add(device)
            db.session.flush()
        else:
            device.is_active = True
            device.mac_address = mac_value
            if device.esp_id != mac_value:
                device.esp_id = mac_value

        if device.token:
            device.token.token = token
        else:
            db.session.add(DeviceToken(device_id=device.id, token=token))

        profile = device.network_profile
        if not profile:
            profile = DeviceNetworkProfile(device_id=device.id, user_id=owner.id)
            db.session.add(profile)
            device.network_profile = profile
        profile.last_seen = datetime.utcnow()
        db.session.commit()
        return device

    def request_reregister(self, device_id: str) -> None:
        self.reregister_once.add(device_id)

    def _generate_session_code(self) -> str:
        return f"{secrets.randbelow(9000) + 1000:04d}"

    def _prune_pending_registrations(self, ttl_sec: int = 300) -> None:
        now = time.time()
        stale = [
            key
            for key, entry in self.pending_registrations.items()
            if now - float(entry.get("ts", 0)) > ttl_sec
        ]
        for key in stale:
            self.pending_registrations.pop(key, None)

    def _start_discovery_loop(self) -> None:
        if (
            self.discovery_thread_started
            or self.discovery_interval <= 0
            or not self.auto_discovery_enabled
        ):
            return
        self.discovery_thread_started = True

        def _loop():
            while True:
                try:
                    if self.client and self.client.is_connected():
                        self.publish_discover()
                except Exception as exc:  # noqa: BLE001
                    if self.app:
                        self.app.logger.exception("Discovery loop error: %s", exc)
                time.sleep(self.discovery_interval)

        threading.Thread(target=_loop, daemon=True).start()

    def _start_settings_poll(self) -> None:
        if self.settings_poll_thread_started or self.settings_poll_interval <= 0:
            return
        self.settings_poll_thread_started = True

        def _loop():
            while True:
                try:
                    if self.client and self.client.is_connected():
                        with self.app.app_context():
                            devices = (
                                Device.query.join(DeviceToken, DeviceToken.device_id == Device.id).all()
                            )
                            blocked_by_user = {}
                            for device in devices:
                                token_value = device.token.token if device.token else None
                                if not token_value:
                                    continue
                                user_id = device.user_id
                                if user_id not in blocked_by_user:
                                    blocked_by_user[user_id] = self._get_blacklist_ips(user_id)
                                # Request latest settings (same as Rule Management)
                                control_topic = self._control_topic_for_device(device)
                                self._register_settings_request(device)
                                self.client.publish(
                                    control_topic,
                                    f"showsetting-{token_value}",
                                    qos=0,
                                    retain=False,
                                )
                                if self.app:
                                    self.app.logger.info("Settings poll: requested settings for %s", token_value)
                                # Merge DB blacklist into device settings if missing
                                self._sync_blacklist_to_device(device, blocked_by_user[user_id])
                except Exception as exc:  # noqa: BLE001
                    if self.app:
                        self.app.logger.exception("Settings poll error: %s", exc)
                time.sleep(self.settings_poll_interval)

        threading.Thread(target=_loop, daemon=True).start()

    def _start_device_cleanup(self) -> None:
        if self.device_cleanup_thread_started or self.device_prune_hours <= 0:
            return
        self.device_cleanup_thread_started = True

        def _loop():
            while True:
                try:
                    with self.app.app_context():
                        cutoff = datetime.utcnow() - timedelta(hours=self.device_prune_hours)
                        stale_ids = [
                            row[0]
                            for row in DeviceNetworkProfile.query.with_entities(
                                DeviceNetworkProfile.device_id
                            )
                            .filter(DeviceNetworkProfile.last_seen.isnot(None))
                            .filter(DeviceNetworkProfile.last_seen < cutoff)
                            .all()
                        ]
                        if stale_ids:
                            for device_id in stale_ids:
                                db.session.execute(delete(Log).where(Log.device_id == device_id))
                                db.session.execute(
                                    delete(DeviceToken).where(DeviceToken.device_id == device_id)
                                )
                                db.session.execute(
                                    delete(DeviceNetworkProfile).where(
                                        DeviceNetworkProfile.device_id == device_id
                                    )
                                )
                                db.session.execute(delete(Device).where(Device.id == device_id))
                            db.session.commit()
                except Exception as exc:  # noqa: BLE001
                    if self.app:
                        self.app.logger.exception("Device cleanup error: %s", exc)
                time.sleep(self.device_prune_interval)

        threading.Thread(target=_loop, daemon=True).start()

    def _get_blacklist_ips(self, user_id: int) -> list[str]:
        rows = Blacklist.query.filter(Blacklist.user_id == user_id).all()
        ips = []
        for row in rows:
            value = self._coerce_str(row.ip_address)
            if not value:
                continue
            # Keep only IPv4-like strings to avoid junk entries.
            if not re.match(r"^(?:\\d{1,3}\\.){3}\\d{1,3}$", value):
                continue
            ips.append(value)
        return ips

    def _sync_blacklist_to_device(self, device: Device, blacklist_ips: list[str]) -> None:
        if not self.client or not device or not blacklist_ips:
            return
        token_value = device.token.token if device.token else None
        if not token_value:
            return
        cached = self.latest_settings.get(device.id, {})
        blocked = cached.get("blocked_ips") or cached.get("BLOCKED_IPS") or []
        if isinstance(blocked, str):
            blocked_list = [item.strip() for item in blocked.split(",") if item.strip()]
        elif isinstance(blocked, list):
            blocked_list = [str(item).strip() for item in blocked if str(item).strip()]
        else:
            blocked_list = []
        merged = list(dict.fromkeys(blocked_list + blacklist_ips))
        if merged == blocked_list:
            return
        payload = dict(cached) if isinstance(cached, dict) else {}
        payload["token"] = token_value
        payload["blocked_ips"] = merged
        self.latest_settings[device.id] = dict(payload)
        topic = self._control_topic_for_device(device)
        try:
            self.client.publish(topic, json.dumps(payload), qos=0, retain=False)
            if self.app:
                self.app.logger.info(
                    "Settings poll: synced %s blocked_ips to %s", len(merged), token_value
                )
        except Exception as exc:  # noqa: BLE001
            if self.app:
                self.app.logger.warning("Failed to sync blacklist to %s: %s", token_value, exc)

    def _emit_log(self, log: Log, device: Device) -> None:
        log_data = {
            "id": log.id,
            "device": device.name,
            "severity": log.severity,
            "payload": log.payload,
            "created_at": log.created_at.isoformat(),
        }
        socketio.emit("log:new", log_data)

    def _resolve_device(self, payload: dict) -> Device | None:
        owner = User.query.first()
        owner_id = owner.id if owner else 1

        mac_value = self._coerce_str(
            payload.get("mac_address") or payload.get("mac") or payload.get("macAddress")
        )

        def _mac_matches(device: Device | None) -> bool:
            if not device:
                return False
            if not mac_value or not device.mac_address:
                return True
            return device.mac_address.lower() == mac_value.lower()

        if mac_value:
            device = (
                Device.query.filter(Device.user_id == owner_id)
                .filter(func.lower(Device.mac_address) == mac_value.lower())
                .first()
            )
            if device:
                return device

        token_value = self._coerce_str(payload.get("token"))
        if token_value and not mac_value:
            token_rows = DeviceToken.query.filter_by(token=token_value).all()
            if len(token_rows) == 1:
                return token_rows[0].device

        esp_id = self._coerce_str(payload.get("esp_id") or payload.get("espId") or payload.get("espID"))
        if esp_id:
            device = Device.query.filter_by(esp_id=esp_id).first()
            if device and _mac_matches(device):
                return device

        device_id_value = payload.get("device_id") or payload.get("deviceId")
        device_id = self._coerce_int(device_id_value)
        if device_id is not None:
            device = Device.query.filter_by(id=device_id, user_id=owner_id).first()
            if device and _mac_matches(device):
                return device

        if device_id_value is not None and not esp_id:
            esp_candidate = self._coerce_str(device_id_value)
            if esp_candidate:
                device = Device.query.filter_by(esp_id=esp_candidate).first()
                if device and _mac_matches(device):
                    return device

        ip_address = self._coerce_str(payload.get("ip_address") or payload.get("ip") or payload.get("device_ip"))
        if ip_address and not mac_value:
            device = (
                Device.query.filter(Device.user_id == owner_id)
                .filter(Device.ip_address == ip_address)
                .first()
            )
            if device:
                return device

        device_name = self._coerce_str(payload.get("device_name") or payload.get("deviceName") or payload.get("device"))
        if device_name:
            device = (
                Device.query.filter(Device.user_id == owner_id)
                .filter(func.lower(Device.name) == device_name.lower())
                .first()
            )
            if device and _mac_matches(device):
                return device
        return None

    def _touch_device(self, device: Device, payload: dict, mark_active: bool | None) -> None:
        ip_address = self._coerce_str(payload.get("ip_address") or payload.get("ip") or payload.get("device_ip"))
        mac_address = self._coerce_str(
            payload.get("mac_address") or payload.get("mac") or payload.get("macAddress")
        )
        device_name = self._coerce_str(payload.get("device_name") or payload.get("deviceName") or payload.get("device"))

        if ip_address:
            device.ip_address = ip_address
        if mac_address:
            device.mac_address = mac_address
        if device_name and device.name in {"ESP32", "unknown"}:
            device.name = device_name
        if mark_active is True:
            device.is_active = True
        elif mark_active is False:
            device.is_active = False

        profile = self._ensure_profile(device)
        profile.last_seen = self._parse_timestamp(payload) or datetime.utcnow()

    def _ensure_profile(self, device: Device) -> DeviceNetworkProfile:
        profile = device.network_profile
        if profile:
            return profile
        profile = DeviceNetworkProfile(device_id=device.id, user_id=device.user_id)
        db.session.add(profile)
        device.network_profile = profile
        return profile

    def _parse_timestamp(self, payload: dict) -> datetime | None:
        for key in ("time", "timestamp", "ts", "reported_at"):
            value = payload.get(key)
            if isinstance(value, datetime):
                return value
            if isinstance(value, (int, float)):
                try:
                    return datetime.utcfromtimestamp(value)
                except (OverflowError, OSError, ValueError):
                    continue
            if isinstance(value, str):
                cleaned = value.strip()
                if not cleaned:
                    continue
                cleaned = cleaned.replace("Z", "+00:00")
                try:
                    parsed = datetime.fromisoformat(cleaned)
                    if parsed.tzinfo is None:
                        parsed = parsed.replace(tzinfo=ZoneInfo("Asia/Bangkok"))
                    parsed = parsed.astimezone(timezone.utc)
                    return parsed.replace(tzinfo=None)
                except ValueError:
                    continue
        return None

    def _coerce_str(self, value) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    def _coerce_int(self, value) -> int | None:
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def _enrich_payload(self, payload: dict, topic: str, default_type: str | None = None) -> dict:
        enriched = dict(payload or {})
        enriched.setdefault("_mqtt_topic", topic)
        if default_type:
            enriched.setdefault("type", default_type)
        return enriched

    def _derive_ip(self, payload: dict, prefix: str) -> str | None:
        keys = [
            f"{prefix}_ip",
            f"{prefix}Ip",
            f"{prefix}_ip_address",
            f"{prefix} ip",
            f"{prefix}-ip",
            f"{prefix} ip address",
            f"{prefix}-ip-address",
        ]
        for key in keys:
            value = self._coerce_str(payload.get(key))
            if value:
                return value
        return None

    def _auto_block_ip(self, user_id: int, ip_address: str, payload: dict) -> None:
        ip_value = self._coerce_str(ip_address)
        if not ip_value:
            return
        existing = (
            Blacklist.query.filter(Blacklist.user_id == user_id, Blacklist.ip_address == ip_value)
            .first()
        )
        if existing:
            return
        reason = payload.get("alert_msg") or payload.get("type") or "Auto-blocked from alert"
        db.session.add(Blacklist(user_id=user_id, ip_address=ip_value, reason=str(reason)))
        return

    def _auto_block_allowed(self, user_id: int) -> bool:
        settings = SystemSettings.query.filter_by(user_id=user_id).first()
        if not settings:
            return True
        return bool(getattr(settings, "auto_block_enabled", True))

    def _sync_blocked_ip_to_device(self, device: Device, ip_address: str) -> None:
        if not self.client:
            return
        token_value = device.token.token if device.token else None
        if not token_value:
            return
        ip_value = self._coerce_str(ip_address)
        if not ip_value:
            return
        cached = self.latest_settings.get(device.id, {})
        blocked = cached.get("blocked_ips") or cached.get("BLOCKED_IPS") or []
        if isinstance(blocked, str):
            blocked_list = [item.strip() for item in blocked.split(",") if item.strip()]
        elif isinstance(blocked, list):
            blocked_list = [str(item).strip() for item in blocked if str(item).strip()]
        else:
            blocked_list = []
        if ip_value in blocked_list:
            return
        blocked_list.append(ip_value)
        payload = dict(cached) if isinstance(cached, dict) else {}
        payload["token"] = token_value
        payload["blocked_ips"] = blocked_list
        self.latest_settings[device.id] = dict(payload)
        topic = self._control_topic_for_device(device)
        try:
            self.client.publish(topic, json.dumps(payload), qos=0, retain=False)
        except Exception as exc:  # noqa: BLE001
            if self.app:
                self.app.logger.warning("Failed to sync blocked_ips for %s: %s", token_value, exc)

    def _queue_block_for_device(self, device: Device, ip_address: str) -> None:
        token_value = device.token.token if device.token else None
        ip_value = self._coerce_str(ip_address)
        if not token_value or not ip_value:
            return
        pending = self.pending_blocks.setdefault(device.id, set())
        pending.add(ip_value)
        cached = self.latest_settings.get(device.id)
        if cached:
            self._apply_blocklist_update(device, pending, cached)
            self.pending_blocks.pop(device.id, None)
        else:
            # Request fresh settings so we can merge with full payload
            if self.client:
                control_topic = self._control_topic_for_device(device)
                self._register_settings_request(device)
                self.client.publish(
                    control_topic,
                    f"showsetting-{token_value}",
                    qos=0,
                    retain=False,
                )

    def _apply_blocklist_update(self, device: Device, pending: set[str], cached: dict) -> None:
        if not self.client:
            return
        token_value = device.token.token if device.token else None
        if not token_value:
            return
        blocked = cached.get("blocked_ips") or cached.get("BLOCKED_IPS") or []
        if isinstance(blocked, str):
            blocked_list = [item.strip() for item in blocked.split(",") if item.strip()]
        elif isinstance(blocked, list):
            blocked_list = [str(item).strip() for item in blocked if str(item).strip()]
        else:
            blocked_list = []
        merged = list(dict.fromkeys(blocked_list + list(pending)))
        payload = dict(cached) if isinstance(cached, dict) else {}
        payload["token"] = token_value
        payload["blocked_ips"] = merged
        self.latest_settings[device.id] = dict(payload)
        try:
            control_topic = self._control_topic_for_device(device)
            self.client.publish(control_topic, json.dumps(payload), qos=0, retain=False)
        except Exception as exc:  # noqa: BLE001
            if self.app:
                self.app.logger.warning("Failed to sync blocked_ips for %s: %s", token_value, exc)

    def _store_session_code(self, device: Device, code: str) -> None:
        for key in (device.mac_address, device.esp_id):
            if not key:
                continue
            self.session_codes[str(key).lower()] = code

    def _session_code_for_device(self, device: Device) -> str | None:
        for key in (device.mac_address, device.esp_id):
            if not key:
                continue
            code = self.session_codes.get(str(key).lower())
            if code:
                return code
        return None

    def _register_settings_request(self, device: Device) -> None:
        if not device or not device.token:
            return
        token_value = self._coerce_str(device.token.token)
        if not token_value:
            return
        token_key = token_value.lower()
        with self.pending_settings_lock:
            queue = self.pending_settings_requests.setdefault(token_key, [])
            if device.id not in queue:
                queue.append(device.id)
            # Cap queue size to avoid unbounded growth
            if len(queue) > 50:
                self.pending_settings_requests[token_key] = queue[-50:]

    def _pop_pending_settings_device(self, token_value: str) -> Device | None:
        token_key = self._coerce_str(token_value)
        if not token_key:
            return None
        token_key = token_key.lower()
        device_id = None
        with self.pending_settings_lock:
            queue = self.pending_settings_requests.get(token_key)
            if not queue:
                return None
            device_id = queue.pop(0)
            if not queue:
                self.pending_settings_requests.pop(token_key, None)
        if device_id is None:
            return None
        return Device.query.get(device_id)

    def _clear_pending_settings_request(self, token_value: str, device_id: int) -> None:
        token_key = self._coerce_str(token_value)
        if not token_key:
            return
        token_key = token_key.lower()
        with self.pending_settings_lock:
            queue = self.pending_settings_requests.get(token_key)
            if not queue:
                return
            if device_id in queue:
                queue = [item for item in queue if item != device_id]
                if queue:
                    self.pending_settings_requests[token_key] = queue
                else:
                    self.pending_settings_requests.pop(token_key, None)

    def _control_topic_for_device(self, device: Device) -> str:
        code = self._session_code_for_device(device)
        if code:
            return f"esp/setting/Control-{code}"
        return "esp/setting/Control"

    def _alive_topic_for_device(self, device: Device) -> str:
        code = self._session_code_for_device(device)
        if code:
            return f"esp/Alive/Check-{code}"
        return "esp/Alive/Check"

    def _alive_setting_topic_for_device(self, device: Device) -> str:
        code = self._session_code_for_device(device)
        if code:
            return f"esp/alive/setting-{code}"
        return "esp/alive/setting"

    def _normalize_mqtt_whitelist(self, value) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            items = [item.strip() for item in value.split(",")]
        elif isinstance(value, (list, tuple, set)):
            items = [str(item).strip() for item in value]
        else:
            items = [str(value).strip()]
        return [item for item in items if item]

    def _sync_mqtt_whitelist_for_user(self, user_id: int) -> None:
        if not self.client:
            return
        now = time.time()
        last = self.last_whitelist_sync.get(user_id, 0)
        if now - last < 3:
            return
        self.last_whitelist_sync[user_id] = now

        cutoff = datetime.utcnow() - timedelta(minutes=30)
        devices = (
            Device.query.join(DeviceToken, DeviceToken.device_id == Device.id)
            .outerjoin(DeviceNetworkProfile, DeviceNetworkProfile.device_id == Device.id)
            .filter(Device.user_id == user_id)
            .all()
        )
        online_devices = [
            device
            for device in devices
            if device.network_profile
            and device.network_profile.last_seen
            and device.network_profile.last_seen >= cutoff
        ]
        if not online_devices:
            return

        union_topics: list[str] = []
        union_set = set()
        for device in online_devices:
            cached = self.latest_settings.get(device.id)
            if not isinstance(cached, dict):
                continue
            raw = cached.get("g_mqtt_whitelist") or cached.get("G_MQTT_WHITELIST")
            topics = self._normalize_mqtt_whitelist(raw)
            for topic in topics:
                if topic not in union_set:
                    union_set.add(topic)
                    union_topics.append(topic)

        if not union_topics:
            return

        for device in online_devices:
            token_value = device.token.token if device.token else None
            if not token_value:
                continue
            cached = self.latest_settings.get(device.id)
            if not isinstance(cached, dict):
                continue
            current = self._normalize_mqtt_whitelist(
                cached.get("g_mqtt_whitelist") or cached.get("G_MQTT_WHITELIST")
            )
            if set(current) == set(union_topics):
                continue
            payload = dict(cached)
            payload["token"] = token_value
            payload["g_mqtt_whitelist"] = union_topics
            self.latest_settings[device.id] = dict(payload)
            control_topic = self._control_topic_for_device(device)
            self.client.publish(control_topic, json.dumps(payload), qos=0, retain=False)



mqtt_service = MQTTService()
