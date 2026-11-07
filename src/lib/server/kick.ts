import "server-only";
import { isKickExpired } from "@/lib/kick";
import { db, ROOM_COLUMNS, type RoomRow, T } from "./db";
import { fail } from "./http";
import { removePlayer } from "./membership";

/** Clears every pending kick in the room (new game / back to the lobby). */
export async function clearPendingKicks(roomId: string): Promise<void> {
  const { error } = await db()
    .from(T.players)
    .update({ kick_requested_at: null })
    .eq("room_id", roomId)
    .not("kick_requested_at", "is", null);
  if (error) throw error;
}

/**
 * Lazy enforcement (serverless, no timers): removes players whose pending kick has expired, exactly like
 * an immediate kick (removePlayer). Each removal is claimed with a conditional update so concurrent
 * requests never remove the same player twice. Returns the room as it is afterwards.
 */
export async function enforceExpiredKicks(room: RoomRow): Promise<RoomRow> {
  const { data, error } = await db()
    .from(T.players)
    .select("id, kick_requested_at")
    .eq("room_id", room.id)
    .not("kick_requested_at", "is", null);
  if (error) throw error;
  const now = Date.now();
  const expired = (data ?? []).filter((p) => isKickExpired(p.kick_requested_at as string, now));
  if (expired.length === 0) return room;

  let current = room;
  for (const p of expired) {
    const { data: claimed, error: claimError } = await db()
      .from(T.players)
      .update({ kick_requested_at: null })
      .eq("id", p.id)
      .eq("kick_requested_at", p.kick_requested_at)
      .select("id");
    if (claimError) throw claimError;
    if (!claimed || claimed.length === 0) continue; // someone else got it (or it was ignored)
    const { roomClosed } = await removePlayer(current, p.id as string, "player_kicked");
    if (roomClosed) fail(404, "Camera nu mai există.");
    const { data: fresh, error: roomError } = await db().from(T.rooms).select(ROOM_COLUMNS).eq("id", room.id).maybeSingle();
    if (roomError) throw roomError;
    if (!fresh) fail(404, "Camera nu mai există.");
    current = fresh as RoomRow;
  }
  return current;
}
