import json
import threading
from typing import Optional

import paho.mqtt.client as mqtt

from extensions import db, socketio
from models import Device, Log, User


class MQTTService:
    """Background MQTT client that stores incoming logs and pushes them via Socket.IO."""

    def __init__(self) -> None:
        self.client: Optional[mqtt.Client] = None
        self.app = None

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

        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message

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

    def _on_connect(self, client, userdata, flags, reason_code):  # noqa: D401
        topic = self.app.config.get("MQTT_TOPIC")
        if reason_code == 0:
            client.subscribe(topic)
            self.app.logger.info("Connected to MQTT. Listening on %s", topic)
        else:
            self.app.logger.error("MQTT connection failed: code=%s", reason_code)

    def _on_message(self, client, userdata, msg):
        if not self.app:
            return
        try:
            payload = json.loads(msg.payload.decode("utf-8"))
        except json.JSONDecodeError:
            self.app.logger.warning("Invalid MQTT payload: %s", msg.payload)
            return

        with self.app.app_context():
            device = None
            esp_id = payload.get("device_id")
            if esp_id:
                device = Device.query.filter_by(esp_id=esp_id).first()
            if not device:
                owner = User.query.first()
                owner_id = owner.id if owner else 1
                device = Device(
                    user_id=owner_id,
                    name=payload.get("device_name", "ESP32"),
                    esp_id=esp_id or "unknown",
                )
                db.session.add(device)

            log = Log(
                user_id=device.user_id,
                device=device,
                payload=payload,
                severity=payload.get("severity", "info"),
                source_ip=payload.get("source_ip"),
                destination_ip=payload.get("destination_ip"),
            )
            db.session.add(log)
            db.session.commit()

            log_data = {
                "id": log.id,
                "device": device.name,
                "severity": log.severity,
                "payload": log.payload,
                "created_at": log.created_at.isoformat(),
            }
            socketio.emit("log:new", log_data)


mqtt_service = MQTTService()
