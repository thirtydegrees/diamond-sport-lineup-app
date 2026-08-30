-- ============================================
-- Diamond Lineup - migration 0002
-- Atomic personal-team provisioning
--
-- Run ONCE in the Supabase dashboard (SQL Editor), after
-- 0001_init.sql.
--
-- Why: the app used select-then-insert to find/create the
-- signed-in user's team. Two devices signing into a brand-new
-- account at the same time could each create a team, splitting
-- the account's data. This makes provisioning atomic:
--   * at most one personal team per owner (unique index)
--   * one RPC the client calls that either returns the existing
--     team or creates it, safe under concurrency
-- ============================================

-- At most one personal team per user
alter table public.teams
  add column if not exists is_personal boolean not null default true;

create unique index if not exists one_personal_team_per_owner
  on public.teams (owner)
  where is_personal;

-- Returns the caller's personal team id, creating it if needed.
-- Concurrency-safe: a unique violation from a racing insert falls
-- back to selecting the winner's row.
create or replace function public.get_or_create_personal_team()
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  tid uuid;
begin
  select id into tid
    from public.teams
   where owner = auth.uid() and is_personal
   order by created_at asc
   limit 1;
  if tid is not null then
    return tid;
  end if;

  begin
    insert into public.teams (owner, name, is_personal)
    values (auth.uid(), 'My Team', true)
    returning id into tid;
  exception when unique_violation then
    select id into tid
      from public.teams
     where owner = auth.uid() and is_personal
     order by created_at asc
     limit 1;
  end;

  return tid;
end;
$$;

revoke all on function public.get_or_create_personal_team() from public;
grant execute on function public.get_or_create_personal_team() to authenticated;
