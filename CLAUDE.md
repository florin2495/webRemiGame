@AGENTS.md

# webRemiGame - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webRemiGame`, private). Never the work account.
  Local git identity is pinned in `.git/config`.
- Vercel project is connected by hand by the user. Functions run in **fra1** (Frankfurt, `vercel.json`), next to the DB.
  Production domain: https://remi.hailatat.icu
- Feedback (`POST /api/feedback`) writes to `hub_feedback` (owned by florin2495/hailataticu-hub, slug `remi`).
- Ask the user before pushing (= deploying), unless they explicitly say to deploy.
- **Before every push, bump the patch version** in `package.json` (and `npm install --package-lock-only`).
  It is shown in-game next to "Setări".

## Database (shared Supabase project, same as every hub game)
Migrations are run by hand in the Supabase SQL editor - nothing records them in the DB,
so this list is the source of truth. **Update it whenever the user confirms a migration ran.**

| Migration | Applied to the live DB | Notes |
| --- | --- | --- |
| `supabase/schema.sql` (initial) | **no - pending** | `remi_rooms`, `remi_players`, `remi_rounds` |

Rules for schema changes:
- Every object of this game is prefixed `remi_` (tables, constraints, indexes). Table names live in `T` in `src/lib/server/db.ts`.
- New migration = new numbered file in `supabase/migrations/`, additive when possible, folded into `supabase/schema.sql` too.
- Code that needs a migration must not be pushed until the user has run it. Verify it by effect with the
  service key from `.env.local`.
- Never print or commit the keys in `.env.local`.

## Game logic
- All rules are pure functions in `src/lib/remi.ts` (deal, draw, playTurn, skipTurn, removeFromRound, scoring).
  The server re-validates every turn with them; the client uses `arrange` / `checkFormation` only for UX.
- A round's whole state is one jsonb row in `remi_rounds`; moves are conditional updates on `version`.
- No teams: 2-4 players, each for themself (the user dropped the 4-player team option on 2026-11-07).

## Testing
- `npm test` (Vitest: rules + a 200-round bot simulation checking tile conservation), `npx tsc --noEmit`,
  `npx eslint src`, `npx next build`.
- End-to-end: drive the real API with 2-4 players (create, join, ready, start, draw, turn, skip, leave, kick,
  new-round) against `npm run dev` (port 3009), then delete the test rooms.
