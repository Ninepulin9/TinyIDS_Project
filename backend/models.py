from datetime import datetime
try:
    from sqlalchemy.dialects.mysql import JSON
except ModuleNotFoundError:
    from sqlalchemy.types import JSON
from extensions import db, bcrypt


class TimestampMixin:
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(
        db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class User(db.Model, TimestampMixin):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(255), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)

    devices = db.relationship("Device", backref="user", cascade="all, delete-orphan")
    rules = db.relationship("Rule", backref="user", cascade="all, delete-orphan")
    logs = db.relationship("Log", backref="user", cascade="all, delete-orphan")
    dashboard_settings = db.relationship(
        "DashboardSettings", backref="user", uselist=False, cascade="all, delete"
    )
    system_settings = db.relationship(
        "SystemSettings", backref="user", uselist=False, cascade="all, delete-orphan"
    )

    def set_password(self, password: str) -> None:
        self.password_hash = bcrypt.generate_password_hash(password).decode("utf-8")

    def check_password(self, password: str) -> bool:
        return bcrypt.check_password_hash(self.password_hash, password)


class Device(db.Model, TimestampMixin):
    __tablename__ = "devices"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    name = db.Column(db.String(120), nullable=False)
    esp_id = db.Column(db.String(120), unique=True, nullable=False)
    is_active = db.Column(db.Boolean, default=False)
    ip_address = db.Column(db.String(64))
    mac_address = db.Column(db.String(64))

    logs = db.relationship("Log", backref="device", lazy=True)
    network_profile = db.relationship(
        "DeviceNetworkProfile", backref="device", uselist=False, cascade="all, delete-orphan"
    )
    token = db.relationship("DeviceToken", backref="device", uselist=False, cascade="all, delete-orphan")


class Rule(db.Model, TimestampMixin):
    __tablename__ = "rules"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    name = db.Column(db.String(120), nullable=False)
    rate_limit_ppm = db.Column(db.Integer, default=10)
    mac_address_rule = db.Column(db.String(64))
    topic = db.Column(db.String(255))
    ssid = db.Column(db.String(120))
    packet_size_max = db.Column(db.Integer)
    rssi_threshold = db.Column(db.Integer)

    logs = db.relationship("Log", backref="rule", lazy=True)


class Log(db.Model, TimestampMixin):
    __tablename__ = "logs"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    device_id = db.Column(db.Integer, db.ForeignKey("devices.id"), nullable=False)
    rule_id = db.Column(db.Integer, db.ForeignKey("rules.id"))
    payload = db.Column(JSON, nullable=False)
    severity = db.Column(db.String(32), default="info")
    source_ip = db.Column(db.String(64))
    destination_ip = db.Column(db.String(64))


class Blacklist(db.Model, TimestampMixin):
    __tablename__ = "blacklist"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    ip_address = db.Column(db.String(64), unique=True, nullable=False)
    reason = db.Column(db.String(255))


class SystemSettings(db.Model, TimestampMixin):
    __tablename__ = "system_settings"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    log_retention_days = db.Column(db.Integer, default=30)
    attack_notifications = db.Column(db.Boolean, default=True)
    cooldown_seconds = db.Column(db.Integer, default=60)


class DeviceNetworkProfile(db.Model, TimestampMixin):
    __tablename__ = "device_network_profiles"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    device_id = db.Column(db.Integer, db.ForeignKey("devices.id"), unique=True, nullable=False)
    last_seen = db.Column(db.DateTime)

    wifi_ssid = db.Column(db.String(120))
    wifi_password = db.Column(db.String(255))
    wifi_last_result = db.Column(db.String(255))

    mqtt_broker_host = db.Column(db.String(255))
    mqtt_broker_port = db.Column(db.Integer, default=1883)
    mqtt_username = db.Column(db.String(120))
    mqtt_password = db.Column(db.String(255))
    mqtt_client_id = db.Column(db.String(255))
    mqtt_use_tls = db.Column(db.Boolean, default=False)
    mqtt_last_result = db.Column(db.String(255))

    def ensure_defaults(self):
        if self.mqtt_broker_port is None:
            self.mqtt_broker_port = 1883
        return self


class DeviceToken(db.Model, TimestampMixin):
    __tablename__ = "device_tokens"

    id = db.Column(db.Integer, primary_key=True)
    device_id = db.Column(db.Integer, db.ForeignKey("devices.id"), unique=True, nullable=False)
    token = db.Column(db.String(255), nullable=False)


DEFAULT_DASHBOARD_WIDGETS = {
    "total_detected_attacks": True,
    "total_packets_analyzed": True,
    "device_activity_pct": True,
    "alerts_triggered": True,
    "detection_accuracy_pct": True,
    "detection_trend_pct": False,
    "rule_activation_pct": True,
    "packets_captured": True,
    "threat_level_indicator": True,
    "sensor_health_card": True,
    "data_pipeline_card": True,
}

TIMEFRAME_TO_MINUTES = {
    "seconds": 0,
    "minutes": 1,
    "hours": 60,
    "days": 1440,
    "months": 43200,
}

MINUTES_TO_TIMEFRAME = {minutes: timeframe for timeframe, minutes in TIMEFRAME_TO_MINUTES.items()}


class DashboardSettings(db.Model, TimestampMixin):
    __tablename__ = "dashboard_settings"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    timeframe_minutes = db.Column(db.Integer, default=TIMEFRAME_TO_MINUTES["days"])
    widgets_visible = db.Column(JSON, default=lambda: DEFAULT_DASHBOARD_WIDGETS.copy())

    @property
    def graph_timeframe(self) -> str:
        return MINUTES_TO_TIMEFRAME.get(self.timeframe_minutes, "days")

    def set_graph_timeframe(self, timeframe: str) -> None:
        self.timeframe_minutes = TIMEFRAME_TO_MINUTES.get(timeframe, TIMEFRAME_TO_MINUTES["days"])

    def to_widget_config(self) -> dict:
        current = dict(DEFAULT_DASHBOARD_WIDGETS)
        stored = self.widgets_visible or {}
        current.update({k: bool(v) for k, v in stored.items() if k in current})
        return current

    def update_widgets(self, widgets: dict) -> None:
        merged = self.to_widget_config()
        for key, value in widgets.items():
            if key in merged:
                merged[key] = bool(value)
        self.widgets_visible = merged


class DeviceRule(db.Model, TimestampMixin):
    __tablename__ = "device_rules"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    device_id = db.Column(db.Integer, db.ForeignKey("devices.id"), unique=True, nullable=False)
    rate_limit_ppm = db.Column(db.Integer, default=60)
    mac_address = db.Column(db.String(64))
    mqtt_topics = db.Column(JSON, default=list)
    ssid = db.Column(db.String(120))
    max_packet_size = db.Column(db.Integer, default=2048)
    rssi_threshold = db.Column(db.Integer, default=-70)
    enabled = db.Column(db.Boolean, default=True)

    def to_dict(self) -> dict:
        return {
            "rate_limit_ppm": self.rate_limit_ppm,
            "mac_address": self.mac_address,
            "mqtt_topics": self.mqtt_topics or [],
            "ssid": self.ssid,
            "max_packet_size": self.max_packet_size,
            "rssi_threshold": self.rssi_threshold,
            "enabled": bool(self.enabled),
        }


__all__ = [
    "User",
    "Device",
    "Rule",
    "Log",
    "Blacklist",
    "SystemSettings",
    "DeviceNetworkProfile",
    "DeviceToken",
    "DashboardSettings",
    "DeviceRule",
    "DEFAULT_DASHBOARD_WIDGETS",
    "TIMEFRAME_TO_MINUTES",
    "MINUTES_TO_TIMEFRAME",
]
