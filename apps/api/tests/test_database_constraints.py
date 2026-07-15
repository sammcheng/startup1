from app.models import APIKey, StripeWebhookEvent, ToolPurchase, Transaction, User


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


def test_usage_invoice_period_has_unique_database_index():
    index = next(
        index
        for index in Transaction.__table__.indexes
        if index.name == "ux_transactions_usage_period"
    )

    assert index.unique is True
    assert [column.name for column in index.columns] == [
        "buyer_id",
        "tool_id",
        "period_start",
        "period_end",
    ]
    where = str(index.dialect_options["postgresql"]["where"])
    assert "usage" in where
    assert "buyer_id <> seller_id" in where


def test_stripe_event_id_is_the_webhook_receipt_primary_key():
    assert [column.name for column in StripeWebhookEvent.__table__.primary_key.columns] == ["id"]


def test_user_email_has_case_insensitive_unique_database_index():
    index = next(index for index in User.__table__.indexes if index.name == "ux_users_email_lower")

    assert index.unique is True
    assert "lower(users.email)" in str(index.expressions[0])
