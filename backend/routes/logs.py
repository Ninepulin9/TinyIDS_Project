from datetime import datetime, timezone
from http import HTTPStatus

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import func

from extensions import db, socketio
from models import Device, Log


logs_bp = Blueprint("logs", __name__, url_prefix="/logs")

_SEVERITY_ALIAS = {
    "info": "Low",
    "informational": "Low",
    "low": "Low",
    "notice": "Low",
    "medium": "Medium",
    "moderate": "Medium",
    "warn": "Medium",
    "warning": "Medium",
    "high": "High",
    "critical": "High",
    "severe": "High",
    "error": "High",
}


def _to_utc_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _normalize_severity(value) -> str:
    if not value:
        return "Low"
    label = str(value).strip()
    mapped = _SEVERITY_ALIAS.get(label.lower())
    return mapped or label.capitalize()


def _derive_field(payload: dict, *keys, default=None):
    for key in keys:
        if key in payload and payload[key]:
            return payload[key]
    return default


def _serialize_log(log: Log) -> dict:
    payload = log.payload or {}
    device_name = log.device.name if log.device else _derive_field(payload, "device_name", "device")

    event_type = _derive_field(payload, "type", "attack_type", "event_type", default="Unknown")
    description = _derive_field(
        payload,
        "description",
        "detail",
        "message",
        "summary",
        default="No additional context provided.",
    )

    return {
        "id": log.id,
        "device_name": device_name,
        "timestamp": _to_utc_iso(log.created_at),
        "severity": _normalize_severity(log.severity),
        "type": event_type,
        "description": description,
        "source_ip": log.source_ip or payload.get("source_ip"),
        "destination_ip": log.destination_ip or payload.get("destination_ip"),
        "payload": payload,
    }


@logs_bp.route("", methods=["GET"])
@jwt_required()
def list_logs():
    user_id = _resolve_user_id()
    severity = request.args.get("severity")

    query = Log.query.filter(Log.user_id == user_id).order_by(Log.created_at.desc())
    if severity:
        normalized = _normalize_severity(severity)
        query = query.filter(func.lower(Log.severity) == normalized.lower())

    logs = [_serialize_log(log) for log in query.limit(200)]
    return jsonify(logs)


@logs_bp.route("", methods=["POST"])
@jwt_required()
def create_log():
    user_id = _resolve_user_id()
    payload = request.get_json(force=True) or {}
    log_payload = payload.get("payload") or {}

    severity = _normalize_severity(
        payload.get("severity") or log_payload.get("severity") or payload.get("level")
    )

    device = None
    device_id = payload.get("device_id")
    if device_id is not None:
        device = Device.query.filter(Device.id == device_id, Device.user_id == user_id).first()

    if not device:
        device_name = payload.get("device_name") or log_payload.get("device_name")
        if device_name:
            device = (
                Device.query.filter(
                    Device.user_id == user_id, func.lower(Device.name) == device_name.lower()
                ).first()
            )

    if not device:
        return jsonify({"message": "Invalid or missing device reference"}), HTTPStatus.BAD_REQUEST

    log = Log(
        user_id=user_id,
        device=device,
        payload=log_payload,
        severity=severity,
        source_ip=payload.get("source_ip") or log_payload.get("source_ip"),
        destination_ip=payload.get("destination_ip") or log_payload.get("destination_ip"),
    )
    db.session.add(log)
    db.session.commit()

    serialized = _serialize_log(log)
    socketio.emit("log:new", serialized)
    return jsonify(serialized), HTTPStatus.CREATED
def _resolve_user_id(default: int = 1) -> int:
    identity = get_jwt_identity()
    if identity is None:
        return default
    try:
        return int(identity)
    except (TypeError, ValueError):
        return default

