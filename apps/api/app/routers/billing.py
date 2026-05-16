from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.schemas.billing import BillingInvoiceSummary, PaymentMethodSummary, SellerBalanceResponse, SellerOnboardingResponse, SetupPaymentResponse
from app.services import billing_service

router = APIRouter(prefix="/billing", tags=["billing"])


@router.post("/setup-payment", response_model=SetupPaymentResponse)
async def setup_payment_method(
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> SetupPaymentResponse:
    client_secret = await billing_service.create_setup_intent(db, current_user)
    return SetupPaymentResponse(client_secret=client_secret)


@router.get("/payment-methods", response_model=list[PaymentMethodSummary])
async def get_payment_methods(
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[PaymentMethodSummary]:
    return await billing_service.list_payment_methods(current_user)


@router.post("/onboard-seller", response_model=SellerOnboardingResponse)
async def onboard_seller(
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> SellerOnboardingResponse:
    onboarding_url = await billing_service.create_stripe_connect_account(db, current_user)
    return SellerOnboardingResponse(onboarding_url=onboarding_url)


@router.get("/seller-balance", response_model=SellerBalanceResponse)
async def get_seller_balance(
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> SellerBalanceResponse:
    return await billing_service.get_seller_balance(db, current_user)


@router.get("/invoices", response_model=list[BillingInvoiceSummary])
async def get_invoices(
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[BillingInvoiceSummary]:
    return await billing_service.list_invoices(current_user)


@router.post("/webhook", status_code=status.HTTP_204_NO_CONTENT)
async def stripe_webhook(
    request: Request,
    stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
    db: AsyncSession = Depends(get_db),
) -> None:
    if not stripe_signature:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "MISSING_SIGNATURE", "message": "Stripe signature is required."},
        )

    payload = await request.body()
    try:
        event = billing_service.verify_webhook(payload, stripe_signature)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_SIGNATURE", "message": "Invalid Stripe webhook signature."},
        ) from exc

    await billing_service.handle_webhook_event(db, event)
