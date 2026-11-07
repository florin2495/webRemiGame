-- Kick during a running game waits 10 s and can be ignored (null = no pending kick).
alter table public.remi_players add column if not exists kick_requested_at timestamptz;
