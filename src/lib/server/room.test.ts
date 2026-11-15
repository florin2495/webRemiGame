import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// cleanupAbandonedRooms with the Supabase client mocked: every query is recorded, selects and deletes
// resolve to the canned results below.
type Call = { method: string; args: unknown[] };
const fake = vi.hoisted(() => ({
  selectResult: { data: [] as unknown[] | null, error: null as unknown },
  deleteResult: { error: null as unknown },
  queries: [] as { table: string; calls: { method: string; args: unknown[] }[] }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({
  T: { rooms: "remi_rooms", players: "remi_players", rounds: "remi_rounds" },
  PLAYER_COLUMNS: "*",
  ROOM_COLUMNS: "*",
  db: () => ({
    from(table: string) {
      const query = { table, calls: [] as Call[] };
      fake.queries.push(query);
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "delete", "update", "insert", "eq", "in", "lt", "limit", "order", "maybeSingle"]) {
        builder[method] = (...args: unknown[]) => {
          query.calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(query.calls.some((c) => c.method === "delete") ? fake.deleteResult : fake.selectResult).then(
          resolve,
          reject,
        );
      return builder;
    },
  }),
}));

import { ROOM_ABANDONED_MS } from "@/lib/remi";
import { cleanupAbandonedRooms } from "./room";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
const CUTOFF = new Date(NOW - ROOM_ABANDONED_MS).toISOString();

const deletes = () => fake.queries.filter((q) => q.calls.some((c) => c.method === "delete"));
const argsOf = (q: { calls: Call[] }, method: string) => q.calls.filter((c) => c.method === method).map((c) => c.args);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  fake.selectResult = { data: [], error: null };
  fake.deleteResult = { error: null };
  fake.queries = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("cleanupAbandonedRooms", () => {
  it("selects only rooms idle past the cutoff", async () => {
    await cleanupAbandonedRooms();
    const select = fake.queries[0];
    expect(select.table).toBe("remi_rooms");
    expect(argsOf(select, "lt")).toEqual([["last_activity_at", CUTOFF]]);
  });

  it("deletes silent rooms and keeps rooms with a recently seen member", async () => {
    fake.selectResult = {
      data: [
        { id: "silent", last_activity_at: ago(700), players: [{ last_seen_at: ago(700) }, { last_seen_at: null }] },
        { id: "empty", last_activity_at: ago(900), players: [] },
        { id: "watched", last_activity_at: ago(700), players: [{ last_seen_at: ago(800) }, { last_seen_at: ago(30) }] },
        { id: "fresh", last_activity_at: ago(100), players: [] },
      ],
      error: null,
    };
    await cleanupAbandonedRooms();
    const del = deletes();
    expect(del).toHaveLength(1);
    expect(del[0].table).toBe("remi_rooms");
    expect(argsOf(del[0], "in")).toEqual([["id", ["silent", "empty"]]]);
  });

  it("re-checks the activity cutoff in the delete itself", async () => {
    fake.selectResult = { data: [{ id: "silent", last_activity_at: ago(700), players: [] }], error: null };
    await cleanupAbandonedRooms();
    expect(argsOf(deletes()[0], "lt")).toEqual([["last_activity_at", CUTOFF]]);
  });

  it("deletes nothing when every room is still in use", async () => {
    fake.selectResult = { data: [{ id: "watched", last_activity_at: ago(700), players: [{ last_seen_at: ago(5) }] }], error: null };
    await cleanupAbandonedRooms();
    expect(deletes()).toHaveLength(0);
  });

  it("logs a select error instead of throwing", async () => {
    fake.selectResult = { data: null, error: { message: "boom" } };
    await expect(cleanupAbandonedRooms()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
    expect(deletes()).toHaveLength(0);
  });

  it("logs a delete error instead of throwing", async () => {
    fake.selectResult = { data: [{ id: "silent", last_activity_at: ago(700), players: [] }], error: null };
    fake.deleteResult = { error: { message: "boom" } };
    await expect(cleanupAbandonedRooms()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
