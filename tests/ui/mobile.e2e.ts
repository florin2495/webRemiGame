// Scenario 3 (phone only): no screen may scroll sideways (home, lobby, game), every rack tile must stay big enough to
// tap (WCAG 2.2 minimum target: 24 x 24 CSS px), the main buttons keep a 44 px height, and real touch taps select a
// tile and discard it. Scenario 1 already plays a round on the emulated iPhone; this one checks the layout.
import { expect, test } from "@playwright/test";
import {
  createRoom,
  discardOne,
  expectNoHorizontalScroll,
  joinRoom,
  leaveAll,
  rack,
  readyAndStart,
  REALTIME_MS,
  withPlayers,
} from "./helpers";

const MIN_TAP_PX = 24;
const MIN_BUTTON_PX = 44;

test("the game fits a phone screen and works by touch", async ({ browser }) => {
  test.skip(!test.info().project.use.isMobile, "phone layout only");

  await withPlayers(browser, ["Ana", "Bob"], async (players, room) => {
    const [host, guest] = players;

    await test.step("home page fits the screen", async () => {
      await host.page.goto("./");
      await expect(host.page.getByTestId("home-submit")).toBeVisible();
      await expectNoHorizontalScroll(host.page);
    });

    await test.step("lobby fits the screen", async () => {
      room.code = await createRoom(host);
      await joinRoom(guest, room.code);
      for (const p of players) await expectNoHorizontalScroll(p.page);
    });

    await test.step("game screen fits, tiles and buttons are big enough to tap", async () => {
      await readyAndStart(players);
      for (const p of players) {
        await expectNoHorizontalScroll(p.page);
        const sizes = await rack(p).evaluateAll((els) =>
          els.map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height)),
        );
        expect(sizes.length).toBeGreaterThanOrEqual(14);
        expect(Math.min(...sizes), `smallest rack tile on ${p.name}'s screen`).toBeGreaterThanOrEqual(MIN_TAP_PX);
      }
      for (const id of ["discard", "make-formation", "leave"]) {
        const box = await host.page.getByTestId(id).boundingBox();
        expect(box?.height ?? 0, `${id} button height`).toBeGreaterThanOrEqual(MIN_BUTTON_PX);
      }
    });

    await test.step("touch taps select a tile and discard it, the other phone sees it live", async () => {
      const t = await discardOne(host, room.code, "tap");
      await expect(guest.page.getByTestId("discard-top")).toHaveAttribute("data-tile", String(t), { timeout: REALTIME_MS });
      await expect(guest.page.getByTestId("turn-status")).toHaveAttribute("data-my-turn", "draw", { timeout: REALTIME_MS });
      await expectNoHorizontalScroll(guest.page);
    });

    await test.step("both leave, the room closes", async () => {
      await leaveAll([guest]);
      await expect(host.page.getByTestId("round-result")).toBeVisible({ timeout: REALTIME_MS });
      await leaveAll([host]);
      room.closed = true;
    });
  });
});
