import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { requireMember, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/queue  { queued?: boolean } - a spectator toggles "Intră la runda următoare".
// With `queued` omitted it flips the current value. At the next new round the queue becomes players, in queue order,
// while seats are free (see new-round).
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/queue">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    if (player.role !== "spectator") fail(409, "Ești deja jucător în cameră.");
    const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
    const queued = typeof body.queued === "boolean" ? body.queued : player.queued_at === null;

    const { error } = await db()
      .from(T.players)
      .update({ queued_at: queued ? new Date().toISOString() : null })
      .eq("id", player.id);
    if (error) throw error;
    await touchRoom(room.id);
    await notifyRoom(room.id, "queue");
    return { ok: true, queued };
  });
}
