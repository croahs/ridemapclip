import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookieOptions, intervalsConfig, INTERVALS_STATE_COOKIE } from "@/lib/intervals-session";

export const runtime = "nodejs";

export async function GET() {
  const config = intervalsConfig();
  if (!config) {
    return NextResponse.json({ error: "Intervals.icu is not configured on this server." }, { status: 503 });
  }
  const state = randomBytes(32).toString("base64url");
  const authorize = new URL("https://intervals.icu/oauth/authorize");
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("redirect_uri", config.redirectUri);
  authorize.searchParams.set("scope", "ACTIVITY:READ");
  authorize.searchParams.set("state", state);

  const response = NextResponse.redirect(authorize);
  response.cookies.set(INTERVALS_STATE_COOKIE, state, cookieOptions(10 * 60));
  return response;
}
