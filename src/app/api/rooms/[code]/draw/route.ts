import { draw } from "@/lib/remi";
import { notifyRoom } from "@/lib/server/broadcast";
import { fail, handle, readJson } from "@/lib/server/http";
import { applyMove, requireMember, requireStatus } from "@/lib/server/room";

// POST /api/rooms/[code]/draw  { source: "pile" | "discard", version }
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/draw">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireStatus(room, "playing");
    const body = await readJson(req);
    const source = body.source;
    if (source !== "pile" && source !== "discard") fail(400, "Cerere invalidă.");
    const version = Number.isInteger(body.version) ? (body.version as number) : undefined;
    const next = await applyMove(room, (s) => draw(s, player.id, source), version);
    await notifyRoom(room.id, next.result ? "round_over" : "draw");
    return { ok: true };
  });
}
