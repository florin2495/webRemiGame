import { describe, expect, it } from "vitest";
import { isKickExpired, KICK_GRACE_MS, kickRemainingMs } from "./kick";

const T0 = Date.parse("2026-01-01T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("kickRemainingMs", () => {
  it("is null without a pending kick", () => expect(kickRemainingMs(null, T0)).toBeNull());
  it("counts down from the full grace period", () => {
    expect(kickRemainingMs(iso(T0), T0)).toBe(KICK_GRACE_MS);
    expect(kickRemainingMs(iso(T0), T0 + 4_000)).toBe(6_000);
  });
  it("clamps to [0, KICK_GRACE_MS]", () => {
    expect(kickRemainingMs(iso(T0), T0 + 60_000)).toBe(0);
    expect(kickRemainingMs(iso(T0 + 5_000), T0)).toBe(KICK_GRACE_MS); // clock skew: request in the future
  });
});

describe("isKickExpired", () => {
  it("is false within grace plus network slack", () => {
    expect(isKickExpired(iso(T0), T0 + 10_000)).toBe(false);
    expect(isKickExpired(iso(T0), T0 + 12_000)).toBe(false);
  });
  it("is true after it", () => expect(isKickExpired(iso(T0), T0 + 12_001)).toBe(true));
});
