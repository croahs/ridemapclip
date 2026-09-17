import { NextResponse, type NextRequest } from "next/server";
import { getIntervalsSession, INTERVALS_SESSION_COOKIE } from "@/lib/intervals-session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const sessionId = request.cookies.get(INTERVALS_SESSION_COOKIE)?.value;
  const session = getIntervalsSession(sessionId);
  let warning: string | null = null;
  if (session) {
    try {
      const response = await fetch("https://intervals.icu/api/v1/disconnect-app", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.accessToken}` },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok && response.status !== 401) warning = "The local connection was cleared, but Intervals.icu could not confirm revocation.";
    } catch {
      warning = "The local connection was cleared, but Intervals.icu could not confirm revocation.";
    }
  }
  const response = NextResponse.json({ ok: true, warning }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.delete(INTERVALS_SESSION_COOKIE);
  return response;
}
