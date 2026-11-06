"use client";

import { colourOf, COLOUR_NAMES, isJoker, numberOf } from "@/lib/remi";

const TEXT = ["text-rose-600", "text-amber-500", "text-sky-600", "text-zinc-900"] as const;

export function tileLabel(t: number): string {
  return isJoker(t) ? "joker" : `${numberOf(t)} ${COLOUR_NAMES[colourOf(t)]}`;
}

/** One Remi tile: ivory face, coloured number, joker drawn as a star. */
export function Tile({
  tile,
  size = "md",
  selected = false,
  marked = false,
  onClick,
  disabled,
}: {
  tile: number;
  size?: "sm" | "md";
  selected?: boolean;
  /** Extra ring (e.g. the tile taken from the discard pile, which must be played). */
  marked?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const dims = size === "sm" ? "h-9 w-6 text-sm" : "h-14 w-10 text-xl";
  const face = isJoker(tile) ? (
    <span className="bg-gradient-to-br from-rose-500 via-amber-400 to-sky-500 bg-clip-text text-transparent">★</span>
  ) : (
    <span className={TEXT[colourOf(tile)]}>{numberOf(tile)}</span>
  );
  const cls = `relative flex shrink-0 select-none items-center justify-center rounded-md border font-black tabular-nums shadow-sm transition ${dims} ${
    selected
      ? "-translate-y-1.5 border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500"
      : "border-stone-300 bg-amber-50 dark:border-stone-500"
  } ${marked ? "ring-2 ring-emerald-500" : ""}`;
  if (!onClick) {
    return (
      <span className={cls} aria-label={tileLabel(tile)}>
        {face}
      </span>
    );
  }
  return (
    <button type="button" className={`${cls} disabled:opacity-60`} onClick={onClick} disabled={disabled} aria-label={tileLabel(tile)} aria-pressed={selected}>
      {face}
    </button>
  );
}

/** Face-down tile (pile). */
export function TileBack({ size = "md" }: { size?: "sm" | "md" }) {
  const dims = size === "sm" ? "h-9 w-6" : "h-14 w-10";
  return <span aria-hidden className={`block rounded-md border border-indigo-800 bg-indigo-600 shadow-sm ${dims}`} />;
}
