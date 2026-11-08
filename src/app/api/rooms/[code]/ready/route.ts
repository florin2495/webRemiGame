import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { handle, readJson } from "@/lib/server/http";
import { requireMember, requireStatus, touchRoom, requirePlayer } from "@/lib/server/room";

// POST /api/rooms/[code]/ready  { ready: boolean } - lobby only.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/ready">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requirePlayer(player);
    requireStatus(room, "lobby");
    const body = await readJson(req);
    const ready = body.ready !== false;
    const { error } = await db().from(T.players).update({ ready }).eq("id", player.id);
    if (error) throw error;
    await touchRoom(room.id);
    await notifyRoom(room.id, "ready");
    return { ok: true };
  });
}
