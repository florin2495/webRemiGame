// Shared steps for the Playwright UI tests (tests/ui/*.e2e.ts). Not a test file itself (no .e2e.ts suffix).
// Rooms are named "e2e-test-ui-…" with a password; a leftover is deleted with the service key (env) as a safety net.
// Tiles are random: the tests read the rack from the DOM (data-tile = tile id) and only draw from the pile and
// discard, which is always legal on your turn.
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/** A change has to show up on another screen within this, without a reload. Polling alone takes up to 15 s. */
export const REALTIME_MS = 5_000;
export const PASSWORD = "e2e-pw";

export interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
}

/** A separate browser context = a separate device (own localStorage session), with the project's device settings. */
export async function newPlayer(browser: Browser, name: string): Promise<Player> {
  const use = test.info().project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    locale: use.locale,
    viewport: use.viewport,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
  });
  return { name, context, page: await context.newPage() };
}

export const rack = (p: Player) => p.page.getByTestId("my-rack").locator("[data-tile]");
export const rackTile = (p: Player, t: number) => p.page.getByTestId("my-rack").locator(`[data-tile="${t}"]`);

/** Tile ids in the player's rack, as the UI shows them. */
export async function readRack(p: Player): Promise<number[]> {
  return rack(p).evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-tile"))));
}

/** Host creates a password-protected room from the home page; returns its code. */
export async function createRoom(host: Player): Promise<string> {
  const page = host.page;
  await page.goto("./");
  await page.getByLabel("Numele camerei").fill(`e2e-test-ui-${Date.now().toString(36)}`);
  await page.getByLabel("Nickname-ul tău").fill(host.name);
  await page.getByLabel("Parolă (opțional)").fill(PASSWORD);
  await page.getByTestId("home-submit").click();
  await page.waitForURL(/\/room\/[A-Z2-9]{6}$/);
  await expect(page.getByTestId("ready")).toBeVisible();
  return page.url().match(/\/room\/([A-Z2-9]{6})$/)![1];
}

/** Opens the invite link and joins with the player's nickname and the room password (lobby or spectator). */
export async function joinRoom(p: Player, code: string): Promise<void> {
  await p.page.goto(`room/${code}`);
  await p.page.getByLabel("Nickname-ul tău").fill(p.name);
  await p.page.getByLabel("Parolă (dacă are camera)").fill(PASSWORD);
  await p.page.getByTestId("join-submit").click();
  await expect(p.page.getByTestId("join-submit")).toBeHidden();
}

/** Every player gets ready, then the host (players[0]) deals. The host starts round 1 with 15 tiles. */
export async function readyAndStart(players: Player[]): Promise<void> {
  for (const p of players) {
    await p.page.getByTestId("ready").click();
    await expect(p.page.getByTestId("ready")).toHaveText("Nu mai sunt gata");
  }
  const host = players[0];
  await expect(host.page.getByTestId("start-game")).toBeEnabled({ timeout: REALTIME_MS });
  await host.page.getByTestId("start-game").click();
  await expect(host.page.getByTestId("turn-status")).toHaveAttribute("data-my-turn", "play");
  await expect(rack(host)).toHaveCount(15);
  for (const p of players.slice(1)) {
    await expect(p.page.getByTestId("turn-status")).toContainText(`E tura lui ${host.name}`, { timeout: REALTIME_MS });
    await expect(rack(p)).toHaveCount(14);
  }
}

/** Draws from the pile on the player's screen (their turn, draw phase). */
export async function drawFromPile(p: Player, code: string): Promise<void> {
  await expect(p.page.getByTestId("turn-status")).toHaveAttribute("data-my-turn", "draw", { timeout: REALTIME_MS });
  const before = await rack(p).count();
  await Promise.all([
    p.page.waitForResponse((r) => r.url().endsWith(`/api/rooms/${code}/draw`) && r.ok()),
    p.page.getByTestId("draw-pile").click(),
  ]);
  await expect(p.page.getByTestId("turn-status")).toHaveAttribute("data-my-turn", "play");
  await expect(rack(p)).toHaveCount(before + 1);
}

/** Selects the last tile of the rack and discards it (play phase). Returns the discarded tile id. */
export async function discardOne(p: Player, code: string, how: "click" | "tap" = "click"): Promise<number> {
  await expect(p.page.getByTestId("turn-status")).toHaveAttribute("data-my-turn", "play", { timeout: REALTIME_MS });
  const tiles = await readRack(p);
  const t = tiles[tiles.length - 1];
  const tile = rackTile(p, t);
  if (how === "tap") await tile.tap();
  else await tile.click();
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  const button = p.page.getByTestId("discard");
  await Promise.all([
    p.page.waitForResponse((r) => r.url().endsWith(`/api/rooms/${code}/turn`) && r.ok()),
    how === "tap" ? button.tap() : button.click(),
  ]);
  await expect(rackTile(p, t)).toHaveCount(0);
  await expect(p.page.getByTestId("discard-top")).toHaveAttribute("data-tile", String(t));
  return t;
}

/**
 * Plays `turns` turns round-robin in seat order (players[0] starts and already holds 15 tiles, so it only discards).
 * After every turn the other players and the `watchers` must see the discard and the pile live, and the next
 * player must see that it is their turn.
 */
export async function playTurns(players: Player[], code: string, turns: number, watchers: Player[] = []): Promise<void> {
  for (let i = 0; i < turns; i++) {
    const p = players[i % players.length];
    if (i > 0) await drawFromPile(p, code);
    const t = await discardOne(p, code);
    const pile = (await p.page.getByTestId("pile-count").textContent())?.trim();
    for (const o of [...players.filter((x) => x !== p), ...watchers]) {
      await expect(o.page.getByTestId("discard-top")).toHaveAttribute("data-tile", String(t), { timeout: REALTIME_MS });
      await expect(o.page.getByTestId("pile-count")).toHaveText(pile ?? "", { timeout: REALTIME_MS });
    }
    const next = players[(i + 1) % players.length];
    await expect(next.page.getByTestId("turn-status")).toHaveAttribute("data-my-turn", "draw", { timeout: REALTIME_MS });
  }
}

/** Leaves through the leave button (accepting the confirm), in the given order. */
export async function leaveAll(players: Player[]): Promise<void> {
  for (const p of players) {
    p.page.once("dialog", (d) => void d.accept());
    await p.page.getByTestId("leave").click();
    await expect(p.page.getByTestId("home-submit")).toBeVisible();
  }
}

/** The page must not scroll sideways (the usual mobile layout bug). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);
}

/** Safety net: delete the room straight in the DB if the UI flow did not close it. */
export async function deleteRoom(code: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log(`cleanup: no Supabase env, delete room ${code} by hand if it is still there`);
    return;
  }
  const res = await fetch(`${url}/rest/v1/remi_rooms?code=eq.${code}&name=like.e2e-test-ui-*`, {
    method: "DELETE",
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  console.log(`cleanup: room ${code} delete = ${res.status}`);
}

/** Runs `body` with fresh players; always closes their browsers and deletes the room if it was left open. */
export async function withPlayers(
  browser: Browser,
  names: string[],
  body: (players: Player[], room: { code: string; closed: boolean }) => Promise<void>,
): Promise<void> {
  const players = await Promise.all(names.map((n) => newPlayer(browser, n)));
  const room = { code: "", closed: false };
  try {
    await body(players, room);
  } finally {
    if (room.code && !room.closed) await deleteRoom(room.code);
    for (const p of players) await p.context.close();
  }
}
