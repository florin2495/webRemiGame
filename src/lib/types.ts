import type { Formation, RoundResult } from "./remi";

export type RoomStatus = "lobby" | "playing" | "finished";

export interface PublicPlayer {
  id: string;
  nickname: string;
  isHost: boolean;
  ready: boolean;
  /** Sum of points over every finished round in this room (lower is better). */
  total: number;
  /** Ms left to press "Ignoră" on a pending host kick (game in progress), null if none. */
  kickRemainingMs: number | null;
  /** Seen in the last 45 s (see lib/reconnect.ts). False = phone in the background, closed tab, no network. */
  connected: boolean;
}

export interface PublicSpectator {
  id: string;
  nickname: string;
  /** Waiting for "Intră la runda următoare". */
  queued: boolean;
  connected: boolean;
}

/** What everyone at the table may see about the current round. */
export interface PublicGame {
  order: string[];
  currentPlayerId: string | null;
  phase: "draw" | "play";
  pileCount: number;
  discardTop: number | null;
  discardCount: number;
  table: Formation[];
  /** Tiles in hand per player (counts only). */
  handCounts: Record<string, number>;
  melded: Record<string, boolean>;
  /** Every hand and the points - only once the round is over. */
  result: RoundResult | null;
}

/** What GET /api/rooms/[code]/state returns to a member. Never contains other players' tiles mid-round. */
export interface RoomState {
  room: {
    id: string;
    code: string;
    name: string;
    minMeld: number;
    status: RoomStatus;
    round: number;
    hasPassword: boolean;
    hostPlayerId: string | null;
  };
  /** Turn order while playing/finished (others after), join order in the lobby. */
  players: PublicPlayer[];
  me: PublicPlayer;
  /** "spectator": watches only (joined a running game or a full room), can queue for the next round. */
  role: "player" | "spectator";
  /** Spectator waiting for the next round. */
  queued: boolean;
  spectators: PublicSpectator[];
  game: PublicGame | null;
  /** The caller's own hand, null if they are not in the current round. */
  hand: number[] | null;
  /** Tile taken from the discard pile this turn (must be played). */
  mustUse: number | null;
  /** Server version of the round, sent back with every move. */
  version: number | null;
  /** Points per finished round, oldest first. */
  history: { round: number; points: Record<string, number> }[];
}

/** Item of the public room list (GET /api/rooms). */
export interface RoomListItem {
  code: string;
  name: string;
  minMeld: number;
  hasPassword: boolean;
  /** Seated players (spectators are not counted). */
  players: number;
  status: RoomStatus;
}

export interface Session {
  playerId: string;
  token: string;
}
