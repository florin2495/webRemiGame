# Arhitectură

Același model ca Bingo (`001_Bingo/docs/ARCHITECTURE.md`): Route Handlers cu service role key, RLS fără policies,
Realtime Broadcast doar ca semnal de refresh, identitate prin token aleator (în DB doar SHA-256), parolă scrypt.

## Ce e diferit la Remi

1. **O rundă = un document jsonb** în `remi_rounds.state`: pachet, piese aruncate, masă, mâna fiecăruia, tura, faza
   (`draw` / `play`) și rezultatul. Fiecare mutare citește rândul, aplică o funcție pură din `src/lib/remi.ts` și scrie
   cu `UPDATE ... WHERE version = <citită>`. Două mutări simultane nu pot câștiga amândouă, fără lock-uri.
2. **Clientul trimite tura întreagă** (`POST /turn { table, discard, version }`): masa așa cum a lăsat-o plus piesa
   aruncată. Serverul verifică tot (piese conservate, formații valide, etalare minimă, joker luat doar prin schimb,
   piesa luată de jos folosită). Până la aruncare, mutările sunt doar locale și se pot anula.
3. **Informația secretă** (mâinile, pachetul) nu pleacă niciodată la alți jucători: `/state` trimite doar mâna ta,
   numărul de piese al celorlalți și piesa de deasupra pachetului de aruncate. Mâinile tuturor apar doar la final de rundă.
4. **Scorul** e calculat din `state.result` al fiecărei runde terminate, adunat la citire.

## Fluxul stărilor

`lobby` → (host: împarte, toți gata, 2–4 jucători) → `playing` → (închidere / pachet gol / prea puțini jucători)
→ `finished` → (host: rundă nouă) → `lobby`

## API (toate sub `/api/rooms`)

| Metodă | Rută | Cine | Ce face |
| --- | --- | --- | --- |
| GET/POST | `/api/rooms` | oricine | listă camere / creează camera + host |
| POST | `/[code]/join` | oricine, între runde | intră (maxim 4) |
| GET | `/[code]/state` | membru | starea + mâna proprie |
| POST | `/[code]/ready` | membru, lobby | gata / nu |
| POST | `/[code]/settings` | host, lobby | etalarea minimă |
| POST | `/[code]/start` | host, toți gata | împarte piesele |
| POST | `/[code]/draw` | jucătorul la tură | trage din pachet sau ia piesa aruncată |
| POST | `/[code]/turn` | jucătorul la tură | masa nouă + piesa aruncată |
| POST | `/[code]/skip` | host | sare tura (piesa trasă se aruncă) |
| POST | `/[code]/new-round` | host, finished | rundă nouă |
| POST | `/[code]/leave`, `/[code]/kick` | membru / host | ieșire / scoatere |
