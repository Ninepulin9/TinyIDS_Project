from datetime import datetime
import json
from http import HTTPStatus

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import delete
from sqlalchemy.orm import joinedload

from extensions import db
from models import Device, DeviceNetworkProfile, DeviceToken, Log
from services.mqtt_service import mqtt_service


devices_bp = Blueprint("devices", __name__, url_prefix="/devices")


def _resolve_user_id(default: int = 1) -> int:
    identity = get_jwt_identity()
    if identity is None:
        return default
    try:
        return int(identity)
    except (TypeError, ValueError):
        return default


def _get_device_or_404(device_id: int) -> Device:
    user_id = _resolve_user_id()
    return (
        Device.query.filter(Device.id == device_id, Device.user_id == user_id)
        .options(joinedload(Device.network_profile))
        .first_or_404()
    )


def _ensure_profile(device: Device, persist: bool = False) -> DeviceNetworkProfile:
    profile = device.network_profile
    if profile:
        return profile.ensure_defaults()

    profile = DeviceNetworkProfile(device_id=device.id, user_id=device.user_id).ensure_defaults()
    if persist:
        db.session.add(profile)
        db.session.flush()
        device.network_profile = profile
    return profile


def _serialize_device(device: Device) -> dict:
    profile = _ensure_profile(device)
    wifi = {
        "ssid": profile.wifi_ssid,
        "last_result": profile.wifi_last_result,
    }

    mqtt = {
        "broker_host": profile.mqtt_broker_host,
        "broker_port": profile.mqtt_broker_port or 1883,
        "username": profile.mqtt_username,
        "password_set": bool(profile.mqtt_password),
        "client_id": profile.mqtt_client_id,
        "use_tls": bool(profile.mqtt_use_tls),
        "last_result": profile.mqtt_last_result,
    }
    token_value = device.token.token if device.token else None

    return {
        "id": device.id,
        "device_name": device.name,
        "esp_id": device.esp_id,
        "status": "Active" if device.is_active else "Inactive",
        "is_active": bool(device.is_active),
        "ip_address": device.ip_address,
        "mac_address": device.mac_address,
        "last_seen": profile.last_seen.isoformat() if profile.last_seen else None,
        "active": bool(device.is_active),
        "wifi": wifi,
        "mqtt": mqtt,
        "token": token_value,
    }


@devices_bp.route("", methods=["GET"])
@jwt_required()
def list_devices():
    user_id = _resolve_user_id()
    devices = (
        Device.query.filter(Device.user_id == user_id)
        .order_by(Device.id.asc())
        .options(joinedload(Device.network_profile))
        .all()
    )
    return jsonify([_serialize_device(device) for device in devices])


@devices_bp.route("", methods=["POST"])
@jwt_required()
def register_device():
    user_id = _resolve_user_id()
    payload = request.get_json(force=True) or {}
    name = (payload.get("name") or "").strip()
    esp_id = (payload.get("esp_id") or "").strip()
    token_value = (payload.get("token") or "").strip()
    if not name or not esp_id:
        return jsonify({"message": "name and esp_id are required"}), HTTPStatus.BAD_REQUEST

    device = Device(
        user_id=user_id,
        name=name,
        esp_id=esp_id,
        is_active=bool(payload.get("is_active", False)),
        ip_address=(payload.get("ip_address") or "").strip() or None,
        mac_address=(payload.get("mac_address") or "").strip() or None,
    )
    db.session.add(device)
    db.session.flush()

    if token_value:
        device_token = DeviceToken(device_id=device.id, token=token_value)
        db.session.add(device_token)
        db.session.flush()

    profile = _ensure_profile(device, persist=True)

    db.session.commit()
    return jsonify(_serialize_device(device)), HTTPStatus.CREATED


@devices_bp.route("/<int:device_id>/active", methods=["PATCH"])
@jwt_required()
def update_active(device_id: int):
    device = _get_device_or_404(device_id)
    payload = request.get_json(force=True) or {}
    if "active" not in payload:
        return jsonify({"message": "active flag is required"}), HTTPStatus.BAD_REQUEST

    device.is_active = bool(payload["active"])

    db.session.commit()
    return jsonify(_serialize_device(device))


@devices_bp.route("/<int:device_id>", methods=["PATCH"])
@jwt_required()
def update_device(device_id: int):
    device = _get_device_or_404(device_id)
    payload = request.get_json(force=True) or {}
    name = payload.get("device_name") or payload.get("name")
    if name is None:
        return jsonify({"message": "device_name is required"}), HTTPStatus.BAD_REQUEST
    name = str(name).strip()
    if not name:
        return jsonify({"message": "device_name is required"}), HTTPStatus.BAD_REQUEST
    device.name = name
    db.session.commit()
    return jsonify(_serialize_device(device))


@devices_bp.route("/<int:device_id>", methods=["DELETE"])
@jwt_required()
def delete_device(device_id: int):
    device = _get_device_or_404(device_id)
    # Use core deletes to avoid ORM nulling device_id on logs.
    db.session.execute(delete(Log).where(Log.device_id == device.id))
    db.session.execute(delete(DeviceToken).where(DeviceToken.device_id == device.id))
    db.session.execute(delete(DeviceNetworkProfile).where(DeviceNetworkProfile.device_id == device.id))
    db.session.execute(delete(Device).where(Device.id == device.id))
    db.session.commit()
    return jsonify({"status": "deleted", "id": device_id})


@devices_bp.route("/<int:device_id>/wifi", methods=["PATCH"])
@jwt_required()
def update_wifi(device_id: int):
    device = _get_device_or_404(device_id)
    payload = request.get_json(force=True) or {}

    ssid = (payload.get("ssid") or "").strip()
    if not ssid:
        return jsonify({"message": "ssid is required"}), HTTPStatus.BAD_REQUEST

    password = payload.get("password")
    password = password.strip() if isinstance(password, str) else None

    profile = _ensure_profile(device, persist=True)
    profile.wifi_ssid = ssid
    if password is not None:
        profile.wifi_password = password

    profile.wifi_last_result = f"Updated at {datetime.utcnow().isoformat()}Z"
    db.session.commit()

    return jsonify(_serialize_device(device))


@devices_bp.route("/<int:device_id>/wifi/test", methods=["POST"])
@jwt_required()
def test_wifi(device_id: int):
    device = _get_device_or_404(device_id)
    payload = request.get_json(force=True) or {}
    ssid = (payload.get("ssid") or "").strip()

    if not ssid:
        return jsonify({"ok": False, "message": "SSID is required for connection test."})

    profile = _ensure_profile(device, persist=True)
    profile.wifi_last_result = f"Test passed at {datetime.utcnow().isoformat()}Z"
    db.session.commit()

    return jsonify({"ok": True, "message": "Wi-Fi credentials accepted."})


@devices_bp.route("/<int:device_id>/mqtt", methods=["PATCH"])
@jwt_required()
def update_mqtt(device_id: int):
    device = _get_device_or_404(device_id)
    payload = request.get_json(force=True) or {}

    host = (payload.get("broker_host") or "").strip()
    if not host:
        return jsonify({"message": "broker_host is required"}), HTTPStatus.BAD_REQUEST

    port = payload.get("broker_port")
    try:
        port_value = int(port) if port is not None else 1883
    except (TypeError, ValueError):
        return jsonify({"message": "broker_port must be an integer"}), HTTPStatus.BAD_REQUEST

    profile = _ensure_profile(device, persist=True)
    profile.mqtt_broker_host = host
    profile.mqtt_broker_port = port_value
    profile.mqtt_username = payload.get("username")
    if payload.get("password") is not None:
        profile.mqtt_password = payload.get("password")
    profile.mqtt_client_id = payload.get("client_id") or profile.mqtt_client_id or f"tinyids-{device.id}"
    profile.mqtt_use_tls = bool(payload.get("use_tls", False))
    profile.mqtt_last_result = f"Updated at {datetime.utcnow().isoformat()}Z"

    db.session.commit()
    return jsonify(_serialize_device(device))


@devices_bp.route("/<int:device_id>/token", methods=["PUT"])
@jwt_required()
def upsert_token(device_id: int):
    device = _get_device_or_404(device_id)
    payload = request.get_json(force=True) or {}
    token_value = (payload.get("token") or "").strip()
    if not token_value:
        return jsonify({"message": "token is required"}), HTTPStatus.BAD_REQUEST

    if device.token:
        device.token.token = token_value
    else:
        db.session.add(DeviceToken(device_id=device.id, token=token_value))
    db.session.commit()
    return jsonify({"id": device.id, "token": token_value})


@devices_bp.route("/<int:device_id>/publish", methods=["POST"])
@jwt_required()
def publish_to_device(device_id: int):
    device = _get_device_or_404(device_id)
    if not mqtt_service.client:
        return jsonify({"message": "MQTT client not connected"}), HTTPStatus.SERVICE_UNAVAILABLE

    payload = request.get_json(force=True) or {}
    topic_base = (payload.get("topic_base") or "esp/setting/Control").strip()
    message = payload.get("message")
    json_payload = payload.get("payload")
    append_token = payload.get("append_token", True)
    token_value = device.token.token if device.token else None

    if append_token:
        if not token_value:
            return jsonify({"message": "token not set for this device"}), HTTPStatus.BAD_REQUEST
        topic = f"{topic_base}-{token_value}"
    else:
        if token_value and topic_base.lower() == "esp/setting/control":
            topic = mqtt_service._control_topic_for_token(token_value)
        else:
            topic = topic_base

    if message is not None and isinstance(message, (dict, list)):
        # if user accidentally sends JSON in message, convert to string to preserve intention
        message = json.dumps(message)

    if json_payload is not None:
        try:
            payload_text = json.dumps(json_payload)
        except Exception:
            return jsonify({"message": "payload must be JSON-serializable"}), HTTPStatus.BAD_REQUEST
    else:
        if message is None:
            message = "showsetting"
        payload_text = str(message)

    mqtt_service.client.publish(topic, payload_text, qos=0, retain=False)
    return jsonify({"status": "sent", "topic": topic, "payload": payload_text})


@devices_bp.route("/<int:device_id>/mqtt/test", methods=["POST"])
@jwt_required()
def test_mqtt(device_id: int):
    device = _get_device_or_404(device_id)
    payload = request.get_json(force=True) or {}

    host = (payload.get("broker_host") or "").strip()
    if not host:
        return jsonify({"ok": False, "message": "Broker host is required for MQTT connectivity check."})

    port = payload.get("broker_port")
    try:
        port_value = int(port) if port is not None else 1883
    except (TypeError, ValueError):
        return jsonify({"ok": False, "message": "Broker port must be an integer."})

    profile = _ensure_profile(device, persist=True)
    profile.mqtt_broker_host = host
    profile.mqtt_broker_port = port_value
    profile.mqtt_username = payload.get("username")
    if payload.get("password") is not None:
        profile.mqtt_password = payload.get("password")
    profile.mqtt_client_id = payload.get("client_id") or profile.mqtt_client_id or f"tinyids-{device.id}"
    profile.mqtt_use_tls = bool(payload.get("use_tls", False))
    profile.mqtt_last_result = f"Test passed at {datetime.utcnow().isoformat()}Z"

    db.session.commit()
    return jsonify({"ok": True, "message": "MQTT parameters look valid."})


@devices_bp.route("/<int:device_id>/settings/latest", methods=["GET"])
@jwt_required()
def latest_settings(device_id: int):
    device = _get_device_or_404(device_id)
    token_value = device.token.token if device.token else None
    if not token_value:
        return jsonify({"message": "token not set for this device"}), HTTPStatus.BAD_REQUEST
    payload = mqtt_service.latest_settings.get(token_value)
    if not payload:
        return jsonify({"message": "settings not available yet"}), HTTPStatus.NOT_FOUND
    return jsonify(payload)


@devices_bp.route("/<int:device_id>/reregister", methods=["POST"])
@jwt_required()
def request_reregister(device_id: int):
    device = _get_device_or_404(device_id)
    if device.token:
        DeviceToken.query.filter_by(device_id=device.id).delete()
    device.is_active = False
    db.session.commit()
    mqtt_service.request_reregister(device.esp_id)
    return jsonify({"status": "ok", "message": "Device marked for re-registration"})


@devices_bp.route("/discover", methods=["POST"])
@jwt_required()
def discover_device():
    if not mqtt_service.client:
        return jsonify({"message": "MQTT client not connected"}), HTTPStatus.SERVICE_UNAVAILABLE
    payload = request.get_json(silent=True) or {}
    mac_address = (payload.get("mac_address") or payload.get("mac") or "").strip()
    token_value = (payload.get("token") or "").strip()
    if not mac_address or not token_value:
        return (
            jsonify({"message": "mac_address and token are required"}),
            HTTPStatus.BAD_REQUEST,
        )
    topic = payload.get("topic")
    ok = mqtt_service.request_registration(mac_address, token_value, topic=topic)
    if not ok:
        return jsonify({"message": "Unable to publish discovery"}), HTTPStatus.SERVICE_UNAVAILABLE
    return jsonify({"status": "sent", "topic": topic or mqtt_service.discovery_topic})
