import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const INTERVALS_SESSION_COOKIE = "ridemapclip_intervals_session";
export const INTERVALS_STATE_COOKIE = "ridemapclip_intervals_state";

type Session = {
  accessToken: string;
  athleteName: string;
  createdAt: number;
};

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export function intervalsConfig(): { clientId: string; clientSecret: string; redirectUri: string; sessionSecret: string } | null {
  // OAuth is parked for the API-key release. Uncomment to restore configuration.
  return null;
  /*
  const clientId = process.env.INTERVALS_CLIENT_ID?.trim();
  const clientSecret = process.env.INTERVALS_CLIENT_SECRET?.trim();
  const redirectUri = process.env.INTERVALS_REDIRECT_URI?.trim();
  const sessionSecret = process.env.INTERVALS_SESSION_SECRET?.trim();
  if (!clientId || !clientSecret || !redirectUri || !sessionSecret || sessionSecret.length < 32) return null;
  try {
    const parsedRedirect = new URL(redirectUri);
    if (!(["http:", "https:"] as string[]).includes(parsedRedirect.protocol)) return null;
    if (process.env.NODE_ENV === "production" && parsedRedirect.protocol !== "https:") return null;
    return { clientId, clientSecret, redirectUri: parsedRedirect.toString(), sessionSecret };
  } catch {
    return null;
  }
  */
}

function sessionKey(): Buffer | null {
  const secret = intervalsConfig()?.sessionSecret;
  return secret ? createHash("sha256").update(secret).digest() : null;
}

export function createIntervalsSession(accessToken: string, athleteName: string): string {
  const key = sessionKey();
  if (!key) throw new Error("Intervals.icu session encryption is not configured.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify({ accessToken, athleteName, createdAt: Date.now() } satisfies Session));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function getIntervalsSession(value: string | undefined): Session | null {
  const key = sessionKey();
  if (!value || !key) return null;
  try {
    const sealed = Buffer.from(value, "base64url");
    if (sealed.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
    decipher.setAuthTag(sealed.subarray(12, 28));
    const session = JSON.parse(Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]).toString()) as Session;
    if (typeof session.accessToken !== "string" || typeof session.athleteName !== "string" ||
        typeof session.createdAt !== "number" || Date.now() - session.createdAt > SESSION_TTL_MS) return null;
    return session;
  } catch {
    return null;
  }
}

export function cookieOptions(maxAge = 30 * 24 * 60 * 60) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}
