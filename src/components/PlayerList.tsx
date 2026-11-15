"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { moveItem } from "@/lib/seats";
import type { RoomState } from "@/lib/types";
import { KickBadge } from "./KickModal";
import { ErrorText } from "./ui";

/** Shown next to a player not seen for 301 s (DISCONNECT_MS) (phone in the background, closed tab, no network). */
export function OfflineBadge({ connected }: { connected: boolean | undefined }) {
  if (connected !== false) return null;
  return (
    <span className="shrink-0 rounded bg-zinc-200 px-1.5 text-[10px] font-semibold uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
      deconectat
    </span>
  );
}

interface Props {
  state: RoomState;
  mode: "lobby" | "game";
  /** When given and the caller is host, a "Scoate" (kick) button is shown next to other players. */
  token?: string;
  refresh?: () => Promise<void>;
  /** Client time (ms) at which `state` arrived, for the pending-kick countdown. */
  receivedAt: number;
}

export function PlayerList({ state, mode, token, refresh, receivedAt }: Props) {
  const { players, me, room, game } = state;
  const canKick = Boolean(token) && room.hostPlayerId === me.id;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const showTotals = state.history.length > 0;

  const canReorder = canKick && mode === "lobby" && room.status === "lobby" && players.length > 1;

  async function move(index: number, delta: number) {
    if (!token) return;
    const order = moveItem(players.map((p) => p.id), index, delta);
    setBusy("order");
    setError("");
    try {
      await api(`/api/rooms/${room.code}/reorder`, { token, body: { order } });
      await refresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(null);
    }
  }

  async function kick(id: string, nickname: string) {
    if (!token) return;
    const midGame =
      room.status === "playing"
        ? " Are 10 secunde să refuze; dacă nu, piesele lui ies din joc și tura trece mai departe."
        : "";
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
      <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800" data-testid="player-list">
        {players.map((p, index) => {
          const inRound = Boolean(game && game.order.includes(p.id));
          const isTurn = mode === "game" && game?.currentPlayerId === p.id;
          const isCloser = mode === "game" && game?.result?.closerId === p.id;
          return (
            <li
              key={p.id}
              className={`flex items-center justify-between gap-2 py-2 ${isTurn ? "font-bold text-indigo-600 dark:text-indigo-400" : ""}`}
            >
              <span className="flex min-w-0 items-center gap-2">
                {canReorder && (
                  <span className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      onClick={() => void move(index, -1)}
                      disabled={busy !== null || index === 0}
                      className="min-h-5 min-w-8 text-xs leading-none disabled:opacity-25"
                      aria-label={`Mută pe ${p.nickname} mai sus`}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => void move(index, 1)}
                      disabled={busy !== null || index === players.length - 1}
                      className="min-h-5 min-w-8 text-xs leading-none disabled:opacity-25"
                      aria-label={`Mută pe ${p.nickname} mai jos`}
                    >
                      ▼
                    </button>
                  </span>
                )}
                {mode === "lobby" && (
                  <span className="w-4 shrink-0 text-center font-mono text-xs text-zinc-500">{index + 1}</span>
                )}
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
                <OfflineBadge connected={p.connected} />
              </span>
              <span className="flex shrink-0 items-center gap-2 text-sm">
                {p.kickRemainingMs !== null && <KickBadge remainingMs={p.kickRemainingMs} receivedAt={receivedAt} />}
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
      {mode === "lobby" && players.length > 1 && (
        <p className="mt-1 text-xs text-zinc-500">
          {room.round === 1
            ? "Începe primul din listă."
            : `Runda ${room.round} începe ${players[(room.round - 1) % players.length]?.nickname ?? ""}.`}
          {canReorder ? " Schimbă ordinea cu săgețile." : ""}
        </p>
      )}
      <ErrorText>{error}</ErrorText>
    </>
  );
}
