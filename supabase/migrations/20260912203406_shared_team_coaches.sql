-- Existing teams/snapshots remain canonical. Membership is the access boundary.
-- A creator account must not cascade-delete a shared team's history.
alter table public.teams drop constraint teams_owner_fkey;
alter table public.teams add constraint teams_owner_fkey foreign key (owner) references auth.users(id) on delete restrict;
insert into public.team_members(team_id,user_id,role)
select id,owner,'owner' from public.teams
on conflict(team_id,user_id) do update set role='owner';
update public.team_members m set role='coach' from public.teams t where m.team_id=t.id and m.user_id<>t.owner and m.role<>'coach';
create index if not exists team_members_user_id_idx on public.team_members(user_id,team_id);

-- Membership changes are serialized with snapshot writes through guarded RPCs.
revoke all on public.team_members from public,anon,authenticated;
grant select on public.team_members to authenticated;
drop policy "owners manage membership" on public.team_members;
drop policy "owners or the member remove membership" on public.team_members;
revoke delete on public.teams from public,anon,authenticated;
grant select on public.teams to authenticated;
-- Coaches can rename the team; ownership/kind columns remain non-writable.
drop policy "owners update their team" on public.teams;
create policy "members rename team" on public.teams for update to authenticated
using(public.is_team_member(id)) with check(public.is_team_member(id));
alter function public.is_team_member(uuid) set search_path = '';
-- The existing body qualifies team_members via public; replace to fix search_path.
create or replace function public.is_team_member(t uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.team_members where team_id=t and user_id=auth.uid());
$$;
revoke all on function public.is_team_member(uuid) from public,anon;
grant execute on function public.is_team_member(uuid) to authenticated;

create schema if not exists team_access;
revoke all on schema team_access from public,anon,authenticated;
grant usage on schema team_access to authenticated;
create table team_access.invitations (
 id uuid primary key default gen_random_uuid(),
 team_id uuid not null references public.teams(id) on delete cascade,
 email text not null check(email=lower(btrim(email)) and length(email) between 3 and 254),
 expires_at timestamptz not null default now()+interval '7 days',
 accepted_by uuid references auth.users(id) on delete set null,
 accepted_at timestamptz,
 cancelled_at timestamptz,
 unique(team_id,email)
);
alter table team_access.invitations enable row level security;
revoke all on team_access.invitations from public,anon,authenticated;
create index invitations_email_idx on team_access.invitations(email);

-- Only the owner can enumerate team emails, invite, cancel or remove coaches.
create function team_access.manage(target_team uuid, operation text, target_email text default null, target_user uuid default null, invitation_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid; normalized_email text; result_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select owner into owner_id from public.teams where id=target_team and owner=auth.uid() for update;
 if not found then raise exception 'Only the team owner can manage coaches' using errcode='42501'; end if;
 if operation='invite' then
  normalized_email:=lower(btrim(target_email));
  if normalized_email is null or length(normalized_email)>254 or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
   raise exception 'Enter a valid email address' using errcode='22023';
  end if;
  if exists(select 1 from public.team_members m join auth.users u on u.id=m.user_id where m.team_id=target_team and lower(u.email)=normalized_email) then
   return jsonb_build_object('already_member',true);
  end if;
  insert into team_access.invitations(team_id,email) values(target_team,normalized_email)
  on conflict(team_id,email) do update set id=gen_random_uuid(), expires_at=now()+interval '7 days',accepted_by=null,accepted_at=null,cancelled_at=null
  returning id into result_id;
  return jsonb_build_object('id',result_id,'already_member',false);
 elsif operation='remove' then
  if target_user is null or target_user=owner_id then raise exception 'The team owner cannot be removed' using errcode='22023'; end if;
  delete from public.team_members where team_id=target_team and user_id=target_user;
  update team_access.invitations set cancelled_at=now() where team_id=target_team and accepted_by=target_user;
  return '{}'::jsonb;
 elsif operation='cancel' then
  update team_access.invitations set cancelled_at=now() where id=invitation_id and team_id=target_team and accepted_at is null;
  return '{}'::jsonb;
 elsif operation='list' then
  return jsonb_build_object(
   'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,'role',case when m.user_id=owner_id then 'owner' else 'coach' end) order by m.created_at) from public.team_members m join auth.users u on u.id=m.user_id where m.team_id=target_team),'[]'::jsonb),
   'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'email',email,'expires_at',expires_at) order by email) from team_access.invitations where team_id=target_team and accepted_at is null and cancelled_at is null and expires_at>now()),'[]'::jsonb));
 else raise exception 'Invalid membership operation' using errcode='22023'; end if;
end;
$$;

-- Verify the email against Supabase Auth, never user-editable metadata or input.
create function team_access.pending() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'team_id',i.team_id,'team_name',t.name,'expires_at',i.expires_at) order by t.name),'[]'::jsonb)
 from team_access.invitations i join public.teams t on t.id=i.team_id join auth.users u on u.id=auth.uid()
 where u.email_confirmed_at is not null and lower(u.email)=i.email and i.cancelled_at is null and i.accepted_at is null and i.expires_at>now();
$$;

create function team_access.accept(invitation_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare recipient text; tid uuid; invitation team_access.invitations;
begin
 select lower(email) into recipient from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if recipient is null then raise exception 'Sign in with the verified email that was invited' using errcode='42501'; end if;
 select team_id into tid from team_access.invitations where id=invitation_id and email=recipient;
 if tid is null then raise exception 'Invitation unavailable' using errcode='42501'; end if;
 -- Same lock order as removal and snapshot CAS. A removed coach cannot race a write.
 perform 1 from public.teams where id=tid for update;
 select * into invitation from team_access.invitations where id=invitation_id and email=recipient for update;
 if not found or invitation.cancelled_at is not null then raise exception 'Invitation unavailable' using errcode='42501'; end if;
 if invitation.accepted_by=auth.uid() and public.is_team_member(tid) then return tid; end if;
 if invitation.accepted_at is not null or invitation.expires_at<=now() then raise exception 'Invitation expired or unavailable. Ask the owner to invite you again.' using errcode='42501'; end if;
 insert into public.team_members(team_id,user_id,role) values(tid,auth.uid(),'coach') on conflict do nothing;
 update team_access.invitations set accepted_by=auth.uid(),accepted_at=now() where id=invitation_id;
 return tid;
end;
$$;

revoke all on all functions in schema team_access from public,anon,authenticated;
grant execute on function team_access.manage(uuid,text,text,uuid,uuid), team_access.pending(), team_access.accept(uuid) to authenticated;
-- Public invoker wrappers expose only the guarded operations via PostgREST.
create function public.manage_team_access(target_team uuid, operation text, target_email text default null, target_user uuid default null, invitation_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$select team_access.manage(target_team,operation,target_email,target_user,invitation_id)$$;
create function public.my_team_invitations() returns jsonb language sql security invoker set search_path='' as $$select team_access.pending()$$;
create function public.accept_team_invitation(invitation_id uuid) returns uuid language sql security invoker set search_path='' as $$select team_access.accept(invitation_id)$$;
revoke all on function public.manage_team_access(uuid,text,text,uuid,uuid), public.my_team_invitations(), public.accept_team_invitation(uuid) from public,anon,authenticated;
grant execute on function public.manage_team_access(uuid,text,text,uuid,uuid), public.my_team_invitations(), public.accept_team_invitation(uuid) to authenticated;

-- Trigger functions are internal, never client RPCs.
revoke execute on function public.handle_new_team() from public,anon,authenticated;
create or replace function public.handle_new_team()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.team_members(team_id,user_id,role) values(new.id,new.owner,'owner');
 return new;
end;
$$;
