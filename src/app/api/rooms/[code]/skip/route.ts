import { skipTurn } from "@/lib/remi";
import { notifyRoom } from "@/lib/server/broadcast";
import { handle } from "@/lib/server/http";
import { applyMove, requireHost, requireMember, requireStatus } from "@/lib/server/room";

// POST /api/rooms/[code]/skip - host passes the turn of a player who stopped responding.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/skip">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "playing");
    await applyMove(room, skipTurn);
    await notifyRoom(room.id, "skip");
    return { ok: true };
  });
}
