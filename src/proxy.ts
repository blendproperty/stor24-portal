import { NextResponse, type NextRequest } from "next/server";
import { sessionCookieName, verifySessionToken } from "@/lib/session";
import { db } from "@/lib/db";

const publicPagePrefixes = ["/login", "/forgot-password", "/reset-password/", "/invite/", "/setup/", "/brand/", "/icons/", "/sign/", "/offline.html", "/offline-workspace.html", "/offline-workspace.css", "/offline-workspace.js", "/manifest.webmanifest", "/sw.js"];
const publicApiPrefixes = ["/api/health", "/api/auth/login", "/api/auth/mfa/verify", "/api/auth/setup", "/api/auth/forgot-password", "/api/auth/reset-password", "/api/public/v1/", "/api/webhooks/blendsign", "/api/v1/invitations/accept", "/api/v1/webhooks/inbound/", "/api/v1/billing/run-monthly"];

export function isPublicPathname(pathname: string) {
  return publicPagePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix)) ||
    publicApiPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = isPublicPathname(pathname);
  const session = await verifySessionToken(request.cookies.get(sessionCookieName)?.value);
  const user = session ? await db.user.findUnique({ where: { id: session.userId }, select: { active: true, sessionVersion: true } }) : null;
  const validSession = Boolean(session && user?.active && user.sessionVersion === session.sessionVersion);

  if (pathname === "/login" && validSession) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (isPublic) return NextResponse.next();
  if (!validSession && pathname.startsWith("/api/")) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "Please sign in." } }, { status: 401 });
  }
  if (!validSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(sessionCookieName);
    return response;
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
