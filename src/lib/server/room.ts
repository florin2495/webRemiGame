import "server-only";
import { isRoomExpired, minutesLabel, ROOM_IDLE_MINUTES, type RoundState, RuleError } from "@/lib/remi";
import { kickRemainingMs } from "@/lib/kick";
import { isConnected, LAST_SEEN_TOUCH_MS } from "@/lib/reconnect";
import type { PublicPlayer, RoomState } from "@/lib/types";
import { hashToken } from "./crypto";
import { db, PLAYER_COLUMNS, type PlayerRow, ROOM_COLUMNS, type RoomRow, T } from "./db";
import { fail } from "./http";
import { enforceExpiredKicks } from "./kick";
import { reportRound } from "./leaderboard";

const GONE = `Camera nu există sau a fost închisă după ${minutesLabel(ROOM_IDLE_MINUTES)} de inactivitate.`;

export function normalizeCode(code: string): string {
  const c = decodeURIComponent(code).trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(c)) fail(404, GONE);
  return c;
}

export async function getRoomByCode(code: string): Promise<RoomRow> {
  const { data, error } = await db().from(T.rooms).select(ROOM_COLUMNS).eq("code", normalizeCode(code)).maybeSingle();
  if (error) throw error;
  if (!data) fail(404, GONE);
  const room = data as RoomRow;
  // Lazy expiry: Vercel Hobby has no frequent cron, so idle rooms are closed when touched.
  if (isRoomExpired(room.status, room.last_activity_at)) {
    await db().from(T.rooms).delete().eq("id", room.id).eq("last_activity_at", room.last_activity_at);
    fail(404, GONE);
  }
  return room;
}

/** Deletes every lobby/finished room idle for longer than ROOM_IDLE_MINUTES. */
export async function cleanupExpiredRooms(): Promise<void> {
  const cutoff = new Date(Date.now() - ROOM_IDLE_MINUTES * 60_000).toISOString();
  const { error } = await db().from(T.rooms).delete().in("status", ["lobby", "finished"]).lt("last_activity_at", cutoff);
  if (error) console.error("cleanup failed", error);
}

export async function touchRoom(roomId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db().from(T.rooms).update({ last_activity_at: now, updated_at: now }).eq("id", roomId);
  if (error) throw error;
}

/** Resolves the caller from the x-player-token header and checks they belong to the room. */
export async function requireMember(req: Request, code: string): Promise<{ room: RoomRow; player: PlayerRow }> {
  const token = req.headers.get("x-player-token");
  if (!token || token.length > 200) fail(401, "Nu ești în această cameră.");
  const room = await enforceExpiredKicks(await getRoomByCode(code));
  const { data, error } = await db()
    .from(T.players)
    .select(PLAYER_COLUMNS)
    .eq("token_hash", hashToken(token))
    .eq("room_id", room.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) fail(401, "Nu ești în această cameră.");
  const player = data as PlayerRow;
  await touchPlayer(player);
  return { room, player };
}

/** Presence heartbeat: stamps last_seen_at at most every LAST_SEEN_TOUCH_MS. Best effort, never throws. */
async function touchPlayer(player: PlayerRow): Promise<void> {
  const now = Date.now();
  if (now - Date.parse(player.last_seen_at) < LAST_SEEN_TOUCH_MS) return;
  player.last_seen_at = new Date(now).toISOString();
  const { error } = await db().from(T.players).update({ last_seen_at: player.last_seen_at }).eq("id", player.id);
  if (error) console.error("presence touch failed", error);
}

export function requireHost(room: RoomRow, player: PlayerRow) {
  if (room.host_player_id !== player.id) fail(403, "Doar creatorul camerei poate face asta.");
}

export function requireStatus(room: RoomRow, ...allowed: RoomRow["status"][]) {
  if (!allowed.includes(room.status)) {
    const msg: Record<RoomRow["status"], string> = {
      lobby: "Runda nu a început încă.",
      playing: "Runda este în desfășurare.",
      finished: "Runda s-a terminat.",
    };
    fail(409, msg[room.status]);
  }
}

/** Seated players in the host-chosen order (unplaced ones last, by join time). Spectators are not included. */
export async function listPlayers(roomId: string): Promise<PlayerRow[]> {
  const { data, error } = await db()
    .from(T.players)
    .select(PLAYER_COLUMNS)
    .eq("room_id", roomId)
    .eq("role", "player")
    .order("seat", { ascending: true, nullsFirst: false })
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlayerRow[];
}

/** Spectators, oldest first. */
export async function listSpectators(roomId: string): Promise<PlayerRow[]> {
  const { data, error } = await db()
    .from(T.players)
    .select(PLAYER_COLUMNS)
    .eq("room_id", roomId)
    .eq("role", "spectator")
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlayerRow[];
}

/** Spectators cannot act: ready, draw, turn, skip. */
export function requirePlayer(player: PlayerRow) {
  if (player.role !== "player") fail(403, "Ești spectator. Poți intra în joc la runda următoare.");
}

export async function getRound(roomId: string, round: number): Promise<{ version: number; state: RoundState } | null> {
  const { data, error } = await db()
    .from(T.rounds)
    .select("version, state")
    .eq("room_id", roomId)
    .eq("round", round)
    .maybeSingle();
  if (error) throw error;
  return data ? { version: data.version as number, state: data.state as RoundState } : null;
}

/** Conditional write: succeeds only if nobody changed the round since it was read. */
export async function saveRound(roomId: string, round: number, version: number, state: RoundState): Promise<boolean> {
  const { data, error } = await db()
    .from(T.rounds)
    .update({ state, version: version + 1, updated_at: new Date().toISOString() })
    .eq("room_id", roomId)
    .eq("round", round)
    .eq("version", version)
    .select("round");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * Applies a pure rule function to the current round and saves it. A RuleError becomes a 409 with
 * its message. `expectedVersion` (sent by the client) rejects moves made on a stale screen.
 * When the round ends, the room moves to "finished".
 */
export async function applyMove(
  room: RoomRow,
  move: (s: RoundState) => RoundState,
  expectedVersion?: number,
  retries = 0,
): Promise<RoundState> {
  const current = await getRound(room.id, room.round);
  if (!current) fail(409, "Runda nu a început încă.");
  if (expectedVersion !== undefined && expectedVersion !== current.version) {
    fail(409, "Masa s-a schimbat între timp. Uită-te din nou și reîncearcă.");
  }
  let next: RoundState;
  try {
    next = move(current.state);
  } catch (err) {
    if (err instanceof RuleError) fail(409, err.message);
    throw err;
  }
  if (!(await saveRound(room.id, room.round, current.version, next))) {
    if (expectedVersion === undefined && retries < 3) return applyMove(room, move, undefined, retries + 1);
    fail(409, "Masa s-a schimbat între timp. Uită-te din nou și reîncearcă.");
  }
  const now = new Date().toISOString();
  const update: Record<string, unknown> = { last_activity_at: now, updated_at: now };
  if (next.result) update.status = "finished";
  const { error } = await db().from(T.rooms).update(update).eq("id", room.id).eq("round", room.round);
  if (error) throw error;
  if (next.result && !current.state.result) {
    const nicknames = Object.fromEntries((await listPlayers(room.id)).map((p) => [p.id, p.nickname]));
    await reportRound(room.code, room.round, next.result, nicknames);
  }
  return next;
}

async function history(roomId: string): Promise<RoomState["history"]> {
  const { data, error } = await db()
    .from(T.rounds)
    .select("round, result:state->result")
    .eq("room_id", roomId)
    .order("round", { ascending: true });
  if (error) throw error;
  return (data ?? [])
    .filter((r) => r.result && !(r.result as { cancelled?: boolean }).cancelled)
    .map((r) => ({ round: r.round as number, points: (r.result as { points: Record<string, number> }).points }));
}

export async function buildState(room: RoomRow, me: PlayerRow): Promise<RoomState> {
  const [players, spectators, round, hist] = await Promise.all([
    listPlayers(room.id),
    listSpectators(room.id),
    room.status === "lobby" ? Promise.resolve(null) : getRound(room.id, room.round),
    history(room.id),
  ]);

  const totals = new Map<string, number>();
  for (const h of hist) for (const [id, p] of Object.entries(h.points)) totals.set(id, (totals.get(id) ?? 0) + p);

  const now = Date.now();
  const s = round?.state ?? null;
  let ordered = players;
  if (s) {
    const pos = new Map(s.order.map((id, i) => [id, i]));
    ordered = [...players].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  }
  const toPublic = (p: PlayerRow): PublicPlayer => ({
    id: p.id,
    nickname: p.nickname,
    isHost: p.is_host,
    ready: p.ready,
    total: totals.get(p.id) ?? 0,
    kickRemainingMs: kickRemainingMs(p.kick_requested_at, now),
    connected: isConnected(p.last_seen_at, now),
  });
  const myHand = s?.hands[me.id] ?? null;

  return {
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      minMeld: room.min_meld,
      status: room.status,
      round: room.round,
      hasPassword: room.password_hash !== null,
      hostPlayerId: room.host_player_id,
    },
    players: ordered.map(toPublic),
    me: toPublic(me),
    role: me.role,
    queued: me.role === "spectator" && me.queued_at !== null,
    spectators: spectators.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      queued: p.queued_at !== null,
      connected: isConnected(p.last_seen_at, now),
    })),
    game: s
      ? {
          order: s.order,
          currentPlayerId: s.result ? null : (s.order[s.turn] ?? null),
          phase: s.phase,
          pileCount: s.pile.length,
          discardTop: s.discard.at(-1) ?? null,
          discardCount: s.discard.length,
          table: s.table,
          handCounts: Object.fromEntries(Object.entries(s.hands).map(([id, h]) => [id, h.tiles.length])),
          melded: Object.fromEntries(Object.entries(s.hands).map(([id, h]) => [id, h.melded])),
          result: s.result,
        }
      : null,
    hand: myHand ? myHand.tiles : null,
    mustUse: myHand?.mustUse ?? null,
    version: round?.version ?? null,
    history: hist,
  };
}
