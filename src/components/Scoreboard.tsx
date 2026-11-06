"use client";

import type { RoomState } from "@/lib/types";
import { Card } from "./ui";

/** Points per round and totals. Lowest total leads. */
export function Scoreboard({ state }: { state: RoomState }) {
  const { players, history } = state;
  if (history.length === 0) return null;
  const best = Math.min(...players.map((p) => p.total));
  return (
    <Card>
      <h2 className="mb-2 font-bold">Scor</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="py-1 pr-2 font-semibold">Runda</th>
              {players.map((p) => (
                <th key={p.id} className="max-w-20 truncate px-1 py-1 text-right font-semibold">
                  {p.nickname}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.round} className="border-t border-zinc-200 dark:border-zinc-800">
                <td className="py-1 pr-2 text-zinc-500">{h.round}</td>
                {players.map((p) => (
                  <td key={p.id} className="px-1 py-1 text-right font-mono">
                    {h.points[p.id] ?? "–"}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t-2 border-zinc-300 font-bold dark:border-zinc-700">
              <td className="py-1 pr-2">Total</td>
              {players.map((p) => (
                <td key={p.id} className={`px-1 py-1 text-right font-mono ${p.total === best ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                  {p.total}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
