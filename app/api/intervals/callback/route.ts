import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  cookieOptions,
  createIntervalsSession,
  intervalsConfig,
  INTERVALS_SESSION_COOKIE,
  INTERVALS_STATE_COOKIE,
} from "@/lib/intervals-session";

export const runtime = "nodejs";

function equalState(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function home(redirectUri: string, result: string) {
  const url = new URL("/", redirectUri);
  url.searchParams.set(result === "connected" ? "intervals" : "intervals_error", result);
  return url;
}

export async function GET(request: NextRequest) {
  const config = intervalsConfig();
  const expectedState = request.cookies.get(INTERVALS_STATE_COOKIE)?.value ?? "";
  const actualState = request.nextUrl.searchParams.get("state") ?? "";
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const denied = request.nextUrl.searchParams.get("error");

  if (!config) return NextResponse.json({ error: "Intervals.icu is not configured on this server." }, { status: 503 });
  if (!expectedState || !equalState(actualState, expectedState)) {
    const response = NextResponse.redirect(home(config.redirectUri, "invalid_state"));
    response.cookies.delete(INTERVALS_STATE_COOKIE);
    return response;
  }
  if (denied) {
    const response = NextResponse.redirect(home(config.redirectUri, denied === "access_denied" ? "access_denied" : "authorization_failed"));
    response.cookies.delete(INTERVALS_STATE_COOKIE);
    return response;
  }
  if (!code) {
    const response = NextResponse.redirect(home(config.redirectUri, "authorization_failed"));
    response.cookies.delete(INTERVALS_STATE_COOKIE);
    return response;
  }

  try {
    const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code });
    const tokenResponse = await fetch("https://intervals.icu/api/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!tokenResponse.ok) throw new Error(`Token exchange returned ${tokenResponse.status}`);
    const token = await tokenResponse.json() as {
      access_token?: unknown;
      scope?: unknown;
      athlete?: { name?: unknown };
    };
    const scopes = typeof token.scope === "string" ? token.scope.split(",").map(scope => scope.trim()) : [];
    if (typeof token.access_token !== "string" || !scopes.includes("ACTIVITY:READ")) {
      throw new Error("The required activity read permission was not granted.");
    }
    const sessionId = createIntervalsSession(
      token.access_token,
      typeof token.athlete?.name === "string" ? token.athlete.name : "Intervals.icu athlete",
    );
    const response = NextResponse.redirect(home(config.redirectUri, "connected"));
    response.cookies.delete(INTERVALS_STATE_COOKIE);
    response.cookies.set(INTERVALS_SESSION_COOKIE, sessionId, cookieOptions());
    return response;
  } catch (error) {
    console.error("Intervals.icu OAuth exchange failed", error instanceof Error ? error.message : "Unknown error");
    const response = NextResponse.redirect(home(config.redirectUri, "token_exchange_failed"));
    response.cookies.delete(INTERVALS_STATE_COOKIE);
    return response;
  }
}
