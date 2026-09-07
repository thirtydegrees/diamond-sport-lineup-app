-- Coordinated cutover: legacy clients become read-only after this migration.
-- Keep team_data intact for recovery; never enable its writes again after cutover.
create table public.team_snapshots (
  team_id uuid primary key references public.teams(id) on delete cascade,
  revision bigint not null check (revision > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  mutation_id uuid not null,
  updated_at timestamptz not null default now()
);
alter table public.team_snapshots enable row level security;
create policy "members read snapshots" on public.team_snapshots
  for select to authenticated using (public.is_team_member(team_id));
revoke all on public.team_snapshots from public, anon, authenticated;
grant select on public.team_snapshots to authenticated;

-- Preserve legacy payloads, including pitchHistory, for client-side migration.
insert into public.team_snapshots(team_id, revision, snapshot, mutation_id)
select team_id, 1,
  '{"roster":[],"settings":{},"games":[],"currentGame":null,"defaultBattingOrder":null}'::jsonb
    || coalesce(jsonb_object_agg(key, value) filter (where value is not null and value <> 'null'::jsonb), '{}'::jsonb), gen_random_uuid()
from public.team_data group by team_id;

create function public.save_team_snapshot(target_team uuid, expected_revision bigint, payload jsonb, request_id uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare current_row public.team_snapshots; next_revision bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  -- Serialize all writes and first-use inserts for this team, including clear.
  perform 1 from public.teams where id = target_team for update;
  if not found or not public.is_team_member(target_team) then
    raise exception 'Team unavailable' using errcode = '42501';
  end if;
  if request_id is null or payload is null or jsonb_typeof(payload) <> 'object'
    or jsonb_typeof(payload->'roster') is distinct from 'array'
    or jsonb_typeof(payload->'games') is distinct from 'array'
    or jsonb_typeof(payload->'settings') is distinct from 'object'
    or not (payload ? 'currentGame') or not (payload ? 'defaultBattingOrder') then
    raise exception 'Invalid snapshot' using errcode = '22023';
  end if;
  select * into current_row from public.team_snapshots where team_id = target_team;
  if current_row.mutation_id = request_id then return current_row.revision; end if;
  if current_row.revision is distinct from expected_revision then
    raise exception 'Snapshot revision conflict' using errcode = '40001';
  end if;
  next_revision := coalesce(current_row.revision, 0) + 1;
  insert into public.team_snapshots(team_id, revision, snapshot, mutation_id)
  values(target_team, next_revision, payload, request_id)
  on conflict(team_id) do update set revision = excluded.revision,
    snapshot = excluded.snapshot, mutation_id = excluded.mutation_id, updated_at = now();
  return next_revision;
end;
$$;
revoke all on function public.save_team_snapshot(uuid,bigint,jsonb,uuid) from public, anon;
grant execute on function public.save_team_snapshot(uuid,bigint,jsonb,uuid) to authenticated;

create function public.create_named_team(team_name text, request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result public.teams;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if request_id is null or team_name is null or length(btrim(team_name)) not between 1 and 100 then
    raise exception 'Team name must be 1 to 100 characters' using errcode = '22023';
  end if;
  insert into public.teams(id, owner, name, is_personal)
    values(request_id, auth.uid(), btrim(team_name), false) on conflict(id) do nothing;
  select * into result from public.teams where id = request_id and owner = auth.uid();
  if not found then raise exception 'Team unavailable' using errcode = '42501'; end if;
  return jsonb_build_object('id', result.id, 'name', result.name, 'is_personal', result.is_personal);
end;
$$;
revoke all on function public.create_named_team(text,uuid) from public, anon;
grant execute on function public.create_named_team(text,uuid) to authenticated;
revoke all on function public.get_or_create_personal_team() from public, anon;
grant execute on function public.get_or_create_personal_team() to authenticated;
alter function public.touch_updated_at() set search_path = '';
revoke insert, update, delete on public.team_data from public, anon, authenticated;

-- Do not allow a team rename request to transfer ownership or alter its kind.
revoke update on public.teams from public, anon, authenticated;
grant update(name) on public.teams to authenticated;

create or replace function public.get_or_create_personal_team()
returns uuid language plpgsql security definer set search_path = '' as $$
declare tid uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select id into tid from public.teams where owner = auth.uid() and is_personal;
  if tid is not null then return tid; end if;
  begin
    insert into public.teams(owner,name,is_personal) values(auth.uid(),'My Team',true) returning id into tid;
  exception when unique_violation then
    select id into tid from public.teams where owner = auth.uid() and is_personal;
  end;
  return tid;
end;
$$;
revoke all on function public.get_or_create_personal_team() from public, anon;
grant execute on function public.get_or_create_personal_team() to authenticated;
