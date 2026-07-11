from app.models import APIKey, ToolPurchase


def test_api_key_hash_has_unique_database_index():
    index = next(
        index for index in APIKey.__table__.indexes if index.name == "ux_api_keys_key_hash"
    )

    assert index.unique is True
    assert [column.name for column in index.columns] == ["key_hash"]


def test_open_tool_purchase_has_unique_partial_database_index():
    index = next(
        index
        for index in ToolPurchase.__table__.indexes
        if index.name == "ux_tool_purchases_buyer_tool_open"
    )

    assert index.unique is True
    assert [column.name for column in index.columns] == ["buyer_id", "tool_id"]
    assert "pending" in str(index.dialect_options["postgresql"]["where"])
    assert "active" in str(index.dialect_options["postgresql"]["where"])
