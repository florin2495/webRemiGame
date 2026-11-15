// Pure helpers for reporting a finished round to the hub leaderboard (hub_leaderboard, contract C).

/** Rooms created by the e2e tests (scripts/e2e.mjs, tests/ui) never reach the shared leaderboard. */
export function isTestRoom(roomName: string): boolean {
  return roomName.startsWith("e2e-test-");
}

/** player_key = nickname trimmed + lowercased (no accounts: same nickname = same person). */
export function playerKey(nickname: string): string {
  return nickname.trim().toLowerCase().slice(0, 40);
}

/**
 * Winners of a finished (not cancelled) round: whoever closed; if nobody closed (the pile ran out),
 * the lowest score (ties all win). `points` is keyed by player id.
 */
export function roundWinners(closerId: string | null, points: Record<string, number>): string[] {
  if (closerId !== null && closerId in points) return [closerId];
  const ids = Object.keys(points);
  if (ids.length === 0) return [];
  const best = Math.min(...ids.map((id) => points[id]));
  return ids.filter((id) => points[id] === best);
}
