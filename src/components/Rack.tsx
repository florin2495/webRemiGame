"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useStringPref, writePref } from "@/lib/client/prefs";
import { moveTile, packed, parseRack, RACK_COLS, reconcile, type Slot, sortedTiles } from "@/lib/rack";
import { Tile, tileLabel } from "./Tile";

const DRAG_START_PX = 6;

interface Drag {
  tile: number;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moving: boolean;
  over: string | null;
}

/** Reads which slot (data-slot="r:c" or "new-row") is under a screen point. */
function slotAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-slot]");
  return el?.dataset.slot ?? null;
}

function toSlot(key: string): Slot | null {
  if (key === "new-row") return "new-row";
  const [r, c] = key.split(":").map(Number);
  return Number.isInteger(r) && Number.isInteger(c) ? { row: r, col: c } : null;
}

/**
 * The player's rack: rows of RACK_COLS slots. Tap a tile to select it, drag it to any slot
 * (empty = move, occupied = swap) or onto the + under the last row to open a new row.
 * Empty rows disappear. The layout is remembered on this device for the room and round.
 */
export function Rack({
  storageKey,
  hand,
  selected,
  mustUse,
  disabled,
  onToggle,
}: {
  storageKey: string;
  hand: number[];
  selected: number[];
  mustUse: number | null;
  disabled?: boolean;
  onToggle: (tile: number) => void;
}) {
  const raw = useStringPref(storageKey);
  const rack = reconcile(parseRack(raw), hand);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const save = (next: ReturnType<typeof reconcile>) => writePref(storageKey, JSON.stringify(next));
  const set = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>, tile: number) {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    set({ tile, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, moving: false, over: null });
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const moving = d.moving || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > DRAG_START_PX;
    set({ ...d, x: e.clientX, y: e.clientY, moving, over: moving ? slotAt(e.clientX, e.clientY) : null });
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    set(null);
    if (!d.moving) {
      onToggle(d.tile);
      return;
    }
    const key = slotAt(e.clientX, e.clientY);
    const to = key ? toSlot(key) : null;
    if (to) save(moveTile(rack, d.tile, to));
  }

  const slotClass = (key: string) =>
    `relative aspect-[5/7] rounded-md ${
      drag?.moving && drag.over === key ? "bg-indigo-200/70 ring-2 ring-indigo-400 dark:bg-indigo-900/60" : "bg-zinc-100 dark:bg-zinc-900"
    }`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end gap-1 text-xs">
        <span className="mr-auto text-zinc-500">Aranjează:</span>
        {(["colour", "number"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => save(packed(sortedTiles(hand, m)))}
            className="rounded-md bg-zinc-200 px-2 py-1 font-semibold dark:bg-zinc-800"
          >
            {m === "colour" ? "după culoare" : "după număr"}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 rounded-xl bg-amber-900/15 p-1.5 pt-2.5 dark:bg-amber-200/10">
        {rack.map((row, r) => (
          <div key={r} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${RACK_COLS}, minmax(0, 1fr))` }}>
            {row.map((t, c) => {
              const key = `${r}:${c}`;
              const lifted = drag?.moving && drag.tile === t;
              return (
                <div key={c} data-slot={key} className={slotClass(key)}>
                  {t !== null && (
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={tileLabel(t)}
                      aria-pressed={selected.includes(t)}
                      onPointerDown={(e) => onPointerDown(e, t)}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={() => set(null)}
                      onKeyDown={(e) => {
                        if (!disabled && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          onToggle(t);
                        }
                      }}
                      className={`absolute inset-0 touch-none ${disabled ? "" : "cursor-grab"} ${lifted ? "opacity-30" : ""}`}
                    >
                      <Tile tile={t} size="fill" selected={selected.includes(t)} marked={t === mustUse} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {/* The + in the bottom-right corner: drop a tile here to open a new row. */}
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${RACK_COLS}, minmax(0, 1fr))` }}>
          <div
            data-slot="new-row"
            aria-label="Trage o piesă aici ca să adaugi un rând"
            className={`col-start-[-2] flex aspect-[5/7] items-center justify-center rounded-md border-2 border-dashed text-2xl font-light transition ${
              drag?.moving
                ? drag.over === "new-row"
                  ? "border-indigo-500 bg-indigo-200/70 text-indigo-600 dark:bg-indigo-900/60"
                  : "border-indigo-300 text-indigo-400"
                : "border-zinc-300/60 text-zinc-400/60 dark:border-zinc-700/60"
            }`}
          >
            +
          </div>
        </div>
      </div>

      {drag?.moving && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 h-14 w-10 -translate-x-1/2 -translate-y-1/2 drop-shadow-xl"
          style={{ left: drag.x, top: drag.y }}
        >
          <Tile tile={drag.tile} size="fill" />
        </div>
      )}
    </div>
  );
}
