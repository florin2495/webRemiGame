import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { MAX_PLAYERS } from "@/lib/remi";
import { promotable } from "@/lib/seats";
import { fail, handle } from "@/lib/server/http";
import { listPlayers, listSpectators, requireHost, requireMember, requireStatus } from "@/lib/server/room";

// POST /api/rooms/[code]/new-round - host, after a round. Back to the lobby, everyone un-ready, queued spectators become players.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/new-round">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "finished");

    const now = new Date().toISOString();
    const { data, error } = await db()
      .from(T.rooms)
      .update({ status: "lobby", round: room.round + 1, updated_at: now, last_activity_at: now })
      .eq("id", room.id)
      .eq("status", "finished")
      .eq("round", room.round)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) fail(409, "Runda nouă a fost deja pornită.");
    const { error: readyError } = await db()
      .from(T.players)
      .update({ ready: false, kick_requested_at: null })
      .eq("room_id", room.id);
    if (readyError) throw readyError;

    // Queued spectators sit down in queue order while there are free seats; the rest keep watching.
    const players = await listPlayers(room.id);
    const queue = promotable(
      (await listSpectators(room.id)).map((s) => ({ id: s.id, queuedAt: s.queued_at })),
      MAX_PLAYERS - players.length,
    );
    let seat = Math.max(-1, ...players.map((p) => p.seat ?? -1)) + 1;
    for (const s of queue) {
      const { error: promoteError } = await db()
        .from(T.players)
        .update({ role: "player", seat: seat++, queued_at: null, ready: false })
        .eq("id", s.id)
        .eq("role", "spectator");
      if (promoteError) throw promoteError;
    }

    await notifyRoom(room.id, "new_round");
    return { ok: true };
  });
}
