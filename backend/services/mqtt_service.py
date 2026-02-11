import json
import re
import secrets
import string
import threading
import time
from datetime import datetime
from typing import Optional

import paho.mqtt.client as mqtt
from sqlalchemy import func

from extensions import db, socketio
from models import Blacklist, Device, DeviceNetworkProfile, DeviceToken, Log, User


class MQTTService:
    """Background MQTT client that stores incoming logs and pushes them via Socket.IO."""

    def __init__(self) -> None:
        self.client: Optional[mqtt.Client] = None
        self.app = None
        self.topics: list[str] = []
        self.fallback_topics: set[str] = set()
        self.discovery_topic = "esp/Entrance"
        self.discovery_interval = 0
        self.settings_poll_interval = 0
        self.allow_reregister = True
        self.reregister_once: set[str] = set()
        self.pending_nonces: dict[str, float] = {}
        self.pending_lock = threading.Lock()
        self.discovery_thread_started = False
        self.settings_poll_thread_started = False
        self.latest_settings: dict[str, dict] = {}
        self.pending_blocks: dict[str, set[str]] = {}

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
        self.allow_reregister = bool(app.config.get("MQTT_ALLOW_REREGISTER", True))
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
                if self._handle_discovery_reply(payload, topic):
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
            return
        self._touch_device(device, payload, mark_active=True)
        enriched = self._enrich_payload(payload, topic, default_type="ESP Settings")
        received_at = datetime.utcnow().isoformat() + "Z"
        enriched.setdefault("_received_at", received_at)
        enriched.setdefault("received_at", received_at)
        enriched.setdefault("description", "Current configuration snapshot reported by ESP.")
        token_value = self._coerce_str(enriched.get("token"))
        if token_value:
            self.latest_settings[token_value] = dict(enriched)
            # Apply any pending block IPs once we have a fresh settings payload.
            pending = self.pending_blocks.get(token_value)
            if pending:
                self._apply_blocklist_update(token_value, pending, enriched)
                self.pending_blocks.pop(token_value, None)
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
        status_raw = str(payload.get("status") or payload.get("state") or "").strip().lower()
        if status_raw in {"offline", "down", "dead", "disconnected"}:
            device.is_active = False
        else:
            device.is_active = True
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

    def publish_discover(self, nonce_length: int = 8, topic: str | None = None) -> str | None:
        if not self.client:
            return None
        nonce = self._generate_nonce(nonce_length)
        with self.pending_lock:
            self._prune_pending_nonces()
            if len(self.pending_nonces) > 200:
                self._drop_oldest_nonces(100)
            while nonce in self.pending_nonces:
                nonce = self._generate_nonce(nonce_length)
            self.pending_nonces[nonce] = time.time()
        payload = {"cmd": "DISCOVER", "nonce": nonce}
        target_topic = topic or self.discovery_topic
        self.client.publish(target_topic, json.dumps(payload), qos=0, retain=False)
        return nonce

    def _handle_discovery_reply(self, payload: dict, topic: str) -> bool:
        nonce = self._coerce_str(payload.get("nonce"))
        token = self._coerce_str(payload.get("token"))
        device_id = self._coerce_str(payload.get("device_id") or payload.get("deviceId"))
        if not nonce or not token or not device_id:
            return False
        with self.pending_lock:
            if nonce not in self.pending_nonces:
                return False
            self.pending_nonces.pop(nonce, None)
        existing = Device.query.filter_by(esp_id=device_id).first()
        if existing and existing.token:
            if device_id in self.reregister_once or self.allow_reregister:
                self.reregister_once.discard(device_id)
                device = self._register_discovered_device(device_id, token, update_token=True)
            else:
                self.app.logger.info("Discovery ignored for %s; already registered", device_id)
                return True
        else:
            device = self._register_discovered_device(device_id, token, update_token=False)
        if device and self.client:
            confirm_message = f"Confirm-{nonce}-{token}"
            self.client.publish(self.discovery_topic, confirm_message, qos=0, retain=False)
            self.app.logger.info("Discovery confirmed for %s with nonce %s", device_id, nonce)
        return True

    def _register_discovered_device(self, device_id: str, token: str, update_token: bool = False) -> Device | None:
        owner = User.query.first()
        if not owner:
            self.app.logger.warning("No user found; skipping auto-registration for %s", device_id)
            return None
        device = Device.query.filter_by(esp_id=device_id).first()
        if not device:
            device = Device(user_id=owner.id, name="ESP32", esp_id=device_id, is_active=True)
            db.session.add(device)
            db.session.flush()
        if device.token:
            if update_token:
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
        socketio.emit(
            "device:registered",
            {"device_id": device.id, "esp_id": device.esp_id},
        )
        return device

    def request_reregister(self, device_id: str) -> None:
        self.reregister_once.add(device_id)

    def _generate_nonce(self, length: int = 8) -> str:
        prefix = "N-"
        max_total = 10
        max_random = max_total - len(prefix)
        random_len = max(1, min(int(length), max_random))
        alphabet = string.ascii_letters + string.digits
        return prefix + "".join(secrets.choice(alphabet) for _ in range(random_len))

    def _prune_pending_nonces(self, ttl_sec: int = 300) -> None:
        now = time.time()
        stale = [nonce for nonce, ts in self.pending_nonces.items() if now - ts > ttl_sec]
        for nonce in stale:
            self.pending_nonces.pop(nonce, None)

    def _drop_oldest_nonces(self, count: int) -> None:
        if count <= 0 or not self.pending_nonces:
            return
        sorted_nonces = sorted(self.pending_nonces.items(), key=lambda item: item[1])
        for nonce, _ in sorted_nonces[:count]:
            self.pending_nonces.pop(nonce, None)

    def _start_discovery_loop(self) -> None:
        if self.discovery_thread_started or self.discovery_interval <= 0:
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
                                db.session.query(Device.id, Device.user_id, DeviceToken.token)
                                .join(DeviceToken, DeviceToken.device_id == Device.id)
                                .all()
                            )
                            blocked_by_user = {}
                            for device_id, user_id, token_value in devices:
                                if not token_value:
                                    continue
                                if user_id not in blocked_by_user:
                                    blocked_by_user[user_id] = self._get_blacklist_ips(user_id)
                                # Request latest settings (same as Rule Management)
                                self.client.publish(
                                    "esp/setting/Control",
                                    f"showsetting-{token_value}",
                                    qos=0,
                                    retain=False,
                                )
                                if self.app:
                                    self.app.logger.info("Settings poll: requested settings for %s", token_value)
                                # Merge DB blacklist into device settings if missing
                                self._sync_blacklist_to_device(token_value, blocked_by_user[user_id])
                except Exception as exc:  # noqa: BLE001
                    if self.app:
                        self.app.logger.exception("Settings poll error: %s", exc)
                time.sleep(self.settings_poll_interval)

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

    def _sync_blacklist_to_device(self, token_value: str, blacklist_ips: list[str]) -> None:
        if not self.client or not token_value or not blacklist_ips:
            return
        cached = self.latest_settings.get(token_value, {})
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
        self.latest_settings[token_value] = dict(payload)
        topic = "esp/setting/Control"
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

        device = None

        token_value = self._coerce_str(payload.get("token"))
        if token_value:
            token_row = DeviceToken.query.filter_by(token=token_value).first()
            if token_row:
                device = token_row.device

        esp_id = self._coerce_str(payload.get("esp_id") or payload.get("espId") or payload.get("espID"))
        if esp_id:
            device = Device.query.filter_by(esp_id=esp_id).first()

        device_id_value = payload.get("device_id") or payload.get("deviceId")
        if not device:
            device_id = self._coerce_int(device_id_value)
            if device_id is not None:
                device = Device.query.filter_by(id=device_id, user_id=owner_id).first()

        if not device and device_id_value is not None and not esp_id:
            esp_candidate = self._coerce_str(device_id_value)
            if esp_candidate:
                device = Device.query.filter_by(esp_id=esp_candidate).first()

        mac_address = self._coerce_str(
            payload.get("mac_address") or payload.get("mac") or payload.get("macAddress")
        )
        if not device and mac_address:
            device = (
                Device.query.filter(Device.user_id == owner_id)
                .filter(func.lower(Device.mac_address) == mac_address.lower())
                .first()
            )

        ip_address = self._coerce_str(payload.get("ip_address") or payload.get("ip") or payload.get("device_ip"))
        if not device and ip_address:
            device = (
                Device.query.filter(Device.user_id == owner_id)
                .filter(Device.ip_address == ip_address)
                .first()
            )

        device_name = self._coerce_str(payload.get("device_name") or payload.get("deviceName") or payload.get("device"))
        if not device and device_name:
            device = (
                Device.query.filter(Device.user_id == owner_id)
                .filter(func.lower(Device.name) == device_name.lower())
                .first()
            )

        if not device:
            device = Device.query.filter_by(user_id=owner_id, esp_id="unknown").first()

        if not device:
            device = Device(
                user_id=owner_id,
                name=device_name or "ESP32",
                esp_id=esp_id or "unknown",
            )
            db.session.add(device)
            db.session.flush()

        return device

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
                    return datetime.fromisoformat(cleaned)
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
        cached = self.latest_settings.get(token_value, {})
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
        self.latest_settings[token_value] = dict(payload)
        topic = f"esp/setting/Control-{token_value}"
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
        pending = self.pending_blocks.setdefault(token_value, set())
        pending.add(ip_value)
        cached = self.latest_settings.get(token_value)
        if cached:
            self._apply_blocklist_update(token_value, pending, cached)
            self.pending_blocks.pop(token_value, None)
        else:
            # Request fresh settings so we can merge with full payload
            if self.client:
                self.client.publish(
                    "esp/setting/Control",
                    f"showsetting-{token_value}",
                    qos=0,
                    retain=False,
                )

    def _apply_blocklist_update(self, token_value: str, pending: set[str], cached: dict) -> None:
        if not self.client:
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
        self.latest_settings[token_value] = dict(payload)
        try:
            self.client.publish("esp/setting/Control", json.dumps(payload), qos=0, retain=False)
        except Exception as exc:  # noqa: BLE001
            if self.app:
                self.app.logger.warning("Failed to sync blocked_ips for %s: %s", token_value, exc)



mqtt_service = MQTTService()
