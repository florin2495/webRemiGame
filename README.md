# webRemiGame

Remi pe tablă multiplayer, pentru 2–4 jucători, jucat pe telefon între prieteni.
Next.js 16 (App Router), Supabase (Postgres + Realtime Broadcast), deploy pe Vercel (fra1, Frankfurt).
Face parte din hub-ul [hailatat.icu](https://hailatat.icu) și rulează pe https://games.hailatat.icu/remi.

## Reguli implementate

- 106 piese: 1–13 în 4 culori, câte 2 din fiecare, plus 2 jokeri. 14 piese de jucător, primul are 15 și doar aruncă.
- Tura: tragi din pachet sau iei ultima piesă aruncată (care trebuie folosită pe masă în aceeași tură),
  faci formații, arunci o piesă.
- Formații: serie (același număr, 3–4 culori diferite) și scară (aceeași culoare, ≥3 consecutive; 1 jos sau după 13, fără 13-1-2).
- Etalare minimă aleasă de host: 30 / 45 / 51 / 60 de puncte. După etalare poți adăuga la orice formație și poți lua
  un joker punând piesa exactă în locul lui (jokerul trebuie pus pe masă în aceeași tură).
- Închidere: arunci ultima piesă. Scor (mai puțin e mai bine): închizătorul −50, ceilalți suma pieselor din mână
  (joker 50), neetalat 100. Închidere din mână: −100 și dublu pentru ceilalți. Pachet terminat: runda se încheie fără închizător.
- Host-ul poate sări tura unui jucător absent, poate scoate jucători și pornește rundele. Scorul se adună pe runde.
- Fără „atu” (piesa întoarsă): varianta asta nu are bonusuri de atu.

## Arhitectură, pe scurt

La fel ca la Bingo: toată logica rulează în Route Handlers cu service role key; tabelele `remi_*` au RLS fără policies.
Serverul trimite un semnal Broadcast `refresh` pe `room:<uuid>` după fiecare mutare, clientul face refetch la `/state`,
care trimite fiecărui jucător doar piesele lui. Detalii în [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Setup

1. Rulează `supabase/schema.sql` în Supabase SQL Editor (proiectul comun al hub-ului).
2. `.env.local` (vezi `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
   Aceleași variabile se pun și în proiectul Vercel.
3. `npm install`, `npm run dev`.

Teste: `npm test`.
