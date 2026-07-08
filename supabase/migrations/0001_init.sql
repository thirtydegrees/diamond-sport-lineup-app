-- ============================================
-- Diamond Lineup - initial schema
--
-- Run this ONCE in the Supabase dashboard:
--   SQL Editor -> New query -> paste -> Run
--
-- Model: a user owns/joins teams; each team's app data
-- is stored as one JSONB blob per storage key, giving
-- last-write-wins sync that mirrors the app's local
-- storage exactly. team_members exists from day one so
-- assistant-coach sharing can be added without a schema
-- change.
-- ============================================

create extension if not exists pgcrypto;

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default 'My Team',
  created_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'coach' check (role in ('owner', 'coach')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table public.team_data (
  team_id uuid not null references public.teams(id) on delete cascade,
  key text not null,
  value jsonb,
  updated_at timestamptz not null default now(),
  primary key (team_id, key)
);

-- Membership check that bypasses RLS (avoids policy recursion)
create or replace function public.is_team_member(t uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where team_id = t and user_id = auth.uid()
  );
$$;

-- Creating a team automatically makes the creator its owner-member
create or replace function public.handle_new_team()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.team_members (team_id, user_id, role)
  values (new.id, new.owner, 'owner');
  return new;
end;
$$;

create trigger on_team_created
  after insert on public.teams
  for each row execute function public.handle_new_team();

-- Keep updated_at fresh on sync writes
create or replace function public.touch_updated_at()
returns trigger language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger team_data_touch
  before update on public.team_data
  for each row execute function public.touch_updated_at();

-- ----------------------------------------
-- Row Level Security
-- ----------------------------------------
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_data enable row level security;

-- teams: owner check included so INSERT ... RETURNING works before the
-- membership trigger's row is visible
create policy "owners and members can view teams" on public.teams
  for select using (owner = auth.uid() or public.is_team_member(id));
create policy "signed-in users create their own teams" on public.teams
  for insert with check (owner = auth.uid());
create policy "owners update their team" on public.teams
  for update using (owner = auth.uid());
create policy "owners delete their team" on public.teams
  for delete using (owner = auth.uid());

create policy "members view team membership" on public.team_members
  for select using (user_id = auth.uid() or public.is_team_member(team_id));
create policy "owners manage membership" on public.team_members
  for insert with check (
    exists (select 1 from public.teams where id = team_id and owner = auth.uid())
  );
create policy "owners or the member remove membership" on public.team_members
  for delete using (
    user_id = auth.uid()
    or exists (select 1 from public.teams where id = team_id and owner = auth.uid())
  );

create policy "members read team data" on public.team_data
  for select using (public.is_team_member(team_id));
create policy "members insert team data" on public.team_data
  for insert with check (public.is_team_member(team_id));
create policy "members update team data" on public.team_data
  for update using (public.is_team_member(team_id));
create policy "members delete team data" on public.team_data
  for delete using (public.is_team_member(team_id));
