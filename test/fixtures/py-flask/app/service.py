from .db import query


def list_items():
    """Load items from the database."""
    rows = query("select id, name from items")
    return [dict(row) for row in rows]
