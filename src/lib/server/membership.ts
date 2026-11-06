import "server-only";
import { removeFromRound } from "@/lib/remi";
import { notifyRoom } from "./broadcast";
import { db, type RoomRow, T } from "./db";
import { applyMove, listPlayers } from "./room";

/**
 * Removes a player from a room (used by both "leave" and the host's "kick").
 *  - last player out: the room is deleted
 *  - host removed: host passes to the next player in join order
 *  - mid-round: their hand leaves with them, the turn moves on; with fewer than 2 players
 *    left the round is cancelled (no points)
 */
export async function removePlayer(room: RoomRow, playerId: string, reason: string): Promise<{ roomClosed: boolean }> {
  const remaining = (await listPlayers(room.id)).filter((p) => p.id !== playerId);

  if (remaining.length === 0) {
    const { error } = await db().from(T.rooms).delete().eq("id", room.id);
    if (error) throw error;
    return { roomClosed: true };
  }

  if (room.status === "playing") await applyMove(room, (s) => removeFromRound(s, playerId));

  const newHostId = room.host_player_id === playerId ? remaining[0].id : room.host_player_id;
  const now = new Date().toISOString();
  const { error: roomError } = await db()
    .from(T.rooms)
    .update({ host_player_id: newHostId, updated_at: now, last_activity_at: now })
    .eq("id", room.id);
  if (roomError) throw roomError;

  if (newHostId && newHostId !== room.host_player_id) {
    const { error } = await db().from(T.players).update({ is_host: true }).eq("id", newHostId);
    if (error) throw error;
  }

  const { error: deleteError } = await db().from(T.players).delete().eq("id", playerId);
  if (deleteError) throw deleteError;

  await notifyRoom(room.id, reason);
  return { roomClosed: false };
}
