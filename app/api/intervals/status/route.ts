import { NextResponse, type NextRequest } from "next/server";
import { getIntervalsSession, intervalsConfig, INTERVALS_SESSION_COOKIE } from "@/lib/intervals-session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = getIntervalsSession(request.cookies.get(INTERVALS_SESSION_COOKIE)?.value);
  return NextResponse.json({
    configured: Boolean(intervalsConfig()),
    connected: Boolean(session),
    athleteName: session?.athleteName ?? null,
  }, { headers: { "Cache-Control": "no-store" } });
}
