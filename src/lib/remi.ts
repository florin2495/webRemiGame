// Pure Remi (pe tablă) rules - shared by server and client, no I/O.
//
// 106 tiles: numbers 1-13 in 4 colours, two copies each (104), plus 2 jokers.
// Tile id 0..103: copy = id >= 52, k = id % 52, colour = floor(k / 13), number = k % 13 + 1.
// Tile id 104, 105: jokers.

export const TILE_COUNT = 106;
export const JOKERS = [104, 105] as const;
export const HAND_SIZE = 14;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const NICKNAME_MAX = 10;
export const MELD_OPTIONS = [30, 45, 51, 60] as const;
export const MELD_DEFAULT = 45;

/** Points. A closer gets a bonus (negative), the others a penalty. Lowest total wins. */
export const CLOSE_BONUS = -50;
export const CLOSE_FROM_HAND_BONUS = -100;
export const NOT_MELDED_PENALTY = 100;
export const JOKER_PENALTY = 50;

/** Lobby/finished rooms idle this long are deleted. */
export const ROOM_IDLE_MINUTES = 10;
export const PRESENCE_TOUCH_MS = 20_000;

export function minutesLabel(n: number): string {
  return `${n} ${n >= 20 ? "de " : ""}${n === 1 ? "minut" : "minute"}`;
}

export function isRoomExpired(status: string, lastActivityAt: string | Date, now = Date.now()): boolean {
  if (status !== "lobby" && status !== "finished") return false;
  return now - new Date(lastActivityAt).getTime() > ROOM_IDLE_MINUTES * 60_000;
}

/**
 * A room in any status (also "playing") is abandoned once its last activity is older than this AND no
 * player or spectator has been seen within it. Swept every time the room list loads (GET /api/rooms).
 */
export const ROOM_ABANDONED_MS = 120_000;

export function isRoomAbandoned(
  lastActivityAt: string | Date,
  membersLastSeen: (string | Date | null | undefined)[],
  now = Date.now(),
): boolean {
  const recent = (t: string | Date | null | undefined) => {
    if (t === null || t === undefined) return false;
    const ms = new Date(t).getTime();
    return !Number.isNaN(ms) && now - ms <= ROOM_ABANDONED_MS;
  };
  return !recent(lastActivityAt) && !membersLastSeen.some(recent);
}

export type Colour = 0 | 1 | 2 | 3;
export const COLOUR_NAMES = ["roșu", "galben", "albastru", "negru"] as const;

export const isTile = (t: unknown): t is number => Number.isInteger(t) && (t as number) >= 0 && (t as number) < TILE_COUNT;
export const isJoker = (t: number) => t >= 104;
export const colourOf = (t: number): Colour => (Math.floor((t % 52) / 13) as Colour);
export const numberOf = (t: number) => (t % 52) % 13 + 1;

/** Penalty value of a tile left in hand. */
export const handValue = (t: number) => (isJoker(t) ? JOKER_PENALTY : numberOf(t));

export function shuffledDeck(random: () => number = Math.random): number[] {
  const deck = Array.from({ length: TILE_COUNT }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ---------------------------------------------------------------------------
// Formations
// ---------------------------------------------------------------------------

export type FormationKind = "group" | "run";

export interface Formation {
  /** Stable id, chosen by the client that creates it. */
  id: string;
  /** Player who laid it down (may have left the room since). */
  owner: string;
  /** Tiles in display order. For runs: ascending, jokers sit where they stand in. */
  tiles: number[];
}

/**
 * Checks a formation in the given order and returns its kind and point value, or null if invalid.
 *  - group: 3-4 tiles, same number, all colours different (jokers fill in).
 *  - run: 3+ tiles of one colour in ascending order, jokers fill gaps. The ace (1) can be low
 *    (1-2-3) or high after the king (12-13-1, worth 14), never both. No wrap-around.
 */
export function checkFormation(tiles: readonly number[]): { kind: FormationKind; value: number } | null {
  if (tiles.length < 3 || new Set(tiles).size !== tiles.length || !tiles.every(isTile)) return null;
  const real = tiles.filter((t) => !isJoker(t));
  if (real.length === 0) return null;
  // A single real tile with jokers can read both ways: count the better one.
  const g = checkGroup(tiles, real);
  const r = checkRun(tiles);
  if (g && r) return r.value > g.value ? r : g;
  return g ?? r;
}

function checkGroup(tiles: readonly number[], real: number[]) {
  if (tiles.length > 4) return null;
  const n = numberOf(real[0]);
  if (!real.every((t) => numberOf(t) === n)) return null;
  if (new Set(real.map(colourOf)).size !== real.length) return null;
  return { kind: "group" as const, value: n * tiles.length };
}

function checkRun(tiles: readonly number[]) {
  const first = tiles.findIndex((t) => !isJoker(t));
  const colour = colourOf(tiles[first]);
  // Position value of index 0. An ace at index `first` could mean 1 or 14; 14 only makes sense
  // when it is the last tile (12-13-A), which the general rule below handles via start.
  let start = numberOf(tiles[first]) - first;
  if (numberOf(tiles[first]) === 1 && first > 0) start = 14 - first; // e.g. J, J, A  ->  12,13,14
  if (start < 1 || start + tiles.length - 1 > 14) return null;
  let value = 0;
  for (let i = 0; i < tiles.length; i++) {
    const v = start + i;
    value += v;
    const t = tiles[i];
    if (isJoker(t)) continue;
    if (colourOf(t) !== colour || numberOf(t) !== (v === 14 ? 1 : v)) return null;
  }
  return { kind: "run" as const, value };
}

/**
 * Puts a set of tiles in a valid order if one exists (used by the client when the player
 * builds or extends a formation). Prefers a run that keeps jokers inside, then extends upwards.
 */
export function arrange(tiles: readonly number[]): number[] | null {
  if (tiles.length < 3 || new Set(tiles).size !== tiles.length) return null;
  const real = tiles.filter((t) => !isJoker(t));
  const jokers = tiles.filter(isJoker);
  if (real.length === 0) return null;

  // Group: order by colour for a tidy display, jokers last.
  const asGroup = [...real].sort((a, b) => colourOf(a) - colourOf(b)).concat(jokers);
  if (checkGroup(asGroup, real)) return asGroup;

  // Run: try the ace low and high.
  for (const aceHigh of [false, true]) {
    const pos = (t: number) => (numberOf(t) === 1 && aceHigh ? 14 : numberOf(t));
    const sorted = [...real].sort((a, b) => pos(a) - pos(b));
    const lo = pos(sorted[0]);
    const hi = pos(sorted[sorted.length - 1]);
    const span = hi - lo + 1;
    if (span < sorted.length) continue; // duplicate numbers
    const gaps = span - sorted.length;
    if (gaps > jokers.length) continue;
    const spare = jokers.length - gaps;
    // Spare jokers go above the top tile, then below the bottom one if the top is the ace.
    const above = Math.min(spare, 14 - hi);
    const below = spare - above;
    if (lo - below < 1) continue;
    const pool = [...jokers];
    const out: number[] = [];
    for (let i = 0; i < below; i++) out.push(pool.pop()!);
    let k = 0;
    for (let v = lo; v <= hi; v++) {
      if (k < sorted.length && pos(sorted[k]) === v) out.push(sorted[k++]);
      else out.push(pool.pop()!);
    }
    for (let i = 0; i < above; i++) out.push(pool.pop()!);
    if (checkRun(out)) return out;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Round state (kept server-side in remi_rounds.state; only parts are sent to clients)
// ---------------------------------------------------------------------------

export interface HandState {
  tiles: number[];
  /** Has laid down the first meld (etalare) in this round. */
  melded: boolean;
  /** Tile taken from the discard pile this turn: must be on the table when the turn ends. */
  mustUse: number | null;
}

export interface RoundResult {
  /** null = the pile ran out (or the round was cancelled) without anybody closing. */
  closerId: string | null;
  fromHand: boolean;
  cancelled: boolean;
  points: Record<string, number>;
  hands: Record<string, number[]>;
}

export interface RoundState {
  order: string[];
  turn: number;
  phase: "draw" | "play";
  /** Tile drawn from the pile this turn (used when the host skips a player mid-turn). */
  drawn: number | null;
  pile: number[];
  discard: number[];
  table: Formation[];
  hands: Record<string, HandState>;
  minMeld: number;
  result: RoundResult | null;
}

/** Deals a round. The first player gets 15 tiles and starts by discarding (phase "play"). */
export function deal(order: string[], minMeld: number, random: () => number = Math.random): RoundState {
  const pile = shuffledDeck(random);
  const hands: Record<string, HandState> = {};
  order.forEach((id, i) => {
    hands[id] = { tiles: pile.splice(0, i === 0 ? HAND_SIZE + 1 : HAND_SIZE), melded: false, mustUse: null };
  });
  return { order, turn: 0, phase: "play", drawn: null, pile, discard: [], table: [], hands, minMeld, result: null };
}

/**
 * Turn order for a round: the host-chosen seat order (playerIdsBySeat), with the starter rotating by one
 * seat every round. Round 1 starts with the first seat.
 */
export function roundTurnOrder(playerIdsBySeat: string[], round: number): string[] {
  const base = [...playerIdsBySeat];
  if (base.length === 0) return base;
  const shift = (((round - 1) % base.length) + base.length) % base.length;
  return [...base.slice(shift), ...base.slice(0, shift)];
}

export class RuleError extends Error {}
const rule = (msg: string): never => {
  throw new RuleError(msg);
};

export const currentPlayer = (s: RoundState) => s.order[s.turn] ?? null;

function clone(s: RoundState): RoundState {
  return structuredClone(s);
}

/** Draw from the pile, or take the top of the discard pile. The pile running out ends the round. */
export function draw(state: RoundState, playerId: string, source: "pile" | "discard"): RoundState {
  if (state.result) rule("Runda s-a terminat.");
  if (currentPlayer(state) !== playerId) rule("Nu e tura ta.");
  if (state.phase !== "draw") rule("Ai tras deja o piesă în tura asta.");
  const s = clone(state);
  const hand = s.hands[playerId];
  if (source === "discard") {
    const top = s.discard.pop();
    if (top === undefined) rule("Nu e nicio piesă aruncată.");
    hand.tiles.push(top!);
    hand.mustUse = top!;
    s.drawn = null;
  } else {
    const t = s.pile.pop();
    if (t === undefined) return finishRound(s, null, false);
    hand.tiles.push(t);
    s.drawn = t;
  }
  s.phase = "play";
  return s;
}

/**
 * Ends the caller's turn: the table as they left it plus the tile they discard.
 * Server-side validation of everything a client may try:
 *  - formations already on the table are never removed, and lose no real tile
 *    (a joker may be taken back only by swapping it, so a formation never gets shorter)
 *  - every tile on the table before is still on it; new tiles come from the caller's hand
 *  - every formation is valid
 *  - first meld: only own new formations, worth at least minMeld
 *  - a tile taken from the discard pile must end up on the table
 *  - the discard comes from what is left in hand. An empty hand after it closes the round.
 */
export function playTurn(state: RoundState, playerId: string, table: Formation[], discardTile: number): RoundState {
  if (state.result) rule("Runda s-a terminat.");
  if (currentPlayer(state) !== playerId) rule("Nu e tura ta.");
  if (state.phase !== "play") rule("Trage întâi o piesă.");
  const s = clone(state);
  const hand = s.hands[playerId];
  const handSet = new Set(hand.tiles);

  const prevById = new Map(s.table.map((f) => [f.id, f]));
  const prevTiles = new Set(s.table.flatMap((f) => f.tiles));
  const seen = new Set<string>();
  const newTiles = new Set<number>();

  for (const f of table) {
    if (typeof f.id !== "string" || f.id.length < 1 || f.id.length > 40 || seen.has(f.id)) rule("Formație invalidă.");
    seen.add(f.id);
    if (!Array.isArray(f.tiles) || f.tiles.length > 14) rule("Formație invalidă.");
    for (const t of f.tiles) {
      if (!isTile(t) || newTiles.has(t)) rule("Piesă folosită de două ori.");
      newTiles.add(t);
    }
    if (!checkFormation(f.tiles)) rule("Pe masă e o formație care nu e validă.");
  }

  for (const t of prevTiles) if (!newTiles.has(t)) rule("Nu poți lua piese de pe masă.");
  const added = [...newTiles].filter((t) => !prevTiles.has(t));
  for (const t of added) if (!handSet.has(t)) rule("Ai pus pe masă o piesă care nu e a ta.");

  let newValue = 0;
  for (const f of table) {
    const prev = prevById.get(f.id);
    if (!prev) {
      newValue += checkFormation(f.tiles)!.value;
      continue;
    }
    if (prev.owner !== f.owner) rule("Formație invalidă.");
    if (f.tiles.length < prev.tiles.length) rule("O formație de pe masă nu poate fi scurtată.");
    const now = new Set(f.tiles);
    if (prev.tiles.some((t) => !isJoker(t) && !now.has(t))) rule("Nu poți muta piese între formații.");
    if (!hand.melded && (f.tiles.length !== prev.tiles.length || prev.tiles.some((t) => !now.has(t)))) {
      rule("Până nu te etalezi, nu poți adăuga la formațiile de pe masă.");
    }
  }
  for (const id of prevById.keys()) if (!seen.has(id)) rule("Nu poți lua formații de pe masă.");
  const output = table.map((f) => ({ id: f.id, owner: prevById.get(f.id)?.owner ?? playerId, tiles: [...f.tiles] }));

  const wasMelded = hand.melded;
  if (!hand.melded && added.length > 0) {
    if (newValue < s.minMeld) rule(`Pentru etalare ai nevoie de cel puțin ${s.minMeld} de puncte (ai ${newValue}).`);
    hand.melded = true;
  }
  if (hand.mustUse !== null && !newTiles.has(hand.mustUse)) {
    rule("Piesa luată de jos trebuie folosită pe masă în tura asta.");
  }

  const addedSet = new Set(added);
  const left = hand.tiles.filter((t) => !addedSet.has(t));
  if (!left.includes(discardTile)) rule("Trebuie să arunci o piesă din mână.");

  hand.tiles = left.filter((t) => t !== discardTile);
  hand.mustUse = null;
  s.table = output;
  s.discard.push(discardTile);
  s.drawn = null;

  if (hand.tiles.length === 0) return finishRound(s, playerId, !wasMelded);
  s.turn = (s.turn + 1) % s.order.length;
  s.phase = "draw";
  return s;
}

/** Host skips an absent player: a drawn tile (or the 15th tile of the starter) is discarded for them. */
export function skipTurn(state: RoundState): RoundState {
  if (state.result) rule("Runda s-a terminat.");
  const s = clone(state);
  const id = currentPlayer(s)!;
  const hand = s.hands[id];
  if (s.phase === "play") {
    let give: number | null = hand.mustUse ?? s.drawn;
    if (give === null || !hand.tiles.includes(give)) {
      // Starter who never drew: throw the highest non-joker tile.
      const pool = hand.tiles.filter((t) => !isJoker(t));
      give = (pool.length ? pool : hand.tiles).reduce((a, b) => (handValue(b) > handValue(a) ? b : a));
    }
    hand.tiles = hand.tiles.filter((t) => t !== give);
    s.discard.push(give);
  }
  hand.mustUse = null;
  s.drawn = null;
  s.turn = (s.turn + 1) % s.order.length;
  s.phase = "draw";
  return s;
}

/**
 * A player leaves mid-round: their hand leaves with them, their formations stay on the table.
 * Whoever had the turn keeps it; if it was the leaver, it passes on. Fewer than 2 left = cancelled.
 */
export function removeFromRound(state: RoundState, playerId: string): RoundState {
  if (!state.order.includes(playerId) || state.result) return state;
  const s = clone(state);
  const current = currentPlayer(s);
  const idx = s.order.indexOf(playerId);
  const leaving = s.hands[playerId];
  // A tile taken from the discard pile goes back there.
  if (current === playerId && leaving.mustUse !== null) s.discard.push(leaving.mustUse);
  s.order = s.order.filter((id) => id !== playerId);
  delete s.hands[playerId];
  if (s.order.length < 2) {
    s.result = { closerId: null, fromHand: false, cancelled: true, points: {}, hands: handsOf(s) };
    return s;
  }
  if (current === playerId) {
    s.turn = idx % s.order.length;
    s.phase = "draw";
    s.drawn = null;
  } else {
    s.turn = s.order.indexOf(current!);
  }
  return s;
}

function handsOf(s: RoundState): Record<string, number[]> {
  return Object.fromEntries(Object.entries(s.hands).map(([id, h]) => [id, h.tiles]));
}

/** Points for a finished round. Closing "din mână" (everything in one turn) doubles the others' penalties. */
export function scoreRound(s: RoundState, closerId: string | null, fromHand: boolean): Record<string, number> {
  const points: Record<string, number> = {};
  const factor = fromHand ? 2 : 1;
  for (const id of s.order) {
    const h = s.hands[id];
    if (id === closerId) points[id] = fromHand ? CLOSE_FROM_HAND_BONUS : CLOSE_BONUS;
    else if (!h.melded) points[id] = NOT_MELDED_PENALTY * factor;
    else points[id] = h.tiles.reduce((sum, t) => sum + handValue(t), 0) * factor;
  }
  return points;
}

function finishRound(s: RoundState, closerId: string | null, fromHand: boolean): RoundState {
  s.result = { closerId, fromHand, cancelled: false, points: scoreRound(s, closerId, fromHand), hands: handsOf(s) };
  return s;
}

/** Sum of the values of new formations - shown to the player while they build their first meld. */
export function meldValue(formations: Formation[]): number {
  return formations.reduce((sum, f) => sum + (checkFormation(f.tiles)?.value ?? 0), 0);
}
