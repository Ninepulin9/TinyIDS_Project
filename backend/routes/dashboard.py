from collections import defaultdict
from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import func
from sqlalchemy.orm import joinedload

from extensions import db
from models import Blacklist, Device, Log


dashboard_bp = Blueprint("dashboard", __name__, url_prefix="/dashboard")


def _resolve_user_id(default: int = 1) -> int:
    identity = get_jwt_identity()
    if identity is None:
        return default
    try:
        return int(identity)
    except (TypeError, ValueError):
        return default


def _filtered_logs(user_id, device_id=None, mac_address=None):
    query = Log.query.filter(Log.user_id == user_id)
    if device_id:
        query = query.filter(Log.device_id == device_id)
    elif mac_address:
        mac_normalized = mac_address.lower()
        query = query.join(Device).filter(func.lower(Device.mac_address) == mac_normalized)
    return query


def _serialize_device(device, attack_counts):
    profile = device.network_profile
    last_seen = None
    token_value = device.token.token if device.token else None

    if profile and profile.last_seen:
        if profile.last_seen.tzinfo is None:
            last_seen = profile.last_seen.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
        else:
            last_seen = profile.last_seen.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    return {
        "id": device.id,
        "device_name": device.name,
        "status": "Active" if device.is_active else "Inactive",
        "mac_address": device.mac_address,
        "active": bool(device.is_active),
        "last_seen": last_seen,
        "attackCount": attack_counts.get(device.id, 0),
        "token": token_value,
    }


def _build_trend_data(base_query):
    today = datetime.utcnow().date()
    window = [today - timedelta(days=idx) for idx in range(11, -1, -1)]

    counts = dict(
        base_query.with_entities(func.date(Log.created_at), func.count(Log.id))
        .group_by(func.date(Log.created_at))
        .all()
    )

    return [
        {
            "label": day.strftime("%a"),
            "fullLabel": day.strftime("%b %d"),
            "value": counts.get(day, 0),
        }
        for day in window
    ]


def _compute_totals(base_query, user_id: int, device=None, total_devices=0, active_devices=0):
    now = datetime.utcnow().replace(tzinfo=timezone.utc)
    recent_window = now - timedelta(hours=24)
    recent_query = base_query.filter(Log.created_at >= recent_window)

    total_logs = base_query.with_entities(func.count(Log.id)).scalar() or 0
    alerts_24h = recent_query.with_entities(func.count(Log.id)).scalar() or 0

    high_events = (
        recent_query.with_entities(func.count(Log.id))
        .filter(func.lower(Log.severity).in_(["high", "critical", "severe", "error"]))
        .scalar()
        or 0
    )

    unique_sources = (
        recent_query.with_entities(Log.source_ip)
        .filter(Log.source_ip.isnot(None))
        .filter(Log.source_ip != "")
        .distinct()
        .count()
    )

    blocked_count = (
        Blacklist.query.filter(Blacklist.user_id == user_id)
        .with_entities(func.count(Blacklist.id))
        .scalar()
        or 0
    )

    last_alert_at_row = (
        base_query.with_entities(Log.created_at)
        .order_by(Log.created_at.desc())
        .first()
    )
    last_alert_at = last_alert_at_row[0] if last_alert_at_row else None

    threat_percent = 0
    if alerts_24h:
        threat_percent = min(100, int((high_events / alerts_24h) * 100))

    if device:
        active_ratio = 100 if device.is_active else 0
    else:
        active_ratio = int((active_devices / total_devices) * 100) if total_devices else 0

    totals = {
        "detectedAttacks": alerts_24h,
        "packetsAnalyzed": total_logs,
        "detectionAccuracy": unique_sources,
        "deviceActivity": active_ratio,
        "alertsTriggered": high_events,
        "ruleActivation": 100,
        "packetsCaptured": blocked_count,
        "threatLevel": threat_percent,
        "lastAlertAt": last_alert_at.isoformat().replace("+00:00", "Z") if last_alert_at else None,
    }

    widgets = {
        "totalDetectedAttacks": alerts_24h,
        "totalPacketsAnalyzed": total_logs,
        "detectionAccuracy": unique_sources,
        "deviceActivity": active_ratio,
        "alertsTriggered": high_events,
        "ruleActivation": 100,
        "packetsCaptured": blocked_count,
    }

    return totals, widgets


@dashboard_bp.route("", methods=["GET"])
@jwt_required(optional=True)
def dashboard_overview():
    user_id = _resolve_user_id()
    device_id = request.args.get("device_id", type=int)
    mac_address = request.args.get("mac_address")

    base_query = _filtered_logs(user_id=user_id, device_id=device_id, mac_address=mac_address)

    devices = (
        Device.query.options(joinedload(Device.network_profile))
        .filter(Device.user_id == user_id)
        .order_by(Device.name.asc())
        .all()
    )
    attack_counts = dict(
        db.session.query(Log.device_id, func.count(Log.id))
        .filter(Log.user_id == user_id)
        .group_by(Log.device_id)
        .all()
    )

    total_devices = len(devices)
    active_devices = sum(1 for device in devices if device.is_active)

    selected_device = None
    if device_id:
        selected_device = next((d for d in devices if d.id == device_id), None)
    elif mac_address:
        selected_device = next(
            (
                d
                for d in devices
                if d.mac_address
                and d.mac_address.lower() == mac_address.lower()
            ),
            None,
        )

    totals, widgets = _compute_totals(
        base_query,
        user_id=user_id,
        device=selected_device,
        total_devices=total_devices,
        active_devices=active_devices,
    )
    trends = {
        "days": _build_trend_data(base_query),
        "minutes": [{"label": f"{idx * 5}m", "value": 0} for idx in range(12)],
        "hours": [{"label": f"{idx}h", "value": 0} for idx in range(12)],
        "seconds": [{"label": f"{idx * 5}s", "value": 0} for idx in range(12)],
        "months": [{"label": f"M{idx + 1}", "value": 0} for idx in range(12)],
    }

    available_devices = [_serialize_device(device, attack_counts) for device in devices]

    selected_payload = None
    if selected_device:
        selected_payload = _serialize_device(selected_device, attack_counts)

    response = {
        "totals": totals,
        "widgets": widgets,
        "trends": trends,
        "available_devices": available_devices,
        "selected_device": selected_payload,
        "lastUpdated": datetime.utcnow().replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
        "devicesOnline": active_devices,
        "deviceCount": total_devices,
    }

    return jsonify(response)
