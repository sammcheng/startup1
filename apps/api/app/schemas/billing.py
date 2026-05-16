from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class SetupPaymentResponse(BaseModel):
    client_secret: str


class PaymentMethodSummary(BaseModel):
    id: str
    brand: str | None = None
    last4: str | None = None
    exp_month: int | None = None
    exp_year: int | None = None


class SellerOnboardingResponse(BaseModel):
    onboarding_url: str


class BillingInvoiceSummary(BaseModel):
    id: str
    amount_due: Decimal
    amount_paid: Decimal
    status: str | None = None
    created_at: datetime | None = None
    hosted_invoice_url: str | None = None
    invoice_pdf: str | None = None


class SellerPayoutHistoryItem(BaseModel):
    id: str
    amount: Decimal
    currency: str
    created_at: datetime | None = None
    status: str | None = None


class RevenueByToolItem(BaseModel):
    tool_id: str
    tool_name: str
    revenue: Decimal
    platform_fee: Decimal
    seller_payout: Decimal


class SellerBalanceResponse(BaseModel):
    current_balance: Decimal
    pending_payouts: Decimal
    payout_history: list[SellerPayoutHistoryItem]
    revenue_by_tool: list[RevenueByToolItem]
