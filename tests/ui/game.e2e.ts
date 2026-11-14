// Scenario 1: two real browsers play a live round on the deployed site: create (with a password), join by the
// invite link, ready, deal, several turns (draw from the pile, pick a tile, discard), every move reaching the other
// screen through Realtime (well under the 15 s polling fallback). Then the guest leaves mid-round, the host sees the
// round cancelled live, starts a new round and leaves, which closes the room. Runs on every project.
import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, leaveAll, playTurns, readyAndStart, REALTIME_MS, withPlayers } from "./helpers";

const TURNS = 4;

test("two players play a live round", async ({ browser }) => {
  await withPlayers(browser, ["Ana", "Bob"], async (players, room) => {
    const [host, guest] = players;

    await test.step("host creates a room with a password, the guest joins by link", async () => {
      room.code = await createRoom(host);
      await joinRoom(guest, room.code);
      await expect(guest.page.getByTestId("ready")).toBeVisible();
      await expect(host.page.getByTestId("player-list")).toContainText(guest.name, { timeout: REALTIME_MS });
    });

    await test.step("both get ready, the host deals", () => readyAndStart(players));

    await test.step(`${TURNS} turns, every move seen live`, () => playTurns(players, room.code, TURNS));

    await test.step("the guest leaves mid-round, the host sees the round cancelled live", async () => {
      await leaveAll([guest]);
      await expect(host.page.getByTestId("round-result")).toContainText("Runda a fost anulată", { timeout: REALTIME_MS });
    });

    await test.step("host starts a new round, then leaves: the room closes", async () => {
      await host.page.getByTestId("new-round").click();
      await expect(host.page.getByTestId("ready")).toBeVisible();
      await leaveAll([host]);
      room.closed = true;
    });
  });
});
