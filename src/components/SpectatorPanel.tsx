"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import type { RoomState } from "@/lib/types";
import { OfflineBadge } from "./PlayerList";
import { Button, Card, ErrorText } from "./ui";

interface Props {
  state: RoomState;
  token: string;
  refresh: () => Promise<void>;
}

/** Spectators: the "Intră la runda următoare" toggle for the caller, and the list of who is watching. */
export function SpectatorPanel({ state, token, refresh }: Props) {
  const { room, me, role, queued, spectators } = state;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isSpectator = role === "spectator";
  if (!isSpectator && spectators.length === 0) return null;

  async function toggle() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/rooms/${room.code}/queue`, { token, body: { queued: !queued } });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      {isSpectator && (
        <div className="flex flex-col gap-2">
          <p className="text-sm" data-testid="spectator-status">
            Ești <strong>spectator</strong>: vezi masa, dar nu poți juca și nu vezi piesele nimănui.
            {room.status === "playing" ? " Runda e în desfășurare." : ""}
          </p>
          <Button variant={queued ? "secondary" : "primary"} disabled={busy} onClick={() => void toggle()} data-testid="queue-toggle">
            {queued ? "Nu mai intru la runda următoare" : "Intră la runda următoare"}
          </Button>
          {queued && (
            <p className="text-xs text-zinc-500">
              Ești în coadă. Intri în joc când host-ul pornește runda nouă, dacă sunt locuri libere.
            </p>
          )}
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      {spectators.length > 0 && (
        <div>
          <h2 className="mb-1 text-sm font-bold">
            Spectatori ({spectators.length})
          </h2>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm" data-testid="spectator-list">
            {spectators.map((s) => (
              <li key={s.id} className="flex items-center gap-1" data-queued={s.queued ? "true" : undefined}>
                <span>
                  {s.nickname}
                  {s.id === me.id && <span className="text-zinc-500"> (tu)</span>}
                </span>
                {s.queued && <span title="Intră la runda următoare">⏭</span>}
                <OfflineBadge connected={s.connected} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
