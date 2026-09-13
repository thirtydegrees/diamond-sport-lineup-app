import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

// Real PostgreSQL policies/functions. Only Supabase Auth's session boundary is simulated.
export async function teamTestDatabase(users) {
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to anon,authenticated;
 alter default privileges in schema public grant all on tables to anon,authenticated;
 alter default privileges in schema public grant execute on functions to anon,authenticated;`);
 for(const u of users) await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)',[u.id,u.email,u.verified===false ? null : new Date().toISOString()]);
 for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) await db.exec(readFileSync('supabase/migrations/'+f,'utf8').replace('create extension if not exists pgcrypto;',''));
 const as=async(user,sql,args=[])=>db.transaction(async tx=>{
  await tx.exec(user ? 'set local role authenticated' : 'set local role anon');
  await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user||'']);
  return tx.query(sql,args);
 });
 return {db,as};
}
