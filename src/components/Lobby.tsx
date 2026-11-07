"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { MAX_PLAYERS, MELD_OPTIONS, minutesLabel, MIN_PLAYERS, ROOM_IDLE_MINUTES } from "@/lib/remi";
import type { RoomState } from "@/lib/types";
import { PlayerList } from "./PlayerList";
import { Rules } from "./Rules";
import { Scoreboard } from "./Scoreboard";
import { Button, Card, ErrorText } from "./ui";

interface Props {
  state: RoomState;
  token: string;
  refresh: () => Promise<void>;
  receivedAt: number;
}

export function Lobby({ state, token, refresh, receivedAt }: Props) {
  const { room, me, players } = state;
  const base = `/api/rooms/${room.code}`;
  const isHost = room.hostPlayerId === me.id;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(false);
    }
  }

  const allReady = players.every((p) => p.ready);
  const enough = players.length >= MIN_PLAYERS;

  return (
    <>
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold">
            Jucători ({players.length}/{MAX_PLAYERS})
          </h2>
          {isHost ? (
            <label className="flex items-center gap-2 text-sm">
              Etalare
              <select
                value={room.minMeld}
                disabled={busy}
                onChange={(e) => void run(() => api(`${base}/settings`, { token, body: { minMeld: Number(e.target.value) } }))}
                className="min-h-9 rounded-lg border border-zinc-300 bg-white px-2 dark:border-zinc-700 dark:bg-zinc-900"
              >
                {MELD_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="text-sm text-zinc-500">etalare {room.minMeld}</span>
          )}
        </div>
        <PlayerList state={state} mode="lobby" token={token} refresh={refresh} receivedAt={receivedAt} />
      </Card>

      <Card className="flex flex-col gap-3">
        <Button
          variant={me.ready ? "secondary" : "primary"}
          disabled={busy}
          onClick={() => void run(() => api(`${base}/ready`, { token, body: { ready: !me.ready } }))}
        >
          {me.ready ? "Nu mai sunt gata" : "Sunt gata"}
        </Button>
        {isHost ? (
          <Button disabled={busy || !allReady || !enough} onClick={() => void run(() => api(`${base}/start`, { token, body: {} }))}>
            Împarte piesele
          </Button>
        ) : null}
        <p className="text-center text-xs text-zinc-500">
          {!enough
            ? `Așteptăm cel puțin ${MIN_PLAYERS} jucători. Trimite codul camerei prietenilor (maxim ${MAX_PLAYERS}).`
            : !allReady
              ? "Când toți sunt gata, host-ul împarte piesele."
              : isHost
                ? "Toți sunt gata. Poți împărți piesele."
                : "Toți sunt gata. Așteptăm host-ul."}
        </p>
        <p className="text-center text-xs text-zinc-500">
          Camera se închide după {minutesLabel(ROOM_IDLE_MINUTES)} în care nimeni nu o are deschisă.
        </p>
        <ErrorText>{error}</ErrorText>
      </Card>

      {state.history.length > 0 && <Scoreboard state={state} />}
      <Rules />
    </>
  );
}
