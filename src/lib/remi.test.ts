import { describe, expect, it } from "vitest";
import {
  arrange,
  isJoker,
  checkFormation,
  colourOf,
  deal,
  draw,
  type Formation,
  HAND_SIZE,
  isRoomAbandoned,
  numberOf,
  playTurn,
  removeFromRound,
  type RoundState,
  ROOM_ABANDONED_MS,
  RuleError,
  skipTurn,
  TILE_COUNT,
} from "./remi";

/** colour 0 roșu, 1 galben, 2 albastru, 3 negru */
const t = (colour: number, n: number, copy = 0) => copy * 52 + colour * 13 + n - 1;
const J1 = 104;
const J2 = 105;

function base(hands: Record<string, number[]>, extra: Partial<RoundState> = {}): RoundState {
  const order = Object.keys(hands);
  return {
    order,
    turn: 0,
    phase: "play",
    drawn: null,
    pile: [t(3, 13, 1), t(3, 12, 1)],
    discard: [],
    table: [],
    hands: Object.fromEntries(order.map((id) => [id, { tiles: hands[id], melded: false, mustUse: null }])),
    minMeld: 45,
    result: null,
    ...extra,
  };
}

describe("tiles", () => {
  it("decodes colour and number", () => {
    expect(numberOf(t(2, 7))).toBe(7);
    expect(colourOf(t(2, 7))).toBe(2);
    expect(numberOf(t(3, 13, 1))).toBe(13);
    expect(colourOf(t(3, 13, 1))).toBe(3);
  });
});

describe("checkFormation", () => {
  it("accepts groups and rejects duplicate colours", () => {
    expect(checkFormation([t(0, 7), t(1, 7), t(2, 7)])).toEqual({ kind: "group", value: 21 });
    expect(checkFormation([t(0, 7), t(1, 7), J1, t(3, 7)])).toEqual({ kind: "group", value: 28 });
    expect(checkFormation([t(0, 7), t(0, 7, 1), t(2, 7)])).toBeNull();
    expect(checkFormation([t(0, 7), t(1, 7), t(2, 7), t(3, 7), J1])).toBeNull();
  });

  it("accepts runs with jokers and the ace low or high", () => {
    expect(checkFormation([t(1, 3), t(1, 4), t(1, 5)])).toEqual({ kind: "run", value: 12 });
    expect(checkFormation([t(1, 3), J1, t(1, 5)])).toEqual({ kind: "run", value: 12 });
    expect(checkFormation([t(1, 1), t(1, 2), t(1, 3)])?.value).toBe(6);
    expect(checkFormation([t(1, 12), t(1, 13), t(1, 1)])?.value).toBe(39);
    expect(checkFormation([J1, J2, t(1, 1)])?.value).toBe(39);
    expect(checkFormation([t(1, 13), t(1, 1), t(1, 2)])).toBeNull(); // no wrap
    expect(checkFormation([t(1, 3), t(2, 4), t(1, 5)])).toBeNull(); // mixed colours
    expect(checkFormation([t(1, 5), t(1, 4), t(1, 3)])).toBeNull(); // must be ascending
  });

  it("rejects short or joker-only formations", () => {
    expect(checkFormation([t(0, 1), t(0, 2)])).toBeNull();
    expect(checkFormation([J1, J2, J1])).toBeNull();
  });
});

describe("arrange", () => {
  it("orders runs and fills gaps with jokers", () => {
    expect(arrange([t(1, 5), t(1, 3), J1])).toEqual([t(1, 3), J1, t(1, 5)]);
    expect(arrange([t(1, 1), t(1, 13), t(1, 12)])).toEqual([t(1, 12), t(1, 13), t(1, 1)]);
    const r = arrange([t(2, 13), J1, J2])!;
    expect(checkFormation(r)).not.toBeNull();
    expect(arrange([t(0, 4), t(1, 4), t(2, 4)])).not.toBeNull();
    expect(arrange([t(0, 4), t(1, 5), t(2, 9)])).toBeNull();
  });
});

describe("deal", () => {
  it("gives 15 tiles to the starter, 14 to the others, nothing lost", () => {
    const s = deal(["a", "b", "c", "d"], 45);
    expect(s.hands.a.tiles).toHaveLength(HAND_SIZE + 1);
    expect(s.hands.d.tiles).toHaveLength(HAND_SIZE);
    const all = [...s.pile, ...Object.values(s.hands).flatMap((h) => h.tiles)];
    expect(new Set(all).size).toBe(TILE_COUNT);
    expect(s.phase).toBe("play");
  });
});

describe("playTurn", () => {
  const meld: Formation = { id: "f1", owner: "a", tiles: [t(0, 13), t(1, 13), t(2, 13)] }; // 39
  const run: Formation = { id: "f2", owner: "a", tiles: [t(3, 1), t(3, 2), t(3, 3)] }; // 6

  it("enforces the minimum first meld", () => {
    const s = base({ a: [...meld.tiles, t(0, 5)], b: [t(0, 6)] });
    expect(() => playTurn(s, "a", [meld], t(0, 5))).toThrow(RuleError);
    const s2 = base({ a: [...meld.tiles, ...run.tiles, t(0, 5), t(0, 8)], b: [t(0, 6)] });
    const next = playTurn(s2, "a", [meld, run], t(0, 5));
    expect(next.hands.a.melded).toBe(true);
    expect(next.turn).toBe(1);
    expect(next.phase).toBe("draw");
    expect(next.discard).toEqual([t(0, 5)]);
  });

  it("closes the round when the last tile is discarded and doubles a close from hand", () => {
    const s = base({ a: [...meld.tiles, ...run.tiles, t(0, 5)], b: [t(0, 6), J1] });
    s.hands.b.melded = true;
    const next = playTurn(s, "a", [meld, run], t(0, 5));
    expect(next.result?.closerId).toBe("a");
    expect(next.result?.fromHand).toBe(true);
    expect(next.result?.points).toEqual({ a: -100, b: (6 + 50) * 2 });
  });

  it("charges 100 to a player who never melded", () => {
    const s = base({ a: [t(0, 9)], b: [t(0, 6)] });
    s.hands.a.melded = true;
    s.table = [meld];
    const next = playTurn(s, "a", [meld], t(0, 9));
    expect(next.result?.points).toEqual({ a: -50, b: 100 });
  });

  it("lets a melded player extend any formation but never take tiles back", () => {
    const other: Formation = { id: "g", owner: "b", tiles: [t(2, 4), t(2, 5), t(2, 6)] };
    const s = base({ a: [t(2, 7), t(0, 1), t(0, 2)], b: [t(0, 6)] }, { table: [other] });
    s.hands.a.melded = true;
    const next = playTurn(s, "a", [{ ...other, tiles: [...other.tiles, t(2, 7)] }], t(0, 1));
    expect(next.table[0].tiles).toHaveLength(4);
    expect(() => playTurn(s, "a", [{ ...other, tiles: [t(2, 4), t(2, 5)] }], t(0, 1))).toThrow(RuleError);
    expect(() => playTurn(s, "a", [], t(0, 1))).toThrow(RuleError);
  });

  it("forbids extending other formations before the first meld", () => {
    const other: Formation = { id: "g", owner: "b", tiles: [t(2, 4), t(2, 5), t(2, 6)] };
    const s = base({ a: [t(2, 7), t(0, 1), t(0, 2)], b: [t(0, 6)] }, { table: [other], minMeld: 0 });
    expect(() => playTurn(s, "a", [{ ...other, tiles: [...other.tiles, t(2, 7)] }], t(0, 1))).toThrow(RuleError);
  });

  it("swaps a joker only if it goes back on the table this turn", () => {
    const withJoker: Formation = { id: "g", owner: "b", tiles: [t(2, 4), J1, t(2, 6)] };
    const s = base({ a: [t(2, 5), t(1, 9), t(3, 9), t(0, 1)], b: [t(0, 6)] }, { table: [withJoker] });
    s.hands.a.melded = true;
    const swapped = { ...withJoker, tiles: [t(2, 4), t(2, 5), t(2, 6)] };
    // Joker kept in hand: not allowed.
    expect(() => playTurn(s, "a", [swapped], t(0, 1))).toThrow(RuleError);
    // Joker used in a new group: fine.
    const next = playTurn(s, "a", [swapped, { id: "n", owner: "a", tiles: [t(1, 9), t(3, 9), J1] }], t(0, 1));
    expect(next.table).toHaveLength(2);
  });

  it("requires a tile taken from the discard pile to be played", () => {
    const s = base({ a: [t(0, 2)], b: [t(1, 13), t(2, 13), t(0, 4), t(0, 5)] }, { discard: [t(3, 13)], turn: 1, phase: "draw", minMeld: 30 });
    const took = draw(s, "b", "discard");
    expect(took.hands.b.mustUse).toBe(t(3, 13));
    expect(() => playTurn(took, "b", [], t(3, 13))).toThrow(RuleError);
    const next = playTurn(took, "b", [{ id: "x", owner: "b", tiles: [t(1, 13), t(2, 13), t(3, 13)] }], t(0, 4));
    expect(next.hands.b.tiles).toEqual([t(0, 5)]);
  });

  it("rejects tiles that are not in the hand and turns out of order", () => {
    const s = base({ a: [t(0, 1)], b: [t(0, 6)] });
    expect(() => playTurn(s, "b", [], t(0, 6))).toThrow(RuleError);
    expect(() => playTurn(s, "a", [], t(0, 6))).toThrow(RuleError);
  });
});

describe("draw / skip / leave", () => {
  it("ends the round when the pile is empty", () => {
    const s = base({ a: [t(0, 1)], b: [t(0, 2)] }, { pile: [], phase: "draw" });
    expect(draw(s, "a", "pile").result?.closerId).toBeNull();
  });

  it("skip discards the drawn tile and passes the turn", () => {
    const s = base({ a: [t(0, 1)], b: [t(0, 2)] }, { phase: "draw" });
    const drew = draw(s, "a", "pile");
    const skipped = skipTurn(drew);
    expect(skipped.hands.a.tiles).toEqual([t(0, 1)]);
    expect(skipped.turn).toBe(1);
    expect(skipped.phase).toBe("draw");
  });

  it("passes the turn when the current player leaves, cancels below 2", () => {
    const s = base({ a: [t(0, 1)], b: [t(0, 2)], c: [t(0, 3)] }, { turn: 1, phase: "draw" });
    const out = removeFromRound(s, "b");
    expect(out.order).toEqual(["a", "c"]);
    expect(out.order[out.turn]).toBe("c");
    expect(removeFromRound(out, "c").result?.cancelled).toBe(true);
  });
});

describe("simulation", () => {
  /** Tiny seeded RNG so failures are reproducible. */
  function rng(seed: number) {
    return () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
  }

  /** Greedy bot: lays every group of same-number tiles it can, then discards its highest tile. */
  function botTurn(s: RoundState, id: string, rand: () => number): RoundState {
    if (s.phase === "draw") s = draw(s, id, "pile");
    if (s.result) return s;
    const hand = s.hands[id];
    const table = s.table.map((f) => ({ ...f, tiles: [...f.tiles] }));
    let left = [...hand.tiles];
    const created: Formation[] = [];
    for (let n = 1; n <= 13; n++) {
      const same = left.filter((t) => !isJoker(t) && numberOf(t) === n);
      const distinct = [...new Map(same.map((t) => [colourOf(t), t])).values()];
      if (distinct.length >= 3) {
        created.push({ id: `${id}-${n}-${s.discard.length}`, owner: id, tiles: arrange(distinct)! });
        left = left.filter((t) => !distinct.includes(t));
      }
    }
    const value = created.reduce((sum, f) => sum + checkFormation(f.tiles)!.value, 0);
    const useCreated = created.length > 0 && left.length > 0 && (hand.melded || value >= s.minMeld);
    const finalLeft = useCreated ? left : hand.tiles;
    const discard = finalLeft[Math.floor(rand() * finalLeft.length)];
    return playTurn(s, id, useCreated ? [...table, ...created] : table, discard);
  }

  it("plays 200 random rounds without losing or duplicating a tile", () => {
    for (let g = 0; g < 200; g++) {
      const rand = rng(g + 1);
      const players = ["a", "b", "c", "d"].slice(0, 2 + (g % 3));
      let s = deal(players, 30, rand);
      for (let step = 0; step < 500 && !s.result; step++) {
        s = botTurn(s, s.order[s.turn], rand);
        const all = [...s.pile, ...s.discard, ...s.table.flatMap((f) => f.tiles), ...Object.values(s.hands).flatMap((h) => h.tiles)];
        expect(all.length).toBe(TILE_COUNT);
        expect(new Set(all).size).toBe(TILE_COUNT);
      }
      expect(s.result).not.toBeNull();
    }
  });
});

describe("abandoned rooms (any status)", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  const sec = (n: number) => new Date(now - n * 1000).toISOString();
  it(`is abandoned after ${ROOM_ABANDONED_MS / 1000} s with nobody seen`, () => {
    expect(ROOM_ABANDONED_MS).toBe(600_000);
    expect(isRoomAbandoned(sec(601), [sec(900), sec(700)], now)).toBe(true);
    expect(isRoomAbandoned(sec(601), [], now)).toBe(true);
    expect(isRoomAbandoned(sec(601), [null], now)).toBe(true);
  });
  it("is kept while the last activity is recent", () => {
    expect(isRoomAbandoned(sec(599), [], now)).toBe(false);
    expect(isRoomAbandoned(sec(121), [], now)).toBe(false);
  });
  it("is kept while any player or spectator was seen recently", () => {
    expect(isRoomAbandoned(sec(3600), [sec(3600), sec(300)], now)).toBe(false);
  });
});
