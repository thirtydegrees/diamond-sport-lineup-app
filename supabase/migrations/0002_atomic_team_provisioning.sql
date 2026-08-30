-- ============================================
-- Diamond Lineup - migration 0002
-- Atomic personal-team provisioning + multi-team support
--
-- Run ONCE in the Supabase dashboard (SQL Editor), after
-- 0001_init.sql. Safe to re-run (idempotent).
--
-- Why: the app used select-then-insert to find/create the
-- signed-in user's team. Two devices signing into a brand-new
-- account at the same time could each create a team, splitting
-- the account's data. This makes provisioning atomic:
--   * exactly one PERSONAL team per owner (partial unique index)
--   * additional teams are allowed (is_personal = false) - one
--     coach can run several teams
--   * one RPC the client calls that either returns the existing
--     personal team or creates it, safe under concurrency
--
-- Duplicate handling: if the old race already created several
-- teams for one owner, the EARLIEST becomes the personal team
-- and the rest are demoted to ordinary teams (nothing is
-- deleted - their data stays reachable through the app's team
-- switcher).
-- ============================================

alter table public.teams
  add column if not exists is_personal boolean not null default true;

-- Demote all but the earliest team per owner BEFORE creating the unique
-- index, so the migration cannot fail on the exact condition it fixes.
update public.teams t
   set is_personal = false
 where is_personal
   and exists (
     select 1 from public.teams e
      where e.owner = t.owner
        and e.is_personal
        and (e.created_at < t.created_at
             or (e.created_at = t.created_at and e.id < t.id))
   );

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

-- Verification (optional): should return zero rows
--   select owner, count(*) from public.teams
--   where is_personal group by owner having count(*) > 1;
