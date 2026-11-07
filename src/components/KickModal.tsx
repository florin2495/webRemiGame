"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { KICK_NETWORK_GRACE_MS } from "@/lib/kick";
import type { RoomState } from "@/lib/types";
import { Button, ErrorText } from "./ui";

/** Wall-clock "now" that ticks while `active`. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/** Whole seconds left (rounded up) for a remaining-ms value received at `receivedAt`. */
export function secondsLeft(remainingMs: number, receivedAt: number, now: number): number {
  return Math.max(0, Math.ceil((remainingMs - (now - receivedAt)) / 1000));
}

/** "iese în N s" label for a player with a pending kick. */
export function KickBadge({ remainingMs, receivedAt }: { remainingMs: number; receivedAt: number }) {
  const now = useNow(true);
  return (
    <span className="rounded bg-rose-100 px-1.5 text-xs font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
      iese în {secondsLeft(remainingMs, receivedAt, now)} s
    </span>
  );
}

interface Props {
  state: RoomState;
  receivedAt: number;
  token: string;
  refresh: () => Promise<void>;
}

/**
 * Blocking modal for the player whose kick is pending, plus the refresh timers: when any pending kick's
 * countdown reaches 0 every client refreshes once (and once more after the server's network slack),
 * so the removal is enforced promptly even though the poll interval is long.
 */
export function KickModal({ state, receivedAt, token, refresh }: Props) {
  const mine = state.me.kickRemainingMs;
  const pending = state.players.map((p) => p.kickRemainingMs).filter((v): v is number => v !== null);
  const soonest = pending.length > 0 ? Math.min(...pending) : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const now = useNow(mine !== null);

  useEffect(() => {
    if (soonest === null) return;
    const wait = Math.max(0, soonest - (Date.now() - receivedAt));
    const first = window.setTimeout(() => void refresh(), wait + 200);
    const second = window.setTimeout(() => void refresh(), wait + KICK_NETWORK_GRACE_MS + 500);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
    };
  }, [soonest, receivedAt, refresh]);

  if (mine === null) return null;

  async function ignore() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/rooms/${state.room.code}/kick/ignore`, { token, body: {} });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="kick-title"
        aria-describedby="kick-text"
        className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 text-center text-zinc-900 shadow-xl dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
      >
        <h2 id="kick-title" className="text-xl font-black">
          Ai fost scos din joc
        </h2>
        <p id="kick-text" className="mt-2 text-sm">
          Gazda te-a scos din cameră. Apasă „Ignoră” în {secondsLeft(mine, receivedAt, now)} s ca să rămâi în joc.
        </p>
        <p aria-hidden className="my-3 font-mono text-5xl font-black text-rose-600 dark:text-rose-400">
          {secondsLeft(mine, receivedAt, now)}
        </p>
        <ErrorText>{error}</ErrorText>
        <Button className="mt-2 w-full" onClick={() => void ignore()} disabled={busy}>
          Ignoră
        </Button>
      </div>
    </div>
  );
}
