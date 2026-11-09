import { draw } from "@/lib/remi";
import { notifyRoom } from "@/lib/server/broadcast";
import { fail, handle, readJson } from "@/lib/server/http";
import { applyMove, buildState, requireMember, requireStatus, requirePlayer } from "@/lib/server/room";

// POST /api/rooms/[code]/draw  { source: "pile" | "discard", version }
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/draw">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requirePlayer(player);
    requireStatus(room, "playing");
    const body = await readJson(req);
    const source = body.source;
    if (source !== "pile" && source !== "discard") fail(400, "Cerere invalidă.");
    const version = Number.isInteger(body.version) ? (body.version as number) : undefined;
    const next = await applyMove(room, (s) => draw(s, player.id, source), version);
    // The caller gets the new state in the response (no /state afterwards).
    const state = await buildState({ ...room, status: next.result ? "finished" : room.status }, player);
    await notifyRoom(room.id, next.result ? "round_over" : "draw", state.version === null ? undefined : { round: room.round, version: state.version });
    return { ok: true, state };
  });
}
