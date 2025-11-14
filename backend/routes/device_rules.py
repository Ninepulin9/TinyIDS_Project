from http import HTTPStatus

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from extensions import db
from models import Device, DeviceRule

device_rules_bp = Blueprint("device_rules", __name__, url_prefix="/device-rules")
DEFAULT_USER_ID = 1


def _resolve_user_id() -> int:
    identity = get_jwt_identity()
    if identity is None:
        return DEFAULT_USER_ID
    try:
        return int(identity)
    except (TypeError, ValueError):
        return DEFAULT_USER_ID


def _ensure_device(device_id: int, user_id: int) -> Device | None:
    query = Device.query
    if hasattr(Device, "user_id"):
        query = query.filter(Device.user_id == user_id)
    return query.filter(Device.id == device_id).first()


def _ensure_device_rule(device_id: int, user_id: int) -> DeviceRule:
    rule = DeviceRule.query.filter_by(device_id=device_id).first()
    if rule:
        return rule
    rule = DeviceRule(device_id=device_id, user_id=user_id)
    db.session.add(rule)
    db.session.commit()
    return rule


@device_rules_bp.route("/<int:device_id>", methods=["GET"])
@jwt_required(optional=True)
def get_device_rule(device_id: int):
    user_id = _resolve_user_id()
    device = _ensure_device(device_id, user_id)
    if not device:
        return jsonify({"message": "Device not found"}), HTTPStatus.NOT_FOUND

    rule = _ensure_device_rule(device.id, user_id)
    return jsonify(rule.to_dict())


@device_rules_bp.route("/<int:device_id>", methods=["PUT"])
@jwt_required(optional=True)
def update_device_rule(device_id: int):
    user_id = _resolve_user_id()
    device = _ensure_device(device_id, user_id)
    if not device:
        return jsonify({"message": "Device not found"}), HTTPStatus.NOT_FOUND

    payload = request.get_json(silent=True) or {}

    def _positive_number(value, field):
        if value is None:
            return None
        try:
            number = int(value)
        except (TypeError, ValueError):
            raise ValueError(f"{field} must be a number")
        if number <= 0:
            raise ValueError(f"{field} must be greater than 0")
        return number

    try:
        rate_limit = _positive_number(payload.get("rate_limit_ppm"), "rate_limit_ppm")
        max_packet = _positive_number(payload.get("max_packet_size"), "max_packet_size")
    except ValueError as exc:  # noqa: BLE001
        return jsonify({"message": str(exc)}), HTTPStatus.BAD_REQUEST

    mac_address = (payload.get("mac_address") or "").strip()
    if not mac_address:
        return jsonify({"message": "mac_address is required"}), HTTPStatus.BAD_REQUEST

    topics = payload.get("mqtt_topics") or []
    if not isinstance(topics, list):
        return jsonify({"message": "mqtt_topics must be a list"}), HTTPStatus.BAD_REQUEST
    normalized_topics = [str(topic).strip() for topic in topics if str(topic).strip()]

    rule = _ensure_device_rule(device.id, user_id)
    rule.rate_limit_ppm = rate_limit
    rule.mac_address = mac_address
    rule.mqtt_topics = normalized_topics
    rule.ssid = (payload.get("ssid") or "").strip() or None
    rule.max_packet_size = max_packet
    rssi_value = payload.get("rssi_threshold")
    if rssi_value is not None and rssi_value != "":
        try:
            rule.rssi_threshold = int(rssi_value)
        except (TypeError, ValueError):
            return jsonify({"message": "rssi_threshold must be a number"}), HTTPStatus.BAD_REQUEST
    else:
        rule.rssi_threshold = None

    rule.enabled = bool(payload.get("enabled"))

    db.session.commit()
    return jsonify(rule.to_dict())
