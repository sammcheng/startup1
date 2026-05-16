import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export default function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimisation)
     * - favicon.ico
     * - Files with an extension (e.g. .png, .svg)
     *
     * Public routes (/, /marketplace, /tools/[slug], /api/*) are
     * allowed through automatically because they don't match
     * isProtectedRoute above.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|json|xml|txt|woff2?)$).*)",
  ],
};
