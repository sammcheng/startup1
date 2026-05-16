export interface SetupPaymentResponse {
  client_secret: string;
}

export interface PaymentMethodSummary {
  id: string;
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
}

export interface BillingInvoiceSummary {
  id: string;
  amount_due: string;
  amount_paid: string;
  status: string | null;
  created_at: string | null;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
}

export interface SellerPayoutHistoryItem {
  id: string;
  amount: string;
  currency: string;
  created_at: string | null;
  status: string | null;
}

export interface RevenueByToolItem {
  tool_id: string;
  tool_name: string;
  revenue: string;
  platform_fee: string;
  seller_payout: string;
}

export interface SellerBalanceResponse {
  current_balance: string;
  pending_payouts: string;
  payout_history: SellerPayoutHistoryItem[];
  revenue_by_tool: RevenueByToolItem[];
}
