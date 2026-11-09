import { type Formation, playTurn } from "@/lib/remi";
import { notifyRoom } from "@/lib/server/broadcast";
import { fail, handle, readJson } from "@/lib/server/http";
import { applyMove, buildState, requireMember, requireStatus, requirePlayer } from "@/lib/server/room";

// POST /api/rooms/[code]/turn  { table: Formation[], discard: tileId, version }
// Ends the caller's turn. Everything is re-validated by playTurn (src/lib/remi.ts).
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/turn">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requirePlayer(player);
    requireStatus(room, "playing");
    const body = await readJson(req);
    if (!Array.isArray(body.table) || body.table.length > 60) fail(400, "Cerere invalidă.");
    const table: Formation[] = (body.table as unknown[]).map((f) => {
      if (!f || typeof f !== "object") fail(400, "Cerere invalidă.");
      const { id, owner, tiles } = f as Record<string, unknown>;
      if (typeof id !== "string" || typeof owner !== "string" || !Array.isArray(tiles)) fail(400, "Cerere invalidă.");
      return { id, owner, tiles: tiles as number[] };
    });
    const discard = body.discard;
    if (typeof discard !== "number" || !Number.isInteger(discard)) fail(400, "Alege piesa pe care o arunci.");
    const version = Number.isInteger(body.version) ? (body.version as number) : undefined;
    const next = await applyMove(room, (s) => playTurn(s, player.id, table, discard), version);
    // The caller gets the new state in the response (no /state afterwards).
    const state = await buildState({ ...room, status: next.result ? "finished" : room.status }, player);
    await notifyRoom(room.id, next.result ? "round_over" : "turn", state.version === null ? undefined : { round: room.round, version: state.version });
    return { ok: true, closed: next.result?.closerId === player.id, state };
  });
}
