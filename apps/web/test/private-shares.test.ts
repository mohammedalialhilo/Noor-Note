import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const uid = () => crypto.randomUUID();
const owner = uid(), editor = uid(), outsider = uid(), vault = uid(), encryptedVault = uid(), note = uid();

describe('private share database boundary', () => {
  it('stores token and password verifiers, gates anonymous access, and revokes live sessions', async () => {
    const db = new PGlite();
    const as = async <T>(role: 'anon' | 'authenticated', user: string | null, work: () => Promise<T>): Promise<T> => {
      await db.exec(`set role ${role}`);
      await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', user ?? '']);
      try { return await work(); } finally { await db.exec('reset role'); }
    };
    const rpc = async (name: string, args: unknown[]) => db.query(`select public.${name}(${args.map((_, index) => `$${index + 1}`).join(',')}) as result`, args);
    try {
      await db.exec(`
        create role anon; create role authenticated;
        create schema auth; create schema storage; create schema realtime; create schema extensions;
        create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz);
        create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
        create table storage.buckets(id text primary key,name text,public boolean);
        create table storage.objects(bucket_id text,name text primary key); alter table storage.objects enable row level security;
        create function storage.foldername(p_name text) returns text[] language sql immutable as $$select string_to_array(p_name,'/')$$;
        create table realtime.messages(extension text,topic text); alter table realtime.messages enable row level security;
        create function realtime.topic() returns text language sql stable as $$select current_setting('request.realtime.topic',true)$$;
        create function realtime.send(jsonb,text,text,boolean) returns void language sql as $$select null$$;
        -- Test-only pgcrypto stand-ins. Production uses the real reviewed extension.
        create function extensions.gen_salt(text,integer) returns text language sql as $$select 'test-salt'::text$$;
        create function extensions.crypt(text,text) returns text language sql as $$select 'test-hash:' || $1$$;
        grant usage on schema public,storage,realtime to anon,authenticated;
        grant select on storage.objects to anon,authenticated;
        grant insert,delete on storage.objects to authenticated;
        grant select,insert on realtime.messages to authenticated;
      `);
      for (const name of ['202609290001_noor_cloud_sync.sql','202609290002_noor_e2ee.sql','202609290003_noor_collaboration.sql','202609290004_noor_sharing_permissions.sql','202609300003_noor_private_shares.sql']) {
        await db.exec(readFileSync(resolve(process.cwd(), '../../supabase/migrations', name), 'utf8'));
      }
      for (const person of [owner, editor, outsider]) await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [person, `${person}@example.test`]);
      await as('authenticated', owner, async () => {
        await db.query('insert into public.noor_sync_vaults(id,owner_id,name) values($1,$2,$3)', [vault, owner, 'Shared']);
        await db.query('insert into public.noor_sync_vaults(id,owner_id,name,encryption_mode) values($1,$2,$3,$4)', [encryptedVault, owner, 'Encrypted', 'e2ee']);
        await expect(rpc('noor_create_private_share', [encryptedVault, note, 'Secret', 'private body', null, null, false])).rejects.toThrow();
      });
      await db.query('insert into public.noor_vault_members(vault_id,user_id,role) values($1,$2,$3)', [vault, editor, 'editor']);
      await as('authenticated', editor, async () => {
        await expect(rpc('noor_create_private_share', [vault, note, 'Secret', 'private body', null, null, false])).rejects.toThrow();
        expect((await db.query('select id from public.noor_private_shares')).rows).toHaveLength(0);
      });
      await as('authenticated', outsider, async () => {
        await expect(rpc('noor_create_private_share', [vault, note, 'Secret', 'private body', null, null, false])).rejects.toThrow();
        expect((await db.query('select id from public.noor_private_shares')).rows).toHaveLength(0);
        await expect(rpc('noor_revoke_private_share', [uid()])).rejects.toThrow();
      });
      const created = await as('authenticated', owner, async () => rpc('noor_create_private_share', [vault, note, 'Secret', 'private body', null, 'a sufficiently long secret', true]));
      const { id, token } = (created.rows[0] as { result: { id: string; token: string } }).result;
      expect(token).toMatch(/^[0-9a-f]{64}$/u);
      const hash = (await db.query('select encode(sha256(convert_to($1, $2)), $3) as hash', [token, 'UTF8', 'hex'])).rows[0] as { hash: string };
      expect((await db.query('select token_hash, password_hash, markdown from public.noor_private_shares where id=$1', [id])).rows[0]).toEqual({
        token_hash: hash.hash,
        password_hash: 'test-hash:a sufficiently long secret', markdown: 'private body',
      });
      let sessionToken = '';
      await as('anon', null, async () => {
        await expect(db.query('select id from public.noor_private_shares')).rejects.toThrow();
        await expect(db.query('select * from public.noor_private_share_sessions')).rejects.toThrow();
        expect((await db.query("select has_table_privilege('anon','public.noor_private_shares','INSERT') as allowed")).rows[0]).toEqual({ allowed: false });
        expect((await rpc('noor_open_private_share', ['0'.repeat(64), null, null])).rows[0]).toEqual({ result: { status: 'unavailable' } });
        expect((await rpc('noor_open_private_share', [token, null, null])).rows[0]).toEqual({ result: { status: 'password_required' } });
        expect((await rpc('noor_open_private_share', [token, 'wrong password', null])).rows[0]).toEqual({ result: { status: 'password_required' } });
        const opened = (await rpc('noor_open_private_share', [token, 'a sufficiently long secret', null])).rows[0] as { result: { status: string; markdown: string; session: string; download_allowed: boolean } };
        expect(opened.result).toMatchObject({ status: 'ok', markdown: 'private body', download_allowed: true });
        expect(opened.result.session).toMatch(/^[0-9a-f]{64}$/u);
        sessionToken = opened.result.session;
        expect((await rpc('noor_open_private_share', [token, null, opened.result.session])).rows[0]).toMatchObject({ result: { status: 'ok', markdown: 'private body' } });
      });
      await as('authenticated', owner, async () => {
        expect((await db.query('select id,title,password_required from public.noor_private_shares')).rows).toEqual([{ id, title: 'Secret', password_required: true }]);
        await expect(db.query('select password_hash from public.noor_private_shares')).rejects.toThrow();
        expect((await rpc('noor_revoke_private_share', [id])).rows[0]).toEqual({ result: true });
      });
      await as('anon', null, async () => {
        expect((await rpc('noor_open_private_share', [token, 'a sufficiently long secret', null])).rows[0]).toEqual({ result: { status: 'unavailable' } });
        expect((await rpc('noor_open_private_share', [token, null, sessionToken])).rows[0]).toEqual({ result: { status: 'unavailable' } });
      });
      const lockedShare = await as('authenticated', owner, async () => rpc('noor_create_private_share', [vault, note, 'Locked', 'protected body', null, 'a second long password', false]));
      const lockedToken = (lockedShare.rows[0] as { result: { token: string } }).result.token;
      await as('anon', null, async () => {
        for (let attempt = 0; attempt < 5; attempt += 1) await rpc('noor_open_private_share', [lockedToken, 'incorrect password', null]);
        expect((await rpc('noor_open_private_share', [lockedToken, 'a second long password', null])).rows[0]).toEqual({ result: { status: 'locked' } });
      });
      await db.query("update public.noor_private_shares set locked_until=now()-interval '1 second' where title=$1", ['Locked']);
      await as('anon', null, async () => {
        expect((await rpc('noor_open_private_share', [lockedToken, 'a second long password', null])).rows[0]).toMatchObject({ result: { status: 'ok', markdown: 'protected body', download_allowed: false } });
      });
      const expiring = await as('authenticated', owner, async () => rpc('noor_create_private_share', [vault, note, 'Expiring', 'temporary body', new Date(Date.now() + 120_000).toISOString(), null, false]));
      const expiringToken = (expiring.rows[0] as { result: { token: string } }).result.token;
      await as('anon', null, async () => {
        expect((await rpc('noor_open_private_share', [expiringToken, null, null])).rows[0]).toMatchObject({ result: { status: 'ok', markdown: 'temporary body', download_allowed: false, session: null } });
      });
      await db.query("update public.noor_private_shares set expires_at=now()-interval '1 second' where title=$1", ['Expiring']);
      await as('anon', null, async () => {
        expect((await rpc('noor_open_private_share', [expiringToken, null, null])).rows[0]).toEqual({ result: { status: 'unavailable' } });
      });
    } finally { await db.close(); }
  }, 15_000);
});
