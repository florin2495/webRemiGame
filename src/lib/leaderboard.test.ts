import { describe, expect, it } from "vitest";
import { isTestRoom, playerKey, roundWinners } from "./leaderboard";

describe("isTestRoom", () => {
  it("matches the e2e room names", () => {
    expect(isTestRoom("e2e-test-123")).toBe(true);
    expect(isTestRoom("e2e-test-ui-abc")).toBe(true);
  });
  it("leaves real rooms alone", () => {
    expect(isTestRoom("Masa lui Ion")).toBe(false);
    expect(isTestRoom("my e2e-test-room")).toBe(false);
    expect(isTestRoom("E2E-TEST-x")).toBe(false);
  });
});

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
