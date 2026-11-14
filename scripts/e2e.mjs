// End-to-end test of the Remi API with real players.
// Usage: node scripts/e2e.mjs [baseUrl incl. /remi] [vercelProjectUrl incl. /remi]
// Default: production (https://games.hailatat.icu/remi). Local: node scripts/e2e.mjs http://localhost:3000/remi
// Rooms are named "e2e-test-..."; every room it creates is deleted at the end (leave as everyone, then a DB
// delete of leftovers as a safety net: env NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, else .env.local).
// Sends nothing to /api/feedback. Run by .github/workflows/e2e.yml (manual only).
// Plain Node 20+, no dependencies: the few rules the bot needs are copied below (the server re-checks everything).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = (process.argv[2] ?? "https://games.hailatat.icu/remi").replace(/\/$/, "");
const VERCEL = process.argv[3] ?? (BASE.startsWith("https://games.hailatat.icu/") ? "https://009web-remi-game.vercel.app/remi" : null);
const created = new Set();
let failures = 0;

function check(cond, msg) {
  if (cond) console.log("  ✓", msg);
  else {
    failures++;
    console.log("  ✗", msg);
  }
}

async function call(path, { token, body, method } = {}) {
  const headers = {};
  if (token) headers["x-player-token"] = token;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, { method: method ?? (body !== undefined ? "POST" : "GET"), headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, region: res.headers.get("x-vercel-id") };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = async (code, p) => (await call(`/api/rooms/${code}/state`, { token: p.token })).data;

// ---------------------------------------------------------------------------
// Minimal copy of src/lib/remi.ts (tile ids, formations) for the bot.
// ---------------------------------------------------------------------------
const isJoker = (t) => t >= 104;
const colourOf = (t) => Math.floor((t % 52) / 13);
const numberOf = (t) => ((t % 52) % 13) + 1;
const handValue = (t) => (isJoker(t) ? 50 : numberOf(t));
const tileOf = (colour, n, copy = 0) => copy * 52 + colour * 13 + n - 1;

function checkGroup(tiles, real) {
  if (tiles.length > 4) return null;
  const n = numberOf(real[0]);
  if (!real.every((t) => numberOf(t) === n)) return null;
  if (new Set(real.map(colourOf)).size !== real.length) return null;
  return { kind: "group", value: n * tiles.length };
}
function checkRun(tiles) {
  const first = tiles.findIndex((t) => !isJoker(t));
  const colour = colourOf(tiles[first]);
  let start = numberOf(tiles[first]) - first;
  if (numberOf(tiles[first]) === 1 && first > 0) start = 14 - first;
  if (start < 1 || start + tiles.length - 1 > 14) return null;
  let value = 0;
  for (let i = 0; i < tiles.length; i++) {
    const v = start + i;
    value += v;
    const t = tiles[i];
    if (isJoker(t)) continue;
    if (colourOf(t) !== colour || numberOf(t) !== (v === 14 ? 1 : v)) return null;
  }
  return { kind: "run", value };
}
function checkFormation(tiles) {
  if (tiles.length < 3 || new Set(tiles).size !== tiles.length) return null;
  const real = tiles.filter((t) => !isJoker(t));
  if (real.length === 0) return null;
  const g = checkGroup(tiles, real);
  const r = checkRun(tiles);
  if (g && r) return r.value > g.value ? r : g;
  return g ?? r;
}
/** Valid order of real tiles (no jokers needed by the bot): group by colour, or an ascending run (ace low/high). */
function arrangeReal(tiles) {
  if (tiles.some(isJoker)) return checkFormation(tiles) ? tiles : null;
  const g = [...tiles].sort((a, b) => colourOf(a) - colourOf(b));
  if (checkFormation(g)) return g;
  for (const high of [false, true]) {
    const pos = (t) => (numberOf(t) === 1 && high ? 14 : numberOf(t));
    const r = [...tiles].sort((a, b) => pos(a) - pos(b));
    if (checkFormation(r)) return r;
  }
  return null;
}

/** Greedy formations from real tiles: groups first, then runs per colour. */
function findFormations(hand) {
  let pool = hand.filter((t) => !isJoker(t));
  const out = [];
  for (let n = 13; n >= 1; n--) {
    const byColour = new Map();
    for (const t of pool) if (numberOf(t) === n && !byColour.has(colourOf(t))) byColour.set(colourOf(t), t);
    if (byColour.size >= 3) {
      const tiles = [...byColour.values()];
      out.push(tiles);
      pool = pool.filter((t) => !tiles.includes(t));
    }
  }
  for (let c = 0; c < 4; c++) {
    const byNum = new Map();
    for (const t of pool) if (colourOf(t) === c && !byNum.has(numberOf(t))) byNum.set(numberOf(t), t);
    let n = 1;
    while (n <= 13) {
      if (!byNum.has(n)) {
        n++;
        continue;
      }
      const seq = [];
      while (n <= 13 && byNum.has(n)) seq.push(byNum.get(n++));
      if (n === 14 && byNum.has(1) && seq[0] !== byNum.get(1)) seq.push(byNum.get(1)); // ... 12-13-1
      if (seq.length >= 3) {
        out.push(seq);
        pool = pool.filter((t) => !seq.includes(t));
      }
    }
  }
  return out.map(arrangeReal).filter(Boolean);
}

/**
 * One full turn for the player on turn: draw from the pile, lay what it can (meld when worth enough,
 * add single tiles to the table once melded), discard the highest tile. Returns the /turn (or /draw) response.
 */
async function botTurn(code, p) {
  let s = await state(code, p);
  if (s.game.phase === "draw") {
    const d = await call(`/api/rooms/${code}/draw`, { token: p.token, body: { source: "pile", version: s.version } });
    if (d.status !== 200) return d;
    s = await state(code, p);
    if (s.game.result) return d; // pile ran out
  }
  let hand = [...s.hand];
  const table = s.game.table.map((f) => ({ ...f, tiles: [...f.tiles] }));
  let melded = s.game.melded[p.playerId];
  const formations = findFormations(hand);
  const value = formations.reduce((sum, f) => sum + checkFormation(f).value, 0);
  const lay = [];
  if (melded || value >= s.room.minMeld) lay.push(...formations);
  // Always keep one tile to discard.
  while (lay.length && hand.length - lay.flat().length < 1) lay.pop();
  if (!melded && lay.reduce((sum, f) => sum + checkFormation(f).value, 0) < s.room.minMeld) lay.length = 0;
  for (const f of lay) {
    table.push({ id: randomUUID(), owner: p.playerId, tiles: f });
    hand = hand.filter((t) => !f.includes(t));
  }
  if (lay.length) melded = true;
  if (melded && s.game.melded[p.playerId]) {
    // Add single tiles to formations already on the table (not to this turn's new ones before melding).
    for (const t of [...hand].filter((x) => !isJoker(x))) {
      if (hand.length <= 1) break;
      for (const f of table) {
        const tiles = arrangeReal([...f.tiles, t]);
        if (tiles && !f.tiles.some(isJoker)) {
          f.tiles = tiles;
          hand = hand.filter((x) => x !== t);
          break;
        }
      }
    }
  }
  const discard = hand.reduce((a, b) => (isJoker(a) || (!isJoker(b) && handValue(b) > handValue(a)) ? b : a));
  return call(`/api/rooms/${code}/turn`, { token: p.token, body: { table, discard, version: s.version } });
}

// ---------------------------------------------------------------------------

const assetsOf = (html, basePath) => [...new Set([...html.matchAll(new RegExp(`${basePath}/_next/static/[^"'\\s]+`, "g"))].map((m) => m[0]))].sort();

/** Pages, assets, manifest and icons over plain HTTP, and the Vercel project URL serving the same build. */
async function httpChecks() {
  console.log("HTTP");
  const origin = new URL(BASE).origin;
  const basePath = new URL(BASE).pathname;
  const page = await fetch(BASE, { cache: "no-store" });
  const html = await page.text();
  check(page.status === 200 && html.includes("<html"), `page ${basePath} = ${page.status}`);
  const assets = assetsOf(html, basePath);
  const statuses = await Promise.all(assets.map(async (a) => (await fetch(origin + a)).status));
  check(assets.length > 0 && statuses.every((x) => x === 200), `${assets.length} /_next assets = 200`);
  const manifest = await fetch(`${BASE}/manifest.webmanifest`);
  const m = await manifest.json().catch(() => ({}));
  check(manifest.status === 200 && m.start_url === `${basePath}/`, `manifest = ${manifest.status}, start_url ${m.start_url}`);
  const icons = [...(m.icons ?? []).map((i) => i.src), `${basePath}/favicon.ico`, `${basePath}/pwa-icons/apple`];
  const iconRes = await Promise.all(icons.map((src) => fetch(origin + src)));
  check(iconRes.every((x) => x.status === 200 && /image/.test(x.headers.get("content-type") ?? "")), `${icons.length} icons = 200 image/*`);
  check(html.includes(`${basePath}/manifest.webmanifest`) && html.includes(`${basePath}/pwa-icons/apple`), "page links manifest and apple icon under the base path");
  const roomPage = await fetch(`${BASE}/room/XXXXXX`);
  const roomHtml = await roomPage.text();
  check(roomPage.status === 200, `GET ${basePath}/room/XXXXXX = ${roomPage.status}`);
  const roomAssets = assetsOf(roomHtml, basePath);
  const roomStatuses = await Promise.all(roomAssets.map(async (a) => (await fetch(origin + a)).status));
  check(roomAssets.length > 0 && roomStatuses.every((x) => x === 200), `room page: ${roomAssets.length} /_next assets = 200`);
  // The version (next to "Setări") is in the client JS: the deploy under test must be this checkout's version.
  const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  let hasVersion = false;
  for (const a of [...new Set([...assets, ...roomAssets])].filter((x) => /\.js(\?|$)/.test(x))) {
    if ((await (await fetch(origin + a)).text()).includes(`"${version}"`)) {
      hasVersion = true;
      break;
    }
  }
  check(hasVersion, `client JS contains version ${version}`);
  if (VERCEL) {
    const v = await fetch(VERCEL, { cache: "no-store" });
    const vAssets = assetsOf(await v.text(), basePath);
    check(v.status === 200 && vAssets.join() === assets.join(), `${VERCEL} = ${v.status}, same build`);
  }
}

async function main() {
  console.log(`E2E against ${BASE}`);
  await httpChecks();

  console.log("Room, join");
  const roomName = `e2e-test-${Date.now().toString(36)}`;
  const devA = randomUUID();
  const r = await call("/api/rooms", { body: { name: roomName, nickname: "Ana", password: "pw", minMeld: 45, deviceId: devA } });
  check(r.status === 200, `create room (${r.status}) region=${r.region ?? "local"}`);
  check(r.region === null || /fra1/.test(r.region), `API runs in fra1 (${r.region})`);
  const code = r.data.code;
  created.add(code);
  const A = { ...r.data, name: "Ana", deviceId: devA };
  check(typeof code === "string" && /^[A-Z2-9]{6}$/.test(code) && typeof A.token === "string", `room code ${code}`);
  check((await call("/api/rooms", { body: { name: "e2e-test-bad", nickname: "X", minMeld: 40 } })).status === 400, "create with a bad minMeld = 400");
  check((await call("/api/rooms", { body: { name: "e2e-test-bad", nickname: "" } })).status === 400, "create with an empty nickname = 400");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob", password: "nope" } })).status === 403, "wrong password = 403");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob" } })).status === 403, "missing password = 403");
  check((await call(`/api/rooms/ZZZZZZ/join`, { body: { nickname: "Bob", password: "pw" } })).status === 404, "unknown room = 404");
  const join = async (nickname) => {
    const deviceId = randomUUID();
    const res = await call(`/api/rooms/${code}/join`, { body: { nickname, password: "pw", deviceId } });
    return { ...res.data, status: res.status, name: nickname, deviceId };
  };
  const B = await join("Bob");
  const C = await join("Cris");
  check(B.status === 200 && C.status === 200 && B.playerId && C.playerId, "Bob and Cris joined");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "bob", password: "pw" } })).status === 409, "duplicate nickname (connected seat, no device) = 409");
  const list = await call("/api/rooms");
  const listed = list.data.rooms?.find((x) => x.code === code);
  check(listed?.name === roomName && listed.hasPassword && listed.players === 3 && listed.minMeld === 45, "room in public list, with password and 3 players");
  check(!JSON.stringify(list.data).includes("scrypt"), "room list leaks no password hash");

  console.log("Tokens and rejoin (lobby)");
  check((await call(`/api/rooms/${code}/state`)).status === 401, "state without token = 401");
  check((await call(`/api/rooms/${code}/state`, { token: "forged-token" })).status === 401, "state with a forged token = 401");
  check((await call(`/api/rooms/${code}/ready`, { token: "forged-token", body: { ready: true } })).status === 401, "ready with a forged token = 401");
  const reload = await call(`/api/rooms/${code}/state`, { token: B.token });
  check(reload.status === 200 && reload.data.me.id === B.playerId && reload.data.me.nickname === "Bob", "reload with the saved token = same player");
  const raw = JSON.stringify(reload.data);
  check(!/token|device_hash|scrypt|password_hash/.test(raw) && !raw.includes(A.token), "state leaks no tokens, hashes or device ids");
  const otherDevice = await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob", password: "pw", deviceId: randomUUID() } });
  check(otherDevice.status === 409, "rejoin as a connected player from another device = 409");
  const reB = await call(`/api/rooms/${code}/join`, { body: { nickname: "bob", password: "pw", deviceId: B.deviceId } });
  check(reB.status === 200 && reB.data.playerId === B.playerId, "rejoin from the same device reclaims the seat");
  check((await call(`/api/rooms/${code}/state`, { token: B.token })).status === 401, "old token is dead after the rejoin");
  if (reB.data.token) B.token = reB.data.token;
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob", password: "nope", deviceId: B.deviceId } })).status === 403, "rejoin with a wrong password = 403");

  console.log("Kick and leave in the lobby");
  const F = await join("Fil");
  check(F.status === 200 && !F.spectator, "Fil joined (4 players)");
  const full = await join("Gia");
  check(full.status === 200 && full.spectator === true, "5th person in a full lobby becomes a spectator");
  check((await call(`/api/rooms/${code}/ready`, { token: full.token, body: { ready: true } })).status === 403, "spectator ready = 403");
  check((await call(`/api/rooms/${code}/leave`, { token: full.token, body: {} })).status === 200, "the spectator leaves");
  check((await call(`/api/rooms/${code}/kick`, { token: B.token, body: { playerId: F.playerId } })).status === 403, "non-host kick = 403");
  check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: A.playerId } })).status === 400, "host kicking self = 400");
  check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: "not-a-uuid" } })).status === 404, "kick unknown player = 404");
  check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: F.playerId } })).status === 200, "host kicks Fil in the lobby");
  check((await call(`/api/rooms/${code}/state`, { token: F.token })).status === 401, "kicked player is out at once");
  const G = await join("Gia");
  check(G.status === 200, "Gia joined");
  check((await call(`/api/rooms/${code}/leave`, { token: G.token, body: {} })).status === 200, "Gia leaves the lobby");
  const D = await join("Dan");
  check(D.status === 200, "Dan joined (4 players)");

  console.log("Settings, ready, start");
  check((await call(`/api/rooms/${code}/settings`, { token: B.token, body: { minMeld: 30 } })).status === 403, "non-host settings = 403");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { minMeld: 40 } })).status === 400, "minMeld 40 = 400");
  for (const p of [A, B, C, D]) await call(`/api/rooms/${code}/ready`, { token: p.token, body: { ready: true } });
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { minMeld: 30 } })).status === 200, "host sets etalare 30");
  let s = await state(code, A);
  check(s.room.minMeld === 30 && s.players.every((p) => !p.ready), "settings change resets every ready");
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 409, "start with players not ready = 409");
  for (const p of [A, B, C, D]) await call(`/api/rooms/${code}/ready`, { token: p.token, body: { ready: true } });
  check((await call(`/api/rooms/${code}/draw`, { token: A.token, body: { source: "pile" } })).status === 409, "draw in the lobby = 409");
  check((await call(`/api/rooms/${code}/start`, { token: B.token, body: {} })).status === 403, "non-host start = 403");
  const starts = await Promise.all([1, 2].map(() => call(`/api/rooms/${code}/start`, { token: A.token, body: {} })));
  check(starts.filter((x) => x.status === 200).length === 1 && starts.some((x) => x.status === 409), "double start: exactly one wins, the other = 409");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Hia", password: "nope" } })).status === 403, "wrong password mid-round = 403");

  console.log("Deal and hidden information");
  const players = [A, B, C, D];
  const views = await Promise.all(players.map((p) => state(code, p)));
  s = views[0];
  check(s.room.status === "playing" && s.game.currentPlayerId === A.playerId && s.game.phase === "play", "host starts round 1, discarding first");
  check(views[0].hand.length === 15 && views.slice(1).every((v) => v.hand.length === 14), "15 tiles for the starter, 14 for the others");
  const allHands = views.flatMap((v) => v.hand);
  check(new Set(allHands).size === allHands.length && allHands.every((t) => Number.isInteger(t) && t >= 0 && t < 106), "hands are disjoint, valid tile ids");
  check(s.game.pileCount + allHands.length === 106 && s.game.discardCount === 0, "pile + hands = 106 tiles");
  check(views.every((v) => players.every((p, i) => v.game.handCounts[p.playerId] === views[i].hand.length)), "everyone sees the same hand counts");
  check(
    views.every((v, i) => {
      const json = JSON.stringify(v);
      return !/"pile"|"hands"|"drawn"/.test(json) && players.every((_, j) => j === i || !views[j].hand.some((t) => v.hand.includes(t)));
    }),
    "no player sees another player's tiles or the pile",
  );

  console.log("Illegal moves");
  let v = s.version;
  const handA = views[0].hand;
  const handB = views[1].hand;
  check((await call(`/api/rooms/${code}/draw`, { token: B.token, body: { source: "pile", version: v } })).status === 409, "draw out of turn = 409");
  check((await call(`/api/rooms/${code}/draw`, { token: A.token, body: { source: "pile", version: v } })).status === 409, "starter drawing (has 15 tiles) = 409");
  check((await call(`/api/rooms/${code}/draw`, { token: A.token, body: { source: "sky", version: v } })).status === 400, "draw from a bad source = 400");
  check((await call(`/api/rooms/${code}/turn`, { token: B.token, body: { table: [], discard: handB[0], version: v } })).status === 409, "turn out of turn = 409");
  check((await call(`/api/rooms/${code}/turn`, { token: A.token, body: { table: [], discard: handB[0], version: v } })).status === 409, "discarding someone else's tile = 409");
  check((await call(`/api/rooms/${code}/turn`, { token: A.token, body: { table: [], version: v } })).status === 400, "turn without a discard = 400");
  check((await call(`/api/rooms/${code}/turn`, { token: A.token, body: { table: "x", discard: handA[0], version: v } })).status === 400, "malformed table = 400");
  check(
    (await call(`/api/rooms/${code}/turn`, { token: A.token, body: { table: [{ id: "f1", owner: A.playerId, tiles: handA.slice(0, 3) }], discard: handA[5], version: v } })).status === 409,
    "an invalid (or under-etalare) formation = 409",
  );
  check(
    (await call(`/api/rooms/${code}/turn`, { token: A.token, body: { table: [{ id: "f1", owner: A.playerId, tiles: handB.slice(0, 3) }], discard: handA[0], version: v } })).status === 409,
    "laying another player's tiles = 409",
  );
  check((await call(`/api/rooms/${code}/turn`, { token: A.token, body: { table: [], discard: handA[0], version: v - 1 } })).status === 409, "stale version = 409");
  check((await call(`/api/rooms/${code}/turn`, { token: "forged-token", body: { table: [], discard: handA[0], version: v } })).status === 401, "turn with a forged token = 401");
  check((await call(`/api/rooms/${code}/skip`, { token: B.token, body: {} })).status === 403, "non-host skip = 403");
  check((await call(`/api/rooms/${code}/new-round`, { token: A.token, body: {} })).status === 409, "new round while playing = 409");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { minMeld: 45 } })).status === 409, "settings while playing = 409");
  s = await state(code, B);
  check(s.version === v && s.game.currentPlayerId === A.playerId && s.game.table.length === 0, "rejected moves changed nothing");

  console.log("Turns, discard-pile rule, skip");
  const discardA = handA.reduce((a, b) => (isJoker(a) || (!isJoker(b) && numberOf(b) > numberOf(a)) ? b : a));
  check((await call(`/api/rooms/${code}/turn`, { token: A.token, body: { table: [], discard: discardA, version: v } })).status === 200, "Ana discards");
  s = await state(code, B);
  check(s.game.currentPlayerId === B.playerId && s.game.phase === "draw" && s.game.discardTop === discardA && s.hand.length === 14, "Bob's turn, sees Ana's discard");
  check((await state(code, A)).hand.length === 14 && !(await state(code, A)).hand.includes(discardA), "Ana has 14 tiles left");
  v = s.version;
  const concurrent = await Promise.all([1, 2].map(() => call(`/api/rooms/${code}/draw`, { token: B.token, body: { source: "discard", version: v } })));
  check(concurrent.filter((x) => x.status === 200).length === 1, "double tap on draw: exactly one succeeds");
  s = await state(code, B);
  check(s.mustUse === discardA && s.hand.includes(discardA) && s.game.discardTop === null, "Bob took the discarded tile (must use it)");
  const others = s.hand.filter((t) => t !== discardA);
  check((await call(`/api/rooms/${code}/turn`, { token: B.token, body: { table: [], discard: others[0], version: s.version } })).status === 409, "ending the turn without using it = 409");
  check((await call(`/api/rooms/${code}/turn`, { token: B.token, body: { table: [], discard: discardA, version: s.version } })).status === 409, "discarding the taken tile = 409");
  check((await call(`/api/rooms/${code}/skip`, { token: A.token, body: {} })).status === 200, "host skips Bob");
  s = await state(code, C);
  check(s.game.currentPlayerId === C.playerId && s.game.discardTop === discardA, "skip returns the taken tile and passes to Cris");
  check((await state(code, B)).hand.length === 14 && (await state(code, B)).mustUse === null, "Bob is back to 14 tiles");

  console.log("Rejoin mid-round");
  const cHand = [...s.hand].sort();
  const reC = await call(`/api/rooms/${code}/join`, { body: { nickname: "Cris", password: "pw", deviceId: C.deviceId } });
  check(reC.status === 200 && reC.data.playerId === C.playerId, "Cris rejoins from the same device mid-round");
  check((await call(`/api/rooms/${code}/state`, { token: C.token })).status === 401, "Cris's old token is dead");
  C.token = reC.data.token;
  s = await state(code, C);
  check(JSON.stringify([...s.hand].sort()) === JSON.stringify(cHand) && s.game.currentPlayerId === C.playerId, "same hand, still on turn");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Cris", password: "pw", deviceId: randomUUID() } })).status === 409, "seat taken over from another device while connected = 409");

  console.log("Spectator (joins a running round)");
  const E = await join("Eva");
  check(E.status === 200 && E.spectator === true, "Eva joins mid-round as a spectator");
  let se = await state(code, E);
  check(
    se.role === "spectator" && se.hand === null && se.mustUse === null && Array.isArray(se.game?.table) && !se.players.some((p) => p.id === E.playerId),
    "spectator sees the public table, no hand, not a player",
  );
  check(!/"pile"|"hands"|"drawn"/.test(JSON.stringify(se)), "spectator sees no hidden tiles");
  check((await state(code, A)).spectators.some((x) => x.id === E.playerId && !x.queued), "players see Eva in the spectator list");
  check((await call(`/api/rooms/${code}/draw`, { token: E.token, body: { source: "pile", version: se.version } })).status === 403, "spectator draw = 403");
  check((await call(`/api/rooms/${code}/turn`, { token: E.token, body: { table: [], discard: 0, version: se.version } })).status === 403, "spectator turn = 403");
  check((await call(`/api/rooms/${code}/queue`, { token: C.token, body: { queued: true } })).status === 409, "a player cannot queue = 409");
  check((await call(`/api/rooms/${code}/queue`, { token: E.token, body: { queued: true } })).data.queued === true, "Eva queues for the next round");
  check((await state(code, A)).spectators.find((x) => x.id === E.playerId)?.queued === true, "players see her queued");
  check((await call(`/api/rooms/${code}/queue`, { token: E.token, body: {} })).data.queued === false, "queue toggle without a value flips it off");
  await call(`/api/rooms/${code}/queue`, { token: E.token, body: { queued: true } });
  const reE = await call(`/api/rooms/${code}/join`, { body: { nickname: "Eva", password: "pw", deviceId: E.deviceId } });
  check(reE.status === 200 && reE.data.playerId === E.playerId, "spectator rejoins from the same device");
  if (reE.data.token) E.token = reE.data.token;
  se = await state(code, E);
  check(se.role === "spectator" && se.queued === true, "still a queued spectator after the rejoin");

  console.log("Kick with Ignoră, pending kick enforced");
  const k1 = await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: D.playerId } });
  check(k1.status === 200 && k1.data.pending === true, "kick in game is pending");
  s = await state(code, D);
  check(s.me.kickRemainingMs > 0 && s.me.kickRemainingMs <= 10_000, "kicked player sees the countdown");
  check((await call(`/api/rooms/${code}/kick/ignore`, { token: D.token, body: {} })).status === 200, "Ignoră");
  check((await state(code, D)).me.kickRemainingMs === null, "kick cleared, Dan stays");
  await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: D.playerId } });
  await sleep(12_500);
  check((await call(`/api/rooms/${code}/state`, { token: D.token })).status === 401, "kick enforced after 12 s");
  s = await state(code, A);
  check(!s.game.order.includes(D.playerId) && s.players.length === 3 && s.game.handCounts[D.playerId] === undefined, "Dan's hand left the round");
  check(s.room.status === "playing" && s.game.currentPlayerId === C.playerId, "round goes on, still Cris's turn");

  console.log("Play round 1 to the end");
  const byId = { [A.playerId]: A, [B.playerId]: B, [C.playerId]: C };
  let guard = 0;
  let melds = 0;
  while (s.room.status === "playing" && guard++ < 200) {
    const p = byId[s.game.currentPlayerId];
    const res = await botTurn(code, p);
    if (res.status !== 200) {
      check(false, `turn failed: ${res.status} ${res.data.error}`);
      break;
    }
    const before = s.game.table.length;
    s = await state(code, A);
    if (s.game.table.length > before) melds++;
  }
  check(s.room.status === "finished" && s.game.result && !s.game.result.cancelled, `round over after ${guard} turns (${melds} turns put formations down)`);
  const res1 = s.game.result;
  const finalViews = await Promise.all([A, B, C].map((p) => state(code, p)));
  check(finalViews.every((x) => JSON.stringify(x.game.result) === JSON.stringify(res1)), "everyone sees the same result");
  check(finalViews.every((x) => x.hand !== null && x.game.table.every((f) => checkFormation(f.tiles))), "every formation on the table is valid");
  const expected = {};
  for (const id of s.game.order) {
    const factor = res1.fromHand ? 2 : 1;
    if (id === res1.closerId) expected[id] = res1.fromHand ? -100 : -50;
    else if (!s.game.melded[id]) expected[id] = 100 * factor;
    else expected[id] = res1.hands[id].reduce((sum, t) => sum + handValue(t), 0) * factor;
  }
  check(JSON.stringify(expected) === JSON.stringify(res1.points), `points follow the rules (${res1.closerId ? "closed by " + byId[res1.closerId].name : "pile ran out"}: ${JSON.stringify(Object.fromEntries(Object.entries(res1.points).map(([id, p]) => [byId[id].name, p])))})`);
  const tableTiles = s.game.table.flatMap((f) => f.tiles);
  const handTiles = Object.values(res1.hands).flat();
  const all = [...tableTiles, ...handTiles];
  check(new Set(all).size === all.length, "no tile is both on the table and in a hand");
  check(s.history.length === 1 && s.players.every((p) => p.total === res1.points[p.id]), "history and totals match the result");
  check((await call(`/api/rooms/${code}/draw`, { token: A.token, body: { source: "pile" } })).status === 409, "draw after the round = 409");

  console.log("New round");
  check((await call(`/api/rooms/${code}/new-round`, { token: B.token, body: {} })).status === 403, "non-host new round = 403");
  check((await call(`/api/rooms/${code}/new-round`, { token: A.token, body: {} })).status === 200, "host new round");
  check((await call(`/api/rooms/${code}/new-round`, { token: A.token, body: {} })).status === 409, "second new round = 409");
  s = await state(code, B);
  check(s.room.status === "lobby" && s.room.round === 2 && s.players.every((p) => !p.ready) && s.game === null, "lobby of round 2, ready reset");
  se = await state(code, E);
  check(
    se.role === "player" && s.players.length === 4 && s.players.at(-1)?.id === E.playerId && s.spectators.length === 0,
    "queued spectator Eva sits down (last seat)",
  );
  for (const p of [A, B, C, E]) await call(`/api/rooms/${code}/ready`, { token: p.token, body: { ready: true } });
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 200, "start round 2");
  s = await state(code, B);
  check(s.game.currentPlayerId === B.playerId && s.hand.length === 15, "the starter rotates: Bob starts round 2 with 15 tiles");
  check((await state(code, E)).hand?.length === 14 && s.game.order.includes(E.playerId), "Eva plays round 2 with 14 tiles");

  console.log("Leave mid-round");
  check((await call(`/api/rooms/${code}/leave`, { token: B.token, body: {} })).status === 200, "Bob leaves on his turn");
  s = await state(code, A);
  check(s.room.status === "playing" && s.game.order.length === 3 && s.game.currentPlayerId === C.playerId && s.game.phase === "draw", "turn passes to Cris");
  check((await call(`/api/rooms/${code}/leave`, { token: E.token, body: {} })).status === 200, "Eva leaves");
  s = await state(code, A);
  check(s.room.status === "playing" && s.game.order.length === 2, "two players left, the round goes on");
  check((await call(`/api/rooms/${code}/leave`, { token: C.token, body: {} })).status === 200, "Cris leaves");
  s = await state(code, A);
  check(s.room.status === "finished" && s.game.result?.cancelled === true, "one player left: round cancelled");
  check(s.history.length === 1, "a cancelled round adds no points");
  check(s.room.hostPlayerId === A.playerId, "Ana is still host");

  console.log("Cleanup");
  const last = await call(`/api/rooms/${code}/leave`, { token: A.token, body: {} });
  check(last.data.roomClosed === true, "last one out closes the room");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "X", password: "pw" } })).status === 404, "room gone");
  check(!(await call("/api/rooms")).data.rooms?.some((x) => x.code === code), "room gone from the list");
  created.delete(code);
}

/** Supabase URL + service key: environment (GitHub Actions secrets) first, else .env.local. */
function supabaseEnv() {
  const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (NEXT_PUBLIC_SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) return { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
  return Object.fromEntries(
    readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
}

/** Safety net: delete rooms left behind by a failed run, straight in the DB (service key from env or .env.local). */
async function cleanup() {
  if (created.size === 0) return;
  try {
    const env = supabaseEnv();
    const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/remi_rooms?code=in.(${[...created].join(",")})&name=like.e2e-test-*`;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(url, { method: "DELETE", headers: { apikey: key, authorization: `Bearer ${key}` } });
    console.log(`  cleanup: deleted leftover rooms ${[...created].join(", ")} (${res.status})`);
  } catch (err) {
    console.log("  cleanup failed, delete these rooms by hand:", [...created].join(", "), err.message);
  }
}

try {
  await main();
} catch (err) {
  failures++;
  console.error(err);
} finally {
  await cleanup();
}
console.log(failures === 0 ? "\nE2E OK" : `\nE2E FAILED: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
