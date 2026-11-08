-- Remi: host-controlled player order (feedback A) + spectators with a "join next round" queue (feedback B).
-- Additive and idempotent. Run in the Supabase SQL editor. Do not push the matching code before it is run.
--   seat      : play order chosen by the host (null = not placed yet, goes after the placed ones, by joined_at)
--   role      : 'player' | 'spectator' (spectators never hold hands, never count towards the 2-4 players)
--   queued_at : set while a spectator waits for the next round (queue order = queued_at ascending)
alter table public.remi_players add column if not exists seat integer;
alter table public.remi_players add column if not exists role text not null default 'player';
alter table public.remi_players add column if not exists queued_at timestamptz;
do $$ begin
  alter table public.remi_players
    add constraint remi_players_role_check check (role in ('player', 'spectator'));
exception when duplicate_object then null; end $$;
create index if not exists remi_players_room_role_idx on public.remi_players (room_id, role);
