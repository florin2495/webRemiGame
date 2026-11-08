import { describe, expect, it } from "vitest";
import { roundTurnOrder } from "./remi";
import { isPermutation, moveItem, promotable } from "./seats";

describe("isPermutation", () => {
  it("accepts any full reordering", () => {
    expect(isPermutation(["b", "a", "c"], ["a", "b", "c"])).toBe(true);
  });
  it("rejects missing, extra, duplicate and non-string ids", () => {
    expect(isPermutation(["a", "b"], ["a", "b", "c"])).toBe(false);
    expect(isPermutation(["a", "b", "c", "d"], ["a", "b", "c"])).toBe(false);
    expect(isPermutation(["a", "a", "b"], ["a", "b", "c"])).toBe(false);
    expect(isPermutation(["a", "b", 3], ["a", "b", "c"])).toBe(false);
    expect(isPermutation("abc", ["a", "b", "c"])).toBe(false);
  });
});

describe("moveItem", () => {
  it("swaps neighbours and ignores out-of-range moves", () => {
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});

describe("promotable", () => {
  const q = (id: string, queuedAt: string | null) => ({ id, queuedAt });
  it("takes queued spectators in queue order, up to the free seats", () => {
    const list = [q("x", "2026-01-01T10:00:02Z"), q("y", null), q("z", "2026-01-01T10:00:01Z"), q("w", "2026-01-01T10:00:03Z")];
    expect(promotable(list, 2).map((s) => s.id)).toEqual(["z", "x"]);
    expect(promotable(list, 0)).toEqual([]);
    expect(promotable(list, 9).map((s) => s.id)).toEqual(["z", "x", "w"]);
  });
});

describe("roundTurnOrder", () => {
  it("round 1 starts with the first seat, then the starter rotates", () => {
    expect(roundTurnOrder(["a", "b", "c"], 1)).toEqual(["a", "b", "c"]);
    expect(roundTurnOrder(["a", "b", "c"], 2)).toEqual(["b", "c", "a"]);
    expect(roundTurnOrder(["a", "b", "c"], 4)).toEqual(["a", "b", "c"]);
  });
});
