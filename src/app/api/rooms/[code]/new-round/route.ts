import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle } from "@/lib/server/http";
import { requireHost, requireMember, requireStatus } from "@/lib/server/room";

// POST /api/rooms/[code]/new-round - host, after a round. Back to the lobby, everyone un-ready.
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
    const { error: readyError } = await db().from(T.players).update({ ready: false }).eq("room_id", room.id);
    if (readyError) throw readyError;

    await notifyRoom(room.id, "new_round");
    return { ok: true };
  });
}
