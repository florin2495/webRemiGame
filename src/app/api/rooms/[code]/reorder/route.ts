import { isPermutation } from "@/lib/seats";
import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { listPlayers, requireHost, requireMember, requireStatus, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/reorder  { order: [playerId, ...] } - host only, lobby (= between rounds).
// `order` must be a full permutation of the seated players (spectators are not part of it). It is the play
// order: round 1 starts with the first one, then the starter rotates by one seat per round.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/reorder">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "lobby");

    const body = await readJson(req);
    const players = await listPlayers(room.id);
    const ids = players.map((p) => p.id);
    if (!isPermutation(body.order, ids)) fail(400, "Ordinea trebuie să conțină toți jucătorii, o singură dată.");
    const order = body.order as string[];

    const results = await Promise.all(
      order.map((id, seat) => db().from(T.players).update({ seat }).eq("id", id).eq("room_id", room.id)),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) throw failed.error;

    await touchRoom(room.id);
    await notifyRoom(room.id, "reorder");
    return { ok: true };
  });
}
