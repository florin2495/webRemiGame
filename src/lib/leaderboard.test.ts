import { describe, expect, it } from "vitest";
import { playerKey, roundWinners } from "./leaderboard";

describe("playerKey", () => {
  it("trims and lowercases", () => {
    expect(playerKey("  Ana Maria ")).toBe("ana maria");
  });
});

describe("roundWinners", () => {
  it("the closer wins", () => {
    expect(roundWinners("a", { a: -50, b: 30, c: 12 })).toEqual(["a"]);
  });
  it("nobody closed: lowest score wins, ties share", () => {
    expect(roundWinners(null, { a: 20, b: 8, c: 8 })).toEqual(["b", "c"]);
  });
  it("no points: nobody", () => {
    expect(roundWinners(null, {})).toEqual([]);
  });
});
