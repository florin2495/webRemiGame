import { deal, MAX_PLAYERS, MIN_PLAYERS, roundTurnOrder } from "@/lib/remi";
import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle, isUniqueViolation } from "@/lib/server/http";
import { listPlayers, requireHost, requireMember, requireStatus } from "@/lib/server/room";

// POST /api/rooms/[code]/start - host only, everyone ready, 2-4 players. Deals the tiles.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/start">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "lobby");

    const players = await listPlayers(room.id);
    if (players.length < MIN_PLAYERS) fail(409, `Ai nevoie de cel puțin ${MIN_PLAYERS} jucători.`);
    if (players.length > MAX_PLAYERS) fail(409, `Pot juca cel mult ${MAX_PLAYERS} jucători.`);
    const notReady = players.filter((p) => !p.ready);
    if (notReady.length > 0) fail(409, `Nu sunt toți gata: ${notReady.map((p) => p.nickname).join(", ")}.`);

    const order = roundTurnOrder(
      players.map((p) => p.id),
      room.host_player_id,
      room.round,
    );
    // The (room, round) primary key makes a double start impossible.
    const { error: roundError } = await db()
      .from(T.rounds)
      .insert({ room_id: room.id, round: room.round, state: deal(order, room.min_meld) });
    if (isUniqueViolation(roundError)) fail(409, "Runda a fost deja pornită.");
    if (roundError) throw roundError;

    const now = new Date().toISOString();
    const { error } = await db()
      .from(T.rooms)
      .update({ status: "playing", updated_at: now, last_activity_at: now })
      .eq("id", room.id)
      .eq("status", "lobby");
    if (error) throw error;

    await notifyRoom(room.id, "game_started");
    return { ok: true };
  });
}
