// Scenario 2: someone opens the invite link of a running round. They become a spectator (no rack, no player
// buttons), the players see them live, they see every move live, they queue for the next round ("Intră la runda
// următoare"), see the end of the round, and the host's "Rundă nouă" seats them as a player. Desktop Chromium only:
// it checks game logic and Realtime, the device does not matter (scenario 1 already runs on WebKit).
import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, leaveAll, playTurns, rack, readyAndStart, REALTIME_MS, withPlayers } from "./helpers";

test("a late joiner watches as a spectator and plays from the next round", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop-chromium", "game logic, one browser is enough");

  await withPlayers(browser, ["Ana", "Bob", "Cris"], async (players, room) => {
    const [host, guest, spectator] = players;

    await test.step("two players start a round", async () => {
      room.code = await createRoom(host);
      await joinRoom(guest, room.code);
      await readyAndStart([host, guest]);
    });

    await test.step("a third person joins mid-round and becomes a spectator", async () => {
      await joinRoom(spectator, room.code);
      const sp = spectator.page;
      await expect(sp.getByTestId("spectator-status")).toContainText("Runda e în desfășurare");
      await expect(rack(spectator)).toHaveCount(0);
      for (const id of ["my-hand", "discard", "draw-pile", "ready", "new-round"]) await expect(sp.getByTestId(id)).toHaveCount(0);
      await expect(sp.getByTestId("table")).toBeVisible();
      for (const p of [host, guest]) {
        await expect(p.page.getByTestId("spectator-list")).toContainText(spectator.name, { timeout: REALTIME_MS });
      }
    });

    await test.step("the spectator queues for the next round, the players see it live", async () => {
      await spectator.page.getByTestId("queue-toggle").click();
      await expect(spectator.page.getByTestId("queue-toggle")).toHaveText("Nu mai intru la runda următoare");
      await expect(host.page.getByTestId("spectator-list").locator('li[data-queued="true"]')).toContainText(spectator.name, {
        timeout: REALTIME_MS,
      });
    });

    await test.step("the players take turns; the spectator sees every move live", () =>
      playTurns([host, guest], room.code, 3, [spectator]),
    );

    await test.step("the guest leaves, the spectator sees the round end", async () => {
      await leaveAll([guest]);
      await expect(spectator.page.getByTestId("round-result")).toContainText("Runda a fost anulată", { timeout: REALTIME_MS });
    });

    await test.step("new round: the queued spectator becomes a player", async () => {
      await host.page.getByTestId("new-round").click();
      await expect(spectator.page.getByTestId("ready")).toBeVisible({ timeout: REALTIME_MS });
      await expect(spectator.page.getByTestId("spectator-status")).toHaveCount(0);
      await expect(host.page.getByTestId("player-list")).toContainText(spectator.name, { timeout: REALTIME_MS });
      await expect(host.page.getByTestId("spectator-list")).toHaveCount(0);
    });

    await test.step("everyone leaves, the room closes", async () => {
      await leaveAll([spectator, host]);
      room.closed = true;
    });
  });
});
