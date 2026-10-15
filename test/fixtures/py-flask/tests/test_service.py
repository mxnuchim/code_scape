from app.service import list_items


def test_list_items_returns_list():
    assert isinstance(list_items(), list)
