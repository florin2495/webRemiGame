-- Remi (pe tablă) multiplayer - Supabase schema
-- The Supabase project is shared by every hub mini-game, so every object here is prefixed remi_
-- (tables, constraints, indexes). Keep the prefix on anything new.
-- Run this whole file once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Idempotent: re-running it drops nothing.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- remi_rooms: one row per room. Rules chosen by the host live here.
-- ---------------------------------------------------------------------------
create table if not exists public.remi_rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  name             text not null check (char_length(name) between 1 and 40),
  password_hash    text,                                   -- scrypt hash, null = no password
  min_meld         smallint not null default 45
                   constraint remi_rooms_min_meld_check check (min_meld in (30, 45, 51, 60)),
  status           text not null default 'lobby'
                   constraint remi_rooms_status_check check (status in ('lobby', 'playing', 'finished')),
  round            integer not null default 1 check (round >= 1),
  host_player_id   uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now()      -- lobby/finished rooms idle a few minutes are deleted
);
create index if not exists remi_rooms_status_activity_idx on public.remi_rooms (status, last_activity_at);

-- ---------------------------------------------------------------------------
-- remi_players: members of a room (2-4). Identity = random token kept by the browser,
-- only its SHA-256 hash is stored.
-- ---------------------------------------------------------------------------
create table if not exists public.remi_players (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.remi_rooms (id) on delete cascade,
  nickname   text not null check (char_length(nickname) between 1 and 20),
  token_hash text not null unique,
  is_host    boolean not null default false,
  ready      boolean not null default false,
  joined_at  timestamptz not null default now(),
  kick_requested_at timestamptz,                -- pending host kick during a game (null = none), see src/lib/kick.ts
  last_seen_at timestamptz not null default now(), -- presence: disconnected after 45 s, see migrations/002
  device_hash  text,                            -- sha256 of the browser's device id, see migrations/002
  seat         integer,                         -- host-chosen play order, see migrations/003
  role         text not null default 'player'   -- 'player' | 'spectator', see migrations/003
               constraint remi_players_role_check check (role in ('player', 'spectator')),
  queued_at    timestamptz                      -- spectator waiting for the next round, see migrations/003
);
-- Existing databases: the lines above only apply to a fresh table.
alter table public.remi_players add column if not exists kick_requested_at timestamptz;
alter table public.remi_players add column if not exists last_seen_at timestamptz not null default now();
alter table public.remi_players add column if not exists device_hash text;
alter table public.remi_players add column if not exists seat integer;
alter table public.remi_players add column if not exists role text not null default 'player';
alter table public.remi_players add column if not exists queued_at timestamptz;
do $$ begin
  alter table public.remi_players add constraint remi_players_role_check check (role in ('player', 'spectator'));
exception when duplicate_object then null; end $$;
create index if not exists remi_players_room_role_idx on public.remi_players (room_id, role);
create index if not exists remi_players_room_seen_idx on public.remi_players (room_id, last_seen_at);
create unique index if not exists remi_players_room_nickname_uq on public.remi_players (room_id, lower(nickname));
create index if not exists remi_players_room_idx on public.remi_players (room_id);

do $$ begin
  alter table public.remi_rooms
    add constraint remi_rooms_host_fk foreign key (host_player_id) references public.remi_players (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- remi_rounds: the whole state of one round (pile, discard pile, table, every hand, turn,
-- and the result once it ends) in one jsonb document. Every move is a conditional
-- UPDATE ... WHERE version = <read version>, so two concurrent moves can never both win.
-- Hands and the pile are secret: only the server (service role) reads this table and it
-- sends each player their own hand only.
-- ---------------------------------------------------------------------------
create table if not exists public.remi_rounds (
  room_id    uuid not null references public.remi_rooms (id) on delete cascade,
  round      integer not null,
  version    integer not null default 1,
  state      jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint remi_rounds_pkey primary key (room_id, round)
);

-- ---------------------------------------------------------------------------
-- Security: RLS on, NO policies -> anon / authenticated can read or write nothing.
-- Only the service role (Next.js Route Handlers) touches these tables.
-- ---------------------------------------------------------------------------
alter table public.remi_rooms   enable row level security;
alter table public.remi_players enable row level security;
alter table public.remi_rounds  enable row level security;

revoke all on public.remi_rooms, public.remi_players, public.remi_rounds from anon, authenticated;
