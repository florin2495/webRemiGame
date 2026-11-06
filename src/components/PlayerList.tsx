"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import type { RoomState } from "@/lib/types";
import { ErrorText } from "./ui";

interface Props {
  state: RoomState;
  mode: "lobby" | "game";
  /** When given and the caller is host, a "Scoate" (kick) button is shown next to other players. */
  token?: string;
  refresh?: () => Promise<void>;
}

export function PlayerList({ state, mode, token, refresh }: Props) {
  const { players, me, room, game } = state;
  const canKick = Boolean(token) && room.hostPlayerId === me.id;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const showTotals = state.history.length > 0;

  async function kick(id: string, nickname: string) {
    if (!token) return;
    const midGame = room.status === "playing" ? " Piesele lui ies din joc, tura trece mai departe." : "";
    if (!window.confirm(`Scoți jucătorul ${nickname} din cameră?${midGame}`)) return;
    setBusy(id);
    setError("");
    try {
      await api(`/api/rooms/${room.code}/kick`, { token, body: { playerId: id } });
      await refresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {players.map((p) => {
          const inRound = Boolean(game && game.order.includes(p.id));
          const isTurn = mode === "game" && game?.currentPlayerId === p.id;
          const isCloser = mode === "game" && game?.result?.closerId === p.id;
          return (
            <li
              key={p.id}
              className={`flex items-center justify-between gap-2 py-2 ${isTurn ? "font-bold text-indigo-600 dark:text-indigo-400" : ""}`}
            >
              <span className="flex min-w-0 items-center gap-2">
                {mode === "game" && (
                  <span aria-hidden className="w-3 text-center">
                    {isTurn ? "▶" : ""}
                  </span>
                )}
                <span className="truncate">
                  {p.nickname}
                  {p.id === me.id && <span className="text-zinc-500"> (tu)</span>}
                </span>
                {p.isHost && (
                  <span className="rounded bg-zinc-200 px-1.5 text-[10px] font-semibold uppercase dark:bg-zinc-800">host</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-2 text-sm">
                {mode === "lobby" ? (
                  p.ready ? (
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">✓ gata</span>
                  ) : (
                    <span className="text-zinc-500">se pregătește…</span>
                  )
                ) : isCloser ? (
                  <span className="font-bold text-amber-600">🏆 a închis</span>
                ) : inRound && game ? (
                  <span className="font-normal text-zinc-500">
                    {game.handCounts[p.id]} piese{game.melded[p.id] ? " · etalat" : ""}
                  </span>
                ) : (
                  <span className="font-normal text-zinc-500">așteaptă runda</span>
                )}
                {showTotals && (
                  <span className="min-w-10 rounded bg-zinc-100 px-1.5 text-right font-mono text-xs dark:bg-zinc-800" title="Total puncte">
                    {p.total}
                  </span>
                )}
                {canKick && p.id !== me.id && (
                  <button
                    type="button"
                    onClick={() => void kick(p.id, p.nickname)}
                    disabled={busy !== null}
                    className="min-h-8 rounded-md border border-rose-300 px-2 text-xs font-semibold text-rose-600 disabled:opacity-40 dark:border-rose-800 dark:text-rose-400"
                    aria-label={`Scoate pe ${p.nickname}`}
                  >
                    {busy === p.id ? "…" : "Scoate"}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <ErrorText>{error}</ErrorText>
    </>
  );
}
