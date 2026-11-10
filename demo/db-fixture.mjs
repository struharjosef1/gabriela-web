import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readdir,readFile} from 'node:fs/promises';

export async function createDatabase() {
  const db=new PGlite({extensions:{pgcrypto}});
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema storage;
    create table auth.users(id uuid primary key,email text not null,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)
    $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
    grant usage on schema auth,storage to authenticated,anon,service_role;
    grant select,insert on storage.objects to authenticated;
  `);
  const path=new URL('../supabase/migrations/',import.meta.url);
  for(const name of (await readdir(path)).filter(x=>x.endsWith('.sql')).sort()){
    try { await db.exec(await readFile(new URL(name,path),'utf8')); }
    catch(e){console.error(name,e.message,e.code,e.position,e.internalQuery);throw e;}
  }
  return db;
}

export const actors=Object.fromEntries(['owner','manager','resident','tech','outsider','owner2'].map((key,i)=>
  [key,'10000000-0000-4000-8000-'+String(i+1).padStart(12,'0')]));
export function asActor(db,actor,fn,aal='aal2'){
  return db.transaction(async tx=>{
    await tx.exec('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:actors[actor],aal})]);
    return fn(tx);
  });
}
