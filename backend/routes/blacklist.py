from http import HTTPStatus
import re

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import text
from sqlalchemy.orm import joinedload
from sqlalchemy.exc import IntegrityError, OperationalError, ProgrammingError

from extensions import db
from models import Blacklist, Device, DeviceToken
from services.mqtt_service import mqtt_service

blacklist_bp = Blueprint("blacklist", __name__, url_prefix="/blacklist")
DEFAULT_USER_ID = 1


def _resolve_user_id() -> int:
    identity = get_jwt_identity()
    if identity is None:
        return DEFAULT_USER_ID
    try:
        return int(identity)
    except (TypeError, ValueError):
        return DEFAULT_USER_ID


def _serialize_entry(entry) -> dict:
    ip_address = getattr(entry, "ip_address", None)
    reason = getattr(entry, "reason", None)
    created_at = getattr(entry, "created_at", None)
    created_value = (
        created_at.isoformat().replace("+00:00", "Z")
        if hasattr(created_at, "isoformat")
        else created_at
    )
    device = getattr(entry, "device", None)
    device_name = getattr(entry, "device_name", None) or (device.name if device else None)
    device_id = getattr(entry, "device_id", None)

    return {
        "id": getattr(entry, "id", None),
        "device_id": device_id,
        "device_name": device_name or "Unknown",
        "ip_address": ip_address,
        "reason": reason,
        "created_at": created_value,
    }


def _is_valid_ip(value: str) -> bool:
    return bool(re.match(r"^(?:\d{1,3}\.){3}\d{1,3}$", value))


def _raw_blacklist_rows():
    rows = db.session.execute(
        text(
            "SELECT id, device_id, ip_address, reason, created_at FROM blacklist ORDER BY created_at DESC"
        )
    )
    for row in rows:
        yield row


@blacklist_bp.route("", methods=["GET"])
@jwt_required(optional=True)
def list_blacklist():
    user_id = _resolve_user_id()
    try:
        entries = (
            Blacklist.query.filter(Blacklist.user_id == user_id)
            .options(joinedload(Blacklist.device))
            .order_by(Blacklist.created_at.desc())
            .all()
        )
    except (OperationalError, ProgrammingError):
        entries = list(_raw_blacklist_rows())
    return jsonify([_serialize_entry(entry) for entry in entries])


@blacklist_bp.route("", methods=["POST"])
@jwt_required(optional=True)
def add_blacklist_entry():
    user_id = _resolve_user_id()
    payload = request.get_json(force=True) or {}
    ip_address = (payload.get("ip_address") or payload.get("ip") or "").strip()
    if not ip_address or not _is_valid_ip(ip_address):
        return jsonify({"message": "Valid ip_address is required"}), HTTPStatus.BAD_REQUEST

    reason = (payload.get("reason") or payload.get("alert_msg") or payload.get("type") or "").strip() or None
    device_id = payload.get("device_id")
    token_value = (payload.get("token") or "").strip()

    device = None
    if device_id is not None:
        try:
            device_id = int(device_id)
        except (TypeError, ValueError):
            device_id = None
    if device_id is not None:
        device = Device.query.filter(Device.id == device_id, Device.user_id == user_id).first()

    if not device and token_value:
        token_row = DeviceToken.query.filter_by(token=token_value).first()
        if token_row and token_row.device and token_row.device.user_id == user_id:
            device = token_row.device

    entry_query = Blacklist.query.filter(
        Blacklist.user_id == user_id, Blacklist.ip_address == ip_address
    )
    if device:
        entry_query = entry_query.filter(Blacklist.device_id == device.id)
    else:
        entry_query = entry_query.filter(Blacklist.device_id.is_(None))
    entry = entry_query.first()
    if not entry:
        entry = Blacklist(
            user_id=user_id,
            device_id=device.id if device else None,
            ip_address=ip_address,
            reason=reason,
        )
        db.session.add(entry)
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            entry = entry_query.first()
    else:
        if reason and not entry.reason:
            entry.reason = reason
            db.session.commit()

    if device:
        try:
            mqtt_service._queue_block_for_device(device, ip_address)
        except Exception:
            # Swallow MQTT sync errors; entry already recorded.
            pass

    return jsonify({"entry": _serialize_entry(entry), "synced": bool(device)})


@blacklist_bp.route("/<int:entry_id>", methods=["DELETE"])
@jwt_required(optional=True)
def delete_blacklist_entry(entry_id: int):
    user_id = _resolve_user_id()
    try:
        entry = (
            Blacklist.query.filter(Blacklist.id == entry_id, Blacklist.user_id == user_id)
            .first()
        )
        if not entry:
            return jsonify({"message": "Blacklist entry not found"}), HTTPStatus.NOT_FOUND

        db.session.delete(entry)
        db.session.commit()
        return "", HTTPStatus.NO_CONTENT
    except (OperationalError, ProgrammingError):
        db.session.execute(text("DELETE FROM blacklist WHERE id = :entry_id"), {"entry_id": entry_id})
        db.session.commit()
        return "", HTTPStatus.NO_CONTENT
