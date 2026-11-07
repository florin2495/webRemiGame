/** Pending kick during a running game: the target has KICK_GRACE_MS to press "Ignoră". Pure helpers. */
export const KICK_GRACE_MS = 10_000;
/** Server-side slack on top of the grace period (network latency) before a pending kick is enforced. */
export const KICK_NETWORK_GRACE_MS = 2_000;

function toMs(t: string | number | Date): number {
  return t instanceof Date ? t.getTime() : typeof t === "number" ? t : new Date(t).getTime();
}

/** Milliseconds left to ignore a pending kick, clamped to [0, KICK_GRACE_MS]; null if no kick is pending. */
export function kickRemainingMs(requestedAt: string | number | Date | null, now: number): number | null {
  if (requestedAt === null) return null;
  const left = toMs(requestedAt) + KICK_GRACE_MS - now;
  if (Number.isNaN(left)) return null;
  return Math.min(KICK_GRACE_MS, Math.max(0, left));
}

/** True once the pending kick can no longer be ignored and must be enforced (grace + network slack). */
export function isKickExpired(requestedAt: string | number | Date, now: number): boolean {
  return now - toMs(requestedAt) > KICK_GRACE_MS + KICK_NETWORK_GRACE_MS;
}
