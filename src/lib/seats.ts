// Pure helpers for the host-chosen player order and for spectators. Used by server and client.

/** Spectators allowed per room (more -> a clear error on join). */
export const MAX_SPECTATORS = 16;

export const spectatorsFullMessage = `Sunt deja ${MAX_SPECTATORS} spectatori în cameră. Mai încearcă puțin mai târziu.`;

/** True when `order` is a full permutation of `playerIds` (same ids, no duplicates, nothing missing). */
export function isPermutation(order: unknown, playerIds: string[]): order is string[] {
  if (!Array.isArray(order) || order.length !== playerIds.length) return false;
  if (order.some((id) => typeof id !== "string")) return false;
  const set = new Set<string>(order);
  return set.size === order.length && playerIds.every((id) => set.has(id));
}

/** Moves the item at `index` by `delta` (-1 up, +1 down). Out of range returns the list unchanged. */
export function moveItem<T>(list: T[], index: number, delta: number): T[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** Spectators in the queue become players in queue order (queuedAt ascending) while there are free seats. */
export function promotable<T extends { queuedAt: string | null }>(spectators: T[], freeSeats: number): T[] {
  return spectators
    .filter((s) => s.queuedAt !== null)
    .sort((a, b) => Date.parse(a.queuedAt as string) - Date.parse(b.queuedAt as string))
    .slice(0, Math.max(0, freeSeats));
}
