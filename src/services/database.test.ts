import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

const db = new PGlite();
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
let team: string;
const snapshot = {
  roster: [],
  settings: {},
  games: [],
  currentGame: null,
  defaultBattingOrder: null,
};
const request = () => crypto.randomUUID();
async function asUser(id: string) {
  await db.exec(
    `reset role; set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false);`,
  );
}
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth,public to anon,authenticated;
    insert into auth.users values('${alice}'),('${bob}');
    alter default privileges in schema public grant all on tables to anon,authenticated;
    alter default privileges in schema public grant execute on functions to anon,authenticated;`);
  for (const file of readdirSync('supabase/migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(`supabase/migrations/${file}`, 'utf8').replace(
      'create extension if not exists pgcrypto;',
      '',
    );
    await db.exec(sql);
  }
  await asUser(alice);
  team = (
    await db.query<{ id: string }>(
      'select public.get_or_create_personal_team() as id',
    )
  ).rows[0].id;
}, 30000);
afterAll(() => db.close());
describe('database authorization and atomic snapshots', () => {
  it('provisions one personal team and owner membership', async () => {
    const result = await db.query<{ id: string }>(
      'select public.get_or_create_personal_team() as id',
    );
    expect(result.rows[0].id).toBe(team);
    expect(
      (await db.query('select * from public.team_members')).rows,
    ).toHaveLength(1);
  });
  it('saves the entire dataset once, supports idempotent retries and rejects stale writes', async () => {
    const id = request();
    const save = (rev: number | null, rid: string) =>
      db.query<{ revision: number }>(
        'select public.save_team_snapshot($1,$2,$3,$4) as revision',
        [team, rev, JSON.stringify(snapshot), rid],
      );
    expect((await save(null, id)).rows[0].revision).toBe(1);
    expect((await save(null, id)).rows[0].revision).toBe(1);
    await expect(save(null, request())).rejects.toMatchObject({
      code: '40001',
    });
    expect((await save(1, request())).rows[0].revision).toBe(2);
    await expect(save(1, request())).rejects.toMatchObject({ code: '40001' });
  });
  it('denies direct writes including obsolete clients', async () => {
    await expect(
      db.query(
        'update public.team_snapshots set revision=99 where team_id=$1',
        [team],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      db.query(
        "insert into public.team_data(team_id,key,value) values($1,'games','[]')",
        [team],
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('isolates another user for reads and RPC writes', async () => {
    await asUser(bob);
    expect(
      (await db.query('select * from public.team_snapshots')).rows,
    ).toHaveLength(0);
    await expect(
      db.query('select public.save_team_snapshot($1,2,$2,$3)', [
        team,
        JSON.stringify(snapshot),
        request(),
      ]),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('does not expose provisioning or write RPCs to anonymous callers', async () => {
    await db.exec('reset role; set role anon;');
    await expect(
      db.query('select public.get_or_create_personal_team()'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      db.query('select public.save_team_snapshot($1,2,$2,$3)', [
        team,
        JSON.stringify(snapshot),
        request(),
      ]),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

// Exercise the real client against the real migration SQL, with no precreated
// team/snapshot. Only the transport and Supabase's auth.uid() environment are adapted.
it('provisions a new authenticated user and retries the first snapshot without losing local state', async () => {
  const { SyncService, getDataOwner } = await import('./sync');
  const { Storage } = await import('./storage');
  const { makePlayer } = await import('../test/fixtures');
  const local = new Map<string, string>();
  Object.assign(globalThis, {localStorage: {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => {local.set(key, value);},
    removeItem: (key: string) => {local.delete(key);}
  }});
  const fresh = crypto.randomUUID();
  await db.exec('reset role');
  await db.query('insert into auth.users(id) values($1)', [fresh]);
  await asUser(fresh);
  expect((await db.query('select * from public.teams')).rows).toHaveLength(0);
  expect((await db.query('select * from public.team_snapshots')).rows).toHaveLength(0);
  let failFirstWrite = true;
  const requests: string[] = [];
  const client = {
    from(table: string) {
      let id: string;
      const q = {
        select: () => q,
        eq: (_key: string, value: string) => {id = value; return q;},
        order: async () => ({data:(await db.query('select id,name,is_personal from public.teams order by created_at')).rows,error:null}),
        maybeSingle: async () => {
          expect(table).toBe('team_snapshots');
          return {data:(await db.query('select revision,snapshot,mutation_id from public.team_snapshots where team_id=$1',[id])).rows[0] ?? null,error:null};
        }
      };
      return q;
    },
    async rpc(name: string, args?: any) {
      try {
        if(name === 'get_or_create_personal_team') return {data:(await db.query<{id:string}>('select public.get_or_create_personal_team() as id')).rows[0].id,error:null};
        expect(name).toBe('save_team_snapshot');
        requests.push(args.request_id);
        if(failFirstWrite) {failFirstWrite=false;return {data:null,error:{message:'Simulated first-write transport failure'}};}
        return {data:(await db.query<{revision:number}>('select public.save_team_snapshot($1,$2,$3,$4) as revision',[args.target_team,args.expected_revision,JSON.stringify(args.payload),args.request_id])).rows[0].revision,error:null};
      } catch(error) {return {data:null,error};}
    }
  };
  const sync = new SyncService(client as any);
  try {
    Storage.saveRoster([makePlayer('local-player','Local Player')]);
    await expect(sync.initialSync(fresh)).rejects.toMatchObject({message:'Simulated first-write transport failure'});
    const owner = getDataOwner();
    expect(owner?.userId).toBe(fresh);
    expect(Storage.getRoster()[0].name).toBe('Local Player');
    expect(sync.hasPendingChanges()).toBe(true);
    const pending = Storage._get<any>('snapshotMeta',{});
    expect(pending.revision).toBeNull();
    expect(pending.mutationId).toBe(requests[0]);
    expect((await db.query('select * from public.team_members where user_id=$1',[fresh])).rows).toHaveLength(1);
    await sync.initialSync(fresh);
    expect(requests[1]).toBe(requests[0]);
    expect(sync.hasPendingChanges()).toBe(false);
    expect(Storage._get<any>('snapshotMeta',{}).revision).toBe(1);
    sync.saveLocal({...Storage.exportDataSet(),roster:[makePlayer('next','Next Player')]});
    await sync.syncNow();
    expect(Storage._get<any>('snapshotMeta',{}).revision).toBe(2);
    await expect(db.query('select public.save_team_snapshot($1,1,$2,$3)',[owner?.teamId,JSON.stringify(Storage.exportDataSet()),request()])).rejects.toMatchObject({code:'40001'});
    await expect(db.query('insert into public.team_data(team_id,key,value) values($1,$2,$3)',[owner?.teamId,'roster','[]'])).rejects.toMatchObject({code:'42501'});
  } finally {sync.disable();}
}, 30000);
