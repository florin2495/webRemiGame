import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Table names. The Supabase project is shared by every hub mini-game,
 * so every Remi table carries the remi_ prefix.
 */
export const T = {
  rooms: "remi_rooms",
  players: "remi_players",
  rounds: "remi_rounds",
} as const;

let admin: SupabaseClient | null = null;

/** Service-role client. Bypasses RLS - must never be imported from client code. */
export function db(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

export interface RoomRow {
  id: string;
  code: string;
  name: string;
  password_hash: string | null;
  min_meld: number;
  status: "lobby" | "playing" | "finished";
  round: number;
  host_player_id: string | null;
  last_activity_at: string;
}

export interface PlayerRow {
  id: string;
  room_id: string;
  nickname: string;
  is_host: boolean;
  ready: boolean;
  joined_at: string;
  /** Pending host kick during a game (null = none). */
  kick_requested_at: string | null;
  /** Presence stamp, touched by requireMember. Needs migration 002_reconnect.sql. */
  last_seen_at: string;
  /** Host-chosen play order (null = not placed yet). Needs migration 003_seat_spectators.sql. */
  seat: number | null;
  role: "player" | "spectator";
  /** Spectators only: set while waiting for the next round. */
  queued_at: string | null;
}

/** Never add token_hash / device_hash here: these rows feed the public state. */
export const PLAYER_COLUMNS = "id, room_id, nickname, is_host, ready, joined_at, kick_requested_at, last_seen_at, seat, role, queued_at";
export const ROOM_COLUMNS = "id, code, name, password_hash, min_meld, status, round, host_player_id, last_activity_at";
