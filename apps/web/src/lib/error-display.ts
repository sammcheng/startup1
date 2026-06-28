import { ApiError } from "@/lib/api";

export interface PublicErrorDisplay {
  title: string;
  message: string;
  code?: string;
  requestId?: string;
  status?: number;
  devDetails?: string;
}

function isErrorWithDigest(error: unknown): error is Error & { digest?: string } {
  return error instanceof Error || (typeof error === "object" && error !== null && "digest" in error);
}

function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return null;
}

function getDevDetails(error: unknown): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  if (error instanceof Error) {
    return `${error.name}: ${error.message || "(no message)"}`;
  }
  return typeof error === "string" ? error : undefined;
}

function getDigest(error: unknown): string | undefined {
  if (!isErrorWithDigest(error)) return undefined;
  return typeof error.digest === "string" && error.digest.length > 0 ? error.digest : undefined;
}

export function toPublicErrorDisplay(
  error: unknown,
  options: {
    fallbackTitle?: string;
    fallbackMessage?: string;
  } = {},
): PublicErrorDisplay {
  if (error instanceof ApiError) {
    const isServerError = error.status >= 500 || error.status === 0;
    return {
      title: options.fallbackTitle ?? (isServerError ? "Service temporarily unavailable" : "Request could not be completed"),
      message: isServerError
        ? options.fallbackMessage ?? "The live service did not respond cleanly. Please retry in a moment."
        : error.message,
      code: error.code,
      requestId: error.requestId ?? undefined,
      status: error.status,
      devDetails: getDevDetails(error),
    };
  }

  return {
    title: options.fallbackTitle ?? "We hit a snag loading this screen",
    message:
      process.env.NODE_ENV === "production"
        ? options.fallbackMessage ?? "Please try again. If it keeps happening, include the support ID below."
        : getErrorMessage(error) ?? options.fallbackMessage ?? "Something went wrong.",
    requestId: getDigest(error),
    devDetails: getDevDetails(error),
  };
}
