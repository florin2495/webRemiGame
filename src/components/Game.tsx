"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { PREF_CONFIRM_DISCARD, useBoolPref } from "@/lib/client/prefs";
import { arrange, checkFormation, type Formation, handValue, isJoker } from "@/lib/remi";
import type { RoomState } from "@/lib/types";
import { PlayerList } from "./PlayerList";
import { Rack } from "./Rack";
import { Rules } from "./Rules";
import { Scoreboard } from "./Scoreboard";
import { Tile, tileLabel, TileBack } from "./Tile";
import { Button, Card, ErrorText } from "./ui";

interface Props {
  state: RoomState;
  token: string;
  refresh: () => Promise<void>;
  receivedAt: number;
}

/** The player's moves of the current turn, kept locally until they discard. */
interface Draft {
  key: string;
  table: Formation[];
  hand: number[];
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `f${Date.now()}${Math.random()}`.slice(0, 30);

export function Game({ state, token, refresh, receivedAt }: Props) {
  const { room, me, game, players } = state;
  const base = `/api/rooms/${room.code}`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [confirmDiscard] = useBoolPref(PREF_CONFIRM_DISCARD, false);

  // Local draft, reset whenever the server state moves on (new version).
  const key = `${room.round}:${state.version}`;
  const [draftRaw, setDraft] = useState<Draft | null>(null);
  const draft: Draft =
    draftRaw && draftRaw.key === key ? draftRaw : { key, table: game?.table ?? [], hand: state.hand ?? [] };

  if (!game) return null;
  const nick = (id: string) => players.find((p) => p.id === id)?.nickname ?? "—";
  const result = game.result;
  const myTurn = !result && game.currentPlayerId === me.id;
  const canPlay = myTurn && game.phase === "play";
  const melded = game.melded[me.id] ?? false;
  const serverIds = new Set(game.table.map((f) => f.id));
  const serverTiles = new Set(game.table.flatMap((f) => f.tiles));
  const dirty = [...draft.hand].sort().join() !== [...(state.hand ?? [])].sort().join();
  const newFormations = draft.table.filter((f) => !serverIds.has(f.id));
  const meldValue = newFormations.reduce((s, f) => s + (checkFormation(f.tiles)?.value ?? 0), 0);
  const handSel = selected.filter((t) => draft.hand.includes(t));
  const isHost = room.hostPlayerId === me.id;

  function update(table: Formation[], hand: number[]) {
    setDraft({ key, table, hand });
    setSelected([]);
    setError("");
  }

  function reset() {
    setDraft(null);
    setSelected([]);
    setError("");
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setDraft(null);
      setSelected([]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  function toggle(t: number) {
    setError("");
    setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  }

  function makeFormation() {
    const tiles = arrange(handSel);
    if (!tiles) {
      setError("Piesele alese nu formează o serie (același număr, culori diferite) sau o scară (aceeași culoare, consecutive).");
      return;
    }
    update([...draft.table, { id: newId(), owner: me.id, tiles }], draft.hand.filter((t) => !handSel.includes(t)));
  }

  function tapFormation(f: Formation) {
    if (!canPlay || busy) return;
    if (handSel.length === 0) {
      // A formation made this turn goes back to the hand.
      if (!serverIds.has(f.id)) update(draft.table.filter((x) => x.id !== f.id), [...draft.hand, ...f.tiles]);
      return;
    }
    if (serverIds.has(f.id) && !melded) {
      setError("Întâi te etalezi cu formațiile tale, apoi poți adăuga la cele de pe masă.");
      return;
    }
    const tiles = arrange([...f.tiles, ...handSel]);
    if (!tiles) {
      setError("Piesele alese nu se potrivesc în formația asta.");
      return;
    }
    update(
      draft.table.map((x) => (x.id === f.id ? { ...x, tiles } : x)),
      draft.hand.filter((t) => !handSel.includes(t)),
    );
  }

  /** Swap a joker on the table for the exact tile it stands for. */
  function tapJoker(f: Formation, joker: number) {
    if (!canPlay || busy || handSel.length !== 1) return false;
    if (serverIds.has(f.id) && !melded) {
      setError("Poți lua jokerul doar după ce te-ai etalat.");
      return true;
    }
    const real = handSel[0];
    const tiles = f.tiles.map((t) => (t === joker ? real : t));
    if (!checkFormation(tiles)) {
      setError(`${tileLabel(real)} nu ține locul jokerului din formația asta.`);
      return true;
    }
    update(
      draft.table.map((x) => (x.id === f.id ? { ...x, tiles } : x)),
      [...draft.hand.filter((t) => t !== real), joker],
    );
    return true;
  }

  async function discard() {
    if (handSel.length !== 1) return;
    const tile = handSel[0];
    const closing = draft.hand.length === 1;
    if (confirmDiscard && !window.confirm(closing ? `Arunci ${tileLabel(tile)} și închizi?` : `Arunci ${tileLabel(tile)}?`)) return;
    await run(() => api(`${base}/turn`, { token, body: { table: draft.table, discard: tile, version: state.version } }));
  }

  const drawFrom = (source: "pile" | "discard") =>
    run(() => api(`${base}/draw`, { token, body: { source, version: state.version } }));

  const turnName = game.currentPlayerId ? nick(game.currentPlayerId) : "";
  const inRound = state.hand !== null;

  return (
    <>
      {result ? (
        <RoundResultCard state={state} token={token} refresh={refresh} />
      ) : (
        <p
          role="status"
          className={`rounded-xl px-4 py-3 text-center font-semibold ${
            myTurn ? "bg-indigo-600 text-white" : "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
          }`}
        >
          {myTurn
            ? game.phase === "draw"
              ? "E tura ta: trage din pachet sau ia piesa aruncată."
              : "E tura ta: pune formații pe masă, apoi aruncă o piesă."
            : `E tura lui ${turnName}.`}
        </p>
      )}

      {/* Pile + discard */}
      <Card className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!myTurn || game.phase !== "draw" || busy}
            onClick={() => void drawFrom("pile")}
            className="flex items-center gap-2 rounded-lg p-1 disabled:cursor-default enabled:hover:bg-zinc-100 dark:enabled:hover:bg-zinc-900"
            aria-label="Trage din pachet"
          >
            <TileBack />
            <span className="text-left text-xs text-zinc-500">
              <span className="block font-mono text-base font-bold text-zinc-800 dark:text-zinc-200">{game.pileCount}</span>
              în pachet
            </span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-right text-xs text-zinc-500">
            aruncată
            <span className="block">({game.discardCount})</span>
          </span>
          {game.discardTop !== null ? (
            <Tile
              tile={game.discardTop}
              onClick={myTurn && game.phase === "draw" && !busy ? () => void drawFrom("discard") : undefined}
            />
          ) : (
            <span className="block h-14 w-10 rounded-md border-2 border-dashed border-zinc-300 dark:border-zinc-700" />
          )}
        </div>
      </Card>
      {myTurn && game.phase === "draw" && (
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={busy} onClick={() => void drawFrom("pile")}>
            Trage din pachet
          </Button>
          <Button variant="secondary" disabled={busy || game.discardTop === null} onClick={() => void drawFrom("discard")}>
            Ia piesa aruncată
          </Button>
        </div>
      )}

      {/* Table */}
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold">Masa</h2>
          {canPlay && handSel.length > 0 && <span className="text-xs text-zinc-500">Atinge o formație ca să adaugi piesele alese.</span>}
        </div>
        {draft.table.length === 0 ? (
          <p className="py-3 text-center text-sm text-zinc-500">Nimeni nu s-a etalat încă.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {draft.table.map((f) => {
              const changed = !serverIds.has(f.id) || f.tiles.some((t) => !serverTiles.has(t));
              return (
                <li key={f.id}>
                  <div
                    role={canPlay ? "button" : undefined}
                    tabIndex={canPlay ? 0 : undefined}
                    onClick={() => tapFormation(f)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && tapFormation(f)}
                    className={`flex flex-col gap-0.5 rounded-lg border p-1 ${
                      changed ? "border-dashed border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/40" : "border-zinc-200 dark:border-zinc-800"
                    } ${canPlay ? "cursor-pointer" : ""}`}
                  >
                    <span className="flex gap-0.5">
                      {f.tiles.map((t) =>
                        isJoker(t) && canPlay && handSel.length === 1 ? (
                          <span
                            key={t}
                            role="button"
                            tabIndex={0}
                            aria-label="Schimbă jokerul cu piesa aleasă"
                            className="rounded-md ring-2 ring-amber-400"
                            onClick={(e) => {
                              e.stopPropagation();
                              tapJoker(f, t);
                            }}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter" && e.key !== " ") return;
                              e.stopPropagation();
                              tapJoker(f, t);
                            }}
                          >
                            <Tile tile={t} size="sm" />
                          </span>
                        ) : (
                          <Tile key={t} tile={t} size="sm" />
                        ),
                      )}
                    </span>
                    <span className="truncate px-0.5 text-[10px] text-zinc-500">{nick(f.owner)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* My hand */}
      {inRound && !result && (
        <Card className="flex flex-col gap-3">
          <h2 className="font-bold">
            Tabla ta <span className="font-normal text-zinc-500">({draft.hand.length} piese)</span>
          </h2>
          <Rack
            storageKey={`remi:rack:${room.code}:${room.round}`}
            hand={draft.hand}
            selected={handSel}
            mustUse={state.mustUse}
            disabled={busy}
            onToggle={toggle}
          />
          <p className="text-xs text-zinc-500">
            Atinge o piesă ca s-o alegi. Trage-o oriunde pe tablă (poți lăsa goluri) sau pe + ca să faci un rând nou.
          </p>
          {state.mustUse !== null && draft.hand.includes(state.mustUse) && (
            <p className="text-xs text-emerald-700 dark:text-emerald-400">
              Piesa încercuită ({tileLabel(state.mustUse)}) e luată de jos: trebuie pusă pe masă în tura asta.
            </p>
          )}
          {canPlay && !melded && (
            <p className="text-xs text-zinc-500">
              Etalare: <b className={meldValue >= room.minMeld ? "text-emerald-600" : ""}>{meldValue}</b> / {room.minMeld} puncte
              {meldValue > 0 && meldValue < room.minMeld ? " (nu ajunge încă)" : ""}
            </p>
          )}
          {canPlay && (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={busy || handSel.length < 3} onClick={makeFormation}>
                Formație nouă{handSel.length >= 3 ? ` (${handSel.length})` : ""}
              </Button>
              <Button disabled={busy || handSel.length !== 1} onClick={() => void discard()}>
                {handSel.length === 1
                  ? draft.hand.length === 1
                    ? `Aruncă ${tileLabel(handSel[0])} și închide`
                    : `Aruncă ${tileLabel(handSel[0])}`
                  : "Alege o piesă de aruncat"}
              </Button>
              {dirty && (
                <Button variant="secondary" className="col-span-2" disabled={busy} onClick={reset}>
                  Anulează mutările din tura asta
                </Button>
              )}
            </div>
          )}
          {canPlay && (
            <p className="text-xs text-zinc-500">
              Alege piese și apasă „Formație nouă” sau atinge o formație de pe masă ca să le adaugi. Cu o piesă aleasă, atinge un
              joker de pe masă ca să-l schimbi. O formație nouă atinsă fără piese alese se întoarce în mână.
            </p>
          )}
          <ErrorText>{error}</ErrorText>
        </Card>
      )}
      {!inRound && !result && (
        <p className="text-center text-sm text-zinc-500">Ai intrat după împărțire. Joci din runda următoare.</p>
      )}
      {(!inRound || result || !canPlay) && error && <ErrorText>{error}</ErrorText>}

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold">Jucători</h2>
          {isHost && !result && !myTurn && game.currentPlayerId && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Sari tura lui ${turnName}? Dacă a tras deja, piesa trasă se aruncă.`)) {
                  void run(() => api(`${base}/skip`, { token, body: {} }));
                }
              }}
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-semibold dark:border-zinc-700"
            >
              Sari tura
            </button>
          )}
        </div>
        <PlayerList state={state} mode="game" token={token} refresh={refresh} receivedAt={receivedAt} />
      </Card>

      <Scoreboard state={state} />
      <Rules />
    </>
  );
}

function RoundResultCard({ state, token, refresh }: Omit<Props, "receivedAt">) {
  const { room, me, game, players } = state;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const result = game!.result!;
  const nick = (id: string) => players.find((p) => p.id === id)?.nickname ?? "—";
  const isHost = room.hostPlayerId === me.id;

  async function newRound() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/rooms/${room.code}/new-round`, { token, body: {} });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(false);
    }
  }

  const title = result.cancelled
    ? "Runda a fost anulată: au rămas prea puțini jucători."
    : result.closerId
      ? `${result.closerId === me.id ? "Ai închis" : `${nick(result.closerId)} a închis`}${result.fromHand ? " din mână! Punctele se dublează." : "!"}`
      : "S-a terminat pachetul. Nimeni nu a închis.";

  return (
    <Card className="flex flex-col gap-3 border-amber-300 dark:border-amber-800">
      <p role="status" className="text-center text-lg font-black">
        {result.closerId === me.id ? "🏆 " : ""}
        {title}
      </p>
      {!result.cancelled && (
        <ul className="flex flex-col gap-2">
          {Object.entries(result.hands).map(([id, tiles]) => (
            <li key={id} className="flex flex-col gap-1">
              <span className="flex justify-between text-sm">
                <span className="font-semibold">{nick(id)}</span>
                <span className="font-mono">{result.points[id] > 0 ? `+${result.points[id]}` : result.points[id]}</span>
              </span>
              {tiles.length > 0 && (
                <span className="flex flex-wrap gap-0.5">
                  {[...tiles].sort((a, b) => handValue(b) - handValue(a)).map((t) => (
                    <Tile key={t} tile={t} size="sm" />
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {isHost ? (
        <Button disabled={busy} onClick={() => void newRound()}>
          Rundă nouă
        </Button>
      ) : (
        <p className="text-center text-sm text-zinc-500">Host-ul poate porni o rundă nouă.</p>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
