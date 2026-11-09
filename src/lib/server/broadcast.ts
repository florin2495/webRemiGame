import "server-only";
import { db } from "./db";

export const roomTopic = (roomId: string) => `room:${roomId}`;

/**
 * Tells every client in the room that state changed. Payload carries no game data:
 * clients re-fetch /state (authenticated). Failures are logged, never thrown -
 * the DB write already succeeded and clients also poll as a fallback.
 * `at` (round + version just saved) lets the actor skip the re-fetch: it already has that state from its own response.
 */
export async function notifyRoom(roomId: string, kind: string, at?: { round: number; version: number }): Promise<void> {
  const channel = db().channel(roomTopic(roomId));
  try {
    const res = await channel.httpSend("refresh", { kind, at: Date.now(), ...at });
    if (!res.success) console.error("broadcast failed", res.status, res.error);
  } catch (err) {
    console.error("broadcast failed", err);
  } finally {
    await db().removeChannel(channel);
  }
}
