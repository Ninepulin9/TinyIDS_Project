from http import HTTPStatus

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from extensions import db
from models import Rule


rules_bp = Blueprint("rules", __name__, url_prefix="/rules")


def _resolve_user_id(default: int = 1) -> int:
    identity = get_jwt_identity()
    if identity is None:
        return default
    try:
        return int(identity)
    except (TypeError, ValueError):
        return default


def _serialize(rule: Rule) -> dict:
    return {
        "id": rule.id,
        "name": rule.name,
        "rate_limit_ppm": rule.rate_limit_ppm,
        "mac_address_rule": rule.mac_address_rule,
        "topic": rule.topic,
        "ssid": rule.ssid,
        "packet_size_max": rule.packet_size_max,
        "rssi_threshold": rule.rssi_threshold,
    }


@rules_bp.route("", methods=["GET"])
@jwt_required()
def list_rules():
    user_id = _resolve_user_id()
    rules = Rule.query.filter(Rule.user_id == user_id).order_by(Rule.created_at.desc()).all()
    return jsonify([_serialize(rule) for rule in rules])


@rules_bp.route("", methods=["POST"])
@jwt_required()
def create_rule():
    user_id = _resolve_user_id()
    payload = request.get_json(force=True) or {}
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify({"message": "name is required"}), HTTPStatus.BAD_REQUEST

    rule = Rule(
        user_id=user_id,
        name=name,
        rate_limit_ppm=payload.get("rate_limit_ppm", 10),
        mac_address_rule=payload.get("mac_address_rule"),
        topic=payload.get("topic"),
        ssid=payload.get("ssid"),
        packet_size_max=payload.get("packet_size_max"),
        rssi_threshold=payload.get("rssi_threshold"),
    )
    db.session.add(rule)
    db.session.commit()
    return jsonify(_serialize(rule)), HTTPStatus.CREATED


@rules_bp.route("/<int:rule_id>", methods=["PUT"])
@jwt_required()
def update_rule(rule_id: int):
    user_id = _resolve_user_id()
    rule = Rule.query.filter(Rule.id == rule_id, Rule.user_id == user_id).first_or_404()
    payload = request.get_json(force=True)

    for attr in ["name", "rate_limit_ppm", "mac_address_rule", "topic", "ssid", "packet_size_max", "rssi_threshold"]:
        if attr in payload:
            setattr(rule, attr, payload[attr])

    db.session.commit()
    return jsonify(_serialize(rule))


@rules_bp.route("/<int:rule_id>", methods=["DELETE"])
@jwt_required()
def delete_rule(rule_id: int):
    user_id = _resolve_user_id()
    rule = Rule.query.filter(Rule.id == rule_id, Rule.user_id == user_id).first_or_404()
    db.session.delete(rule)
    db.session.commit()
    return "", HTTPStatus.NO_CONTENT
