@AGENTS.md

# webRemiGame - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webRemiGame`, public). Never the work account.
  Local git identity is pinned in `.git/config`.
- Vercel project is connected by hand by the user. Functions run in **fra1** (Frankfurt, `vercel.json`), next to the DB.
  Production URL: https://games.hailatat.icu/remi (basePath `/remi`; the hub proxies `/remi/*` to this project)
- Feedback (`POST /api/feedback`) writes to `hub_feedback` (owned by florin2495/hailataticu-hub, slug `remi`).
- Ask the user before pushing (= deploying), unless they explicitly say to deploy.
- **Before every push, bump the patch version** in `package.json` (and `npm install --package-lock-only`).
  It is shown in-game next to "Setări".

## Database (shared Supabase project, same as every hub game)
Migrations are run by hand in the Supabase SQL editor - nothing records them in the DB,
so this list is the source of truth. **Update it whenever the user confirms a migration ran.**

| Migration | Applied to the live DB | Notes |
| --- | --- | --- |
| `supabase/schema.sql` (initial) | yes (2026-11-07, verified: tables exist, anon gets 401, e2e passed) | `remi_rooms`, `remi_players`, `remi_rounds` |
| `supabase/migrations/001_pending_kick.sql` | yes (2026-11-07, verified) | `remi_players.kick_requested_at timestamptz` (kick during a game waits 10 s, "Ignoră"). Do not push before it is run. |
| `supabase/migrations/002_reconnect.sql` | yes (2026-11-07, verified: service role 200, anon 401) | `remi_players.last_seen_at`, `device_hash` + index (rejoin the same seat). Do not push before it is run. |
| `supabase/migrations/003_seat_spectators.sql` | yes, verified 2026-11-14 by effect: production E2E exercises its columns (seat order, spectators, queue) | `remi_players.seat`, `role` ('player'/'spectator'), `queued_at`: host reorder (`POST /reorder`), spectators max 16 + `POST /queue`. Do not push before it is run. |

Rules for schema changes:
- Every object of this game is prefixed `remi_` (tables, constraints, indexes). Table names live in `T` in `src/lib/server/db.ts`.
- New migration = new numbered file in `supabase/migrations/`, additive when possible, folded into `supabase/schema.sql` too.
- Code that needs a migration must not be pushed until the user has run it. Verify it by effect with the
  service key from `.env.local`.
- Never print or commit the keys in `.env.local`.

## Abandoned rooms (600 s)
- `GET /api/rooms` (the room list behind "Intră în cameră") first runs `cleanupAbandonedRooms` (`src/lib/server/room.ts`):
  every room in ANY status (also `playing`) whose `last_activity_at` is older than `ROOM_ABANDONED_MS` (600 s, `remi.ts`)
  and with no player/spectator `last_seen_at` within 600 s is deleted (players and rounds cascade). Open room pages keep
  both fresh (`/state` polls every 60 s, plus a refresh on every Realtime event / tab return; a member request stamps
  `last_seen_at` at most every 10 s and the room at most every 20 s), so only rooms nobody has open disappear. The
  10-minute lobby/finished expiry stays too. Unit-tested with a mocked DB in `src/lib/server/room.test.ts`.
- A missing room shows a neutral "Camera nu mai există (a fost închisă după inactivitate)." (`GONE`, room page).

## Game logic
- All rules are pure functions in `src/lib/remi.ts` (deal, draw, playTurn, skipTurn, removeFromRound, scoring).
  The server re-validates every turn with them; the client uses `arrange` / `checkFormation` only for UX.
- A round's whole state is one jsonb row in `remi_rounds`; moves are conditional updates on `version`.
- Rejoin the same seat (`src/lib/reconnect.ts`): every member request stamps `last_seen_at` (≤ every 10 s);
  re-joining with an existing nickname reclaims that seat (new token, same player id and hand) from the same device
  (`device_hash`) or once the seat has been unseen for 301 s (`DISCONNECT_MS`, also the "deconectat" badge), also mid-round. `/state` exposes only a derived `connected` flag.
- Play order = `remi_players.seat` (host reorders in the lobby via `POST /reorder`); round 1 starts with seat 0, the starter then rotates one seat per round (`roundTurnOrder`).
- Spectators (`role = 'spectator'`, max 16 (`MAX_SPECTATORS`; the UI does not state the limit, only the error when full), `src/lib/seats.ts`): whoever joins a running or full room; they see only the public state. `POST /queue` toggles "Intră la runda următoare"; `new-round` seats the queue in order while there are free seats.
- Leaderboard (contract C, `src/lib/server/leaderboard.ts`): when a round finishes (not cancelled) it is reported to the hub's `hub_leaderboard` / `hub_leaderboard_rounds` (idempotent). Rooms named `e2e-test-…` are never reported (`isTestRoom`, `src/lib/leaderboard.ts`). Winner = the closer, or the lowest score if nobody closed. **Needs the hub migration `002_hub_leaderboard.sql` to be run before pushing** (until then the report just logs an error).
- No teams: 2-4 players, each for themself (the user dropped the 4-player team option on 2026-11-07).

## Testing (GitHub Actions, manual only)
All checks run in GitHub Actions on the free tier (public repo, standard `ubuntu-latest` runners only, never billed
runners), never locally (user's rule, see `D:\_DEv\CLAUDE.md`). Every workflow is `workflow_dispatch`
only (no automatic trigger, the user's choice): nothing gates a push, and Vercel deploys `main` regardless.
Start one with `gh workflow run <file> --ref main`, then `gh run watch` (or the Actions tab, "Run workflow").

| Workflow | Runs |
| --- | --- |
| `.github/workflows/check.yml` "Check code" | `npx next typegen` + `npx tsc --noEmit` (typegen first, so route types in `.next/types` are checked), `npx eslint src`, `npx next build`. Every step runs even if an earlier one failed |
| `.github/workflows/unit-tests.yml` "Unit tests" | `npm test` (Vitest: `src/lib/remi.test.ts` rules + a 200-round bot simulation checking tile conservation, `rack`, `kick`, `reconnect`, `seats`, `leaderboard` tests, and `src/lib/server/room.test.ts` (abandoned-rooms cleanup, Supabase client mocked); no real DB. `vitest.config.ts` maps `@/` to `src/`) |
| `.github/workflows/e2e.yml` "E2E" | `node scripts/e2e.mjs <base_url>` (input, default production `https://games.hailatat.icu/remi`); one run at a time |
| `.github/workflows/e2e-ui.yml` "E2E UI (Playwright)" | `npx playwright test` (`playwright.config.ts`, tests in `tests/ui/*.e2e.ts`) against `base_url` (`E2E_BASE_URL`, default production), on desktop Chromium and an emulated iPhone 13 (WebKit). Same concurrency group as "E2E". On failure the report (traces, screenshots, videos) is uploaded as the `playwright-report` artifact |

- E2E needs the repo secrets `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (only for the cleanup safety net;
  locally the script falls back to `.env.local`). It checks that the deployed client JS contains the `package.json`
  version of the checked-out ref, so run it on `main` after the Vercel deploy of that version has finished.
- What E2E does: checks page / `_next` assets / version / manifest / icons / `room/XXXXXX` over HTTP and that
  `009web-remi-game.vercel.app/remi` serves the same build, API in fra1, then drives the real API (production DB) with
  up to 4 players: create (password, bad etalare / nickname = 400), join, wrong / missing password, unknown room, duplicate
  nickname, public room list, forged tokens, rejoin (same device, old token dead, other device = 409), a 5th person in a
  full lobby = spectator, lobby kick and leave, settings (reset ready), ready, double start, hidden hands, illegal moves
  (out of turn, bad source, foreign tiles, invalid formation, stale version), discard-pile rule (must use the taken tile),
  host skip, rejoin mid-round, spectators (join mid-round, no hand, 403 on draw / turn, queue toggle, spectator rejoin,
  seated by the next round), kick with "Ignoră" and pending kick enforced, a full bot-played round 1 with validated
  scoring, new round (starter rotates), leave mid-round down to a cancelled round, last one out closes the room.
  Rooms are named `e2e-test-…` and deleted at the end; it never calls `/api/feedback`.
- What E2E UI does (`tests/ui/`, shared steps in `helpers.ts`; every change must reach the other screens within 5 s
  without a reload, polling is 60 s, so this checks Realtime). Tiles are random, so the tests read the rack from the DOM
  and only draw from the pile and discard (always legal):
  - `game.e2e.ts` (both projects): two browser contexts (= two devices) create a password room, join by link, ready,
    deal (15 / 14 tiles), 4 turns (draw, select, discard) each seen live by the other screen, the guest leaves mid-round
    (host sees the round cancelled live), new round, host leaves and the room closes.
  - `spectator.e2e.ts` (desktop Chromium only): a third person joins mid-round = spectator (no rack, no player buttons),
    the players see them, they see every discard live, queue (seen by the players), see the end of the round, and the
    new round makes them a player.
  - `mobile.e2e.ts` (iPhone only): no horizontal scroll on home / lobby / game, every rack tile >= 24 px, main buttons
    >= 44 px high, touch taps select a tile and discard it.
  Rooms are `e2e-test-ui-…`; a leftover is deleted with the service key from the same repo secrets.
- Playwright files are `*.e2e.ts`, never `*.spec.ts` / `*.test.ts` (Vitest would pick those up).
- The UI tests find elements by `data-testid`: `home-submit`, `join-submit`, `ready`, `start-game`, `player-list`,
  `turn-status` (with `data-my-turn` = "draw"/"play" on your turn), `pile-count`, `draw-pile`, `discard-top`
  (`data-tile` = top tile id), `table`, `my-hand`, `my-rack` (tiles carry `data-tile` = tile id and `aria-pressed`),
  `make-formation`, `discard`, `round-result`, `new-round`, `leave`, `spectator-status`, `queue-toggle`,
  `spectator-list` (items with `data-queued`). Renaming or removing one breaks `tests/ui`.
