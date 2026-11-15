import "server-only";
import { isTestRoom, playerKey, roundWinners } from "@/lib/leaderboard";
import { db } from "./db";
import type { RoundState } from "@/lib/remi";

const GAME = "remi";

/**
 * Reports a finished round to the hub's shared leaderboard (service key, like hub_feedback).
 * Idempotent: hub_leaderboard_rounds has PK (game, room_code, round_no), so a round is counted once.
 * Rooms made by the e2e tests (name "e2e-test-...") are never reported.
 * Never throws: a leaderboard hiccup must not break the game.
 */
export async function reportRound(
  room: { code: string; name: string },
  roundNo: number,
  result: NonNullable<RoundState["result"]>,
  nicknames: Record<string, string>,
): Promise<void> {
  if (isTestRoom(room.name)) return;
  const roomCode = room.code;
  try {
    if (result.cancelled) return;
    const ids = Object.keys(result.points).filter((id) => nicknames[id]);
    if (ids.length === 0) return;

    const { error: markError } = await db()
      .from("hub_leaderboard_rounds")
      .insert({ game: GAME, room_code: roomCode, round_no: roundNo });
    if (markError) {
      if (markError.code !== "23505") console.error("leaderboard mark failed", markError);
      return; // already counted (23505) or table missing
    }

    const winners = new Set(roundWinners(result.closerId, result.points));
    // Same nickname twice in a room is impossible (unique index), but keys may still collide only across rooms.
    const keys = ids.map((id) => playerKey(nicknames[id]));
    const { data, error: readError } = await db()
      .from("hub_leaderboard")
      .select("player_key, wins, games")
      .eq("game", GAME)
      .in("player_key", keys);
    if (readError) throw readError;
    const current = new Map((data ?? []).map((r) => [r.player_key as string, r as { wins: number; games: number }]));

    const rows = ids.map((id) => {
      const key = playerKey(nicknames[id]);
      const prev = current.get(key);
      return {
        game: GAME,
        player_key: key,
        display_name: nicknames[id].trim().slice(0, 40),
        wins: (prev?.wins ?? 0) + (winners.has(id) ? 1 : 0),
        games: (prev?.games ?? 0) + 1,
        updated_at: new Date().toISOString(),
      };
    });
    const { error } = await db().from("hub_leaderboard").upsert(rows, { onConflict: "game,player_key" });
    if (error) {
      // Let a later retry count this round: drop the marker.
      await db().from("hub_leaderboard_rounds").delete().eq("game", GAME).eq("room_code", roomCode).eq("round_no", roundNo);
      throw error;
    }
  } catch (err) {
    console.error("leaderboard report failed", err);
  }
}
