from flask import Blueprint, jsonify

from . import service

bp = Blueprint("items", __name__)


@bp.route("/items", methods=["GET"])
def list_items():
    """Return every item."""
    return jsonify(service.list_items())
