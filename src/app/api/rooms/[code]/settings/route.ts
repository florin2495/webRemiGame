import { MELD_OPTIONS } from "@/lib/remi";
import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { requireHost, requireMember, requireStatus } from "@/lib/server/room";

// POST /api/rooms/[code]/settings  { minMeld } - host, lobby. Resets every "ready".
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/settings">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "lobby");
    const body = await readJson(req);
    const minMeld = Number(body.minMeld);
    if (!(MELD_OPTIONS as readonly number[]).includes(minMeld)) fail(400, "Etalarea minimă nu e validă.");
    if (minMeld === room.min_meld) return { ok: true };

    const now = new Date().toISOString();
    const { error } = await db()
      .from(T.rooms)
      .update({ min_meld: minMeld, updated_at: now, last_activity_at: now })
      .eq("id", room.id)
      .eq("status", "lobby");
    if (error) throw error;
    const { error: readyError } = await db().from(T.players).update({ ready: false }).eq("room_id", room.id);
    if (readyError) throw readyError;
    await notifyRoom(room.id, "settings");
    return { ok: true };
  });
}
