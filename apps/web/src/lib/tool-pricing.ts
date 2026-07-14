import type { Tool } from "@/types/tool";

type PricedTool = Pick<Tool, "ownership_type" | "one_time_price" | "price_per_request">;

export interface ToolPriceDisplay {
  formatted: string;
  suffix: "one-time" | "/request";
}

function parsePrice(value: string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function getToolPriceDisplay(tool: PricedTool): ToolPriceDisplay {
  const isOneTime = tool.ownership_type === "full_sale";
  const amount = parsePrice(isOneTime ? tool.one_time_price : tool.price_per_request);

  if (amount === 0) {
    return {
      formatted: "Free",
      suffix: isOneTime ? "one-time" : "/request",
    };
  }

  if (isOneTime) {
    return {
      formatted: amount.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      suffix: "one-time",
    };
  }

  const fractionDigits = amount < 0.001 ? 6 : amount < 0.01 ? 4 : 3;
  return {
    formatted: `$${amount.toFixed(fractionDigits)}`,
    suffix: "/request",
  };
}
