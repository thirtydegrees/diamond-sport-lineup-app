import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {teamTestDatabase} from '../../scripts/team-test-db.mjs';
const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222', C='33333333-3333-4333-8333-333333333333';
let env: Awaited<ReturnType<typeof teamTestDatabase>>, team:string, invite:string, privateTeam:string;
const payload={roster:[{id:'p',name:'Shared Player'}],settings:{sport:'baseball'},games:[],currentGame:null,defaultBattingOrder:null};
const query=(u:string|null,sql:string,args:any[]=[])=>env.as(u,sql,args);
const manage=(u:string,op:string,email:string|null=null,member:string|null=null,id:string|null=null)=>query(u,'select public.manage_team_access($1,$2,$3,$4,$5) as result',[team,op,email,member,id]);
beforeAll(async()=>{
 env=await teamTestDatabase([{id:A,email:'a@example.test'},{id:B,email:'b@example.test'},{id:C,email:'c@example.test',verified:false}]);
 team=(await query(A,'select public.get_or_create_personal_team() as id')).rows[0].id as string;
 privateTeam=(await query(C,'select public.get_or_create_personal_team() as id')).rows[0].id as string;
 await query(A,'select public.save_team_snapshot($1,null,$2,$3)',[team,payload,crypto.randomUUID()]);
},30000);
afterAll(()=>env.db.close());
describe('shared team membership and authorization',()=>{
 it('invites by normalized email without granting premature access',async()=>{
  invite=(await manage(A,'invite',' B@Example.Test ')).rows[0].result.id;
  expect((await query(B,'select * from public.team_snapshots')).rows).toEqual([]);
  expect((await query(B,'select public.my_team_invitations() as result')).rows[0].result[0].team_id).toBe(team);
  await expect(query(C,'select public.accept_team_invitation($1)',[invite])).rejects.toMatchObject({code:'42501'});
 });
 it('joins idempotently as Coach and sees the same single canonical snapshot',async()=>{
  for(let i=0;i<2;i++) expect((await query(B,'select public.accept_team_invitation($1) as id',[invite])).rows[0].id).toBe(team);
  expect((await query(B,'select snapshot from public.team_snapshots where team_id=$1',[team])).rows[0].snapshot).toEqual(payload);
  expect((await query(B,'select role from public.team_members where user_id=$1 and team_id=$2',[B,team])).rows[0].role).toBe('coach');
  expect((await query(B,'select public.my_team_invitations() as result')).rows[0].result).toEqual([]);
 });
 it('preserves one personal team per owner despite shared personal-team membership',async()=>{
  const bTeam=(await query(B,'select public.get_or_create_personal_team() as id')).rows[0].id;
  expect(bTeam).not.toBe(team);
  expect((await query(B,'select id from public.teams')).rows).toHaveLength(2);
  expect((await query(A,'select id from public.teams where id=$1',[bTeam])).rows).toEqual([]);
 });
 it('allows coach writes and rename, and rejects a stale owner write',async()=>{
  await query(B,'select public.save_team_snapshot($1,1,$2,$3)',[team,{...payload,roster:[{id:'p',name:'Updated by Coach'}]},crypto.randomUUID()]);
  expect((await query(A,'select revision,snapshot from public.team_snapshots where team_id=$1',[team])).rows[0].snapshot.roster[0].name).toBe('Updated by Coach');
  await expect(query(A,'select public.save_team_snapshot($1,1,$2,$3)',[team,payload,crypto.randomUUID()])).rejects.toMatchObject({code:'40001'});
  expect((await query(B,"update public.teams set name='Shared Club' where id=$1 returning name",[team])).rows[0].name).toBe('Shared Club');
 });
 it('blocks membership administration, role forgery, ownership transfer and direct writes by coaches',async()=>{
  for(const op of ['list','invite','remove','cancel']) await expect(manage(B,op,'c@example.test',A,invite)).rejects.toMatchObject({code:'42501'});
  await expect(query(B,"insert into public.team_members(team_id,user_id,role) values($1,$2,'owner')",[team,C])).rejects.toMatchObject({code:'42501'});
  await expect(query(B,"update public.team_members set role='owner' where user_id=$1",[B])).rejects.toMatchObject({code:'42501'});
  await expect(query(B,'update public.teams set owner=$1 where id=$2',[B,team])).rejects.toMatchObject({code:'42501'});
  await expect(query(B,'delete from public.team_members where user_id=$1',[A])).rejects.toMatchObject({code:'42501'});
  await expect(query(B,'delete from public.team_snapshots where team_id=$1',[team])).rejects.toMatchObject({code:'42501'});
 });
 it('keeps unrelated teams isolated and invitation internals private',async()=>{
  expect((await query(B,'select * from public.teams where id=$1',[privateTeam])).rows).toEqual([]);
  expect((await query(C,'select * from public.team_snapshots where team_id=$1',[team])).rows).toEqual([]);
  await expect(query(C,'select public.save_team_snapshot($1,2,$2,$3)',[team,payload,crypto.randomUUID()])).rejects.toMatchObject({code:'42501'});
  await expect(query(B,'select * from team_access.invitations')).rejects.toMatchObject({code:'42501'});
  for(const sql of ['select public.my_team_invitations()',`select public.manage_team_access('${team}','list')`,`select public.accept_team_invitation('${invite}')`]) await expect(query(null,sql)).rejects.toMatchObject({code:'42501'});
 });
 it('requires verified server-side email and rejects cancelled or expired invitations',async()=>{
  const id=(await manage(A,'invite','c@example.test')).rows[0].result.id;
  await env.db.query("update auth.users set raw_user_meta_data=' {\"email\":\"b@example.test\",\"email_verified\":true}' where id=$1",[C]);
  await expect(query(C,'select public.accept_team_invitation($1)',[id])).rejects.toMatchObject({code:'42501'});
  await env.db.query('update auth.users set email_confirmed_at=now() where id=$1',[C]);
  await env.db.query("update team_access.invitations set expires_at=now()-interval '1 minute' where id=$1",[id]);
  await expect(query(C,'select public.accept_team_invitation($1)',[id])).rejects.toMatchObject({code:'42501'});
  const fresh=(await manage(A,'invite','c@example.test')).rows[0].result.id;
  await manage(A,'cancel',null,null,fresh);
  await expect(query(C,'select public.accept_team_invitation($1)',[fresh])).rejects.toMatchObject({code:'42501'});
 });
 it('revokes reads/writes and prevents replay of an accepted invite, without deleting data',async()=>{
  await manage(A,'remove',null,B);
  expect((await query(B,'select * from public.team_snapshots where team_id=$1',[team])).rows).toEqual([]);
  await expect(query(B,'select public.save_team_snapshot($1,2,$2,$3)',[team,payload,crypto.randomUUID()])).rejects.toMatchObject({code:'42501'});
  await expect(query(B,'select public.accept_team_invitation($1)',[invite])).rejects.toMatchObject({code:'42501'});
  expect((await query(A,'select revision from public.team_snapshots where team_id=$1',[team])).rows[0].revision).toBe(2);
  await expect(manage(A,'remove',null,A)).rejects.toMatchObject({code:'22023'});
  await expect(env.db.query('delete from auth.users where id=$1',[A])).rejects.toMatchObject({code:'23001'});
 });
});
