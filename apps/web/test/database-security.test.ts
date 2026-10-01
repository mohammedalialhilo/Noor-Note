import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const id = () => crypto.randomUUID();
const migrationFiles = [
  '202609290001_noor_cloud_sync.sql',
  '202609290002_noor_e2ee.sql',
  '202609290003_noor_collaboration.sql',
  '202609290004_noor_sharing_permissions.sql',
  '202609290005_noor_comment_threads.sql',
  '202609300001_noor_activity_history.sql',
  '202609300002_noor_publishing.sql',
  '202609300003_noor_private_shares.sql',
  '202610010001_noor_database_security.sql',
];

describe('Supabase database security', () => {
  it('enforces RLS, roles, revocation, and account deletion in PostgreSQL', async () => {
    const db = new PGlite();
    const owner = id(), other = id(), editor = id(), commenter = id(), viewer = id();
    const vault = id(), otherVault = id(), encryptedVault = id(), note = id(), otherNote = id();
    const checksum = 'a'.repeat(64);
    const asUser = async <T>(user: string, work: () => Promise<T>): Promise<T> => {
      await db.exec('set role authenticated');
      await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', user]);
      try { return await work(); } finally { await db.exec('reset role'); }
    };
    const asAnon = async <T>(work: () => Promise<T>): Promise<T> => {
      await db.exec('set role anon');
      try { return await work(); } finally { await db.exec('reset role'); }
    };
    const rpc = (name: string, args: unknown[]) =>
      db.query(`select public.${name}(${args.map((_, index) => `$${index + 1}`).join(',')}) as result`, args);
    const push = (vaultId: string, noteId: string) =>
      rpc('noor_push_sync_record', [id(), vaultId, 'note', noteId, 0, id(), checksum,
        JSON.stringify({ kind: 'note', item: { id: noteId, vaultId } }), id()]);
    try {
      await db.exec(`
        create role anon; create role authenticated;
        create schema auth; create schema storage; create schema realtime; create schema extensions;
        create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz);
        create function auth.uid() returns uuid language sql stable as
          $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
        create table storage.buckets(id text primary key,name text,public boolean);
        create table storage.objects(bucket_id text,name text primary key);
        alter table storage.objects enable row level security;
        create function storage.foldername(p_name text) returns text[] language sql immutable as
          $$select string_to_array(p_name,'/')$$;
        create table realtime.messages(extension text,topic text);
        alter table realtime.messages enable row level security;
        create function realtime.topic() returns text language sql stable as
          $$select current_setting('request.realtime.topic',true)$$;
        create function realtime.send(jsonb,text,text,boolean) returns void language sql as $$select null$$;
        -- Production uses pgcrypto. These stand-ins cover SQL authorization only.
        create function extensions.gen_salt(text,integer) returns text language sql as $$select 'test-salt'::text$$;
        create function extensions.crypt(text,text) returns text language sql as $$select 'test-hash:' || $1$$;
        grant usage on schema public,storage,realtime to anon,authenticated;
        grant select on storage.objects to anon,authenticated;
        grant insert,update,delete on storage.objects to authenticated;
        grant select,insert on realtime.messages to authenticated;
      `);
      for (const file of migrationFiles) {
        await db.exec(readFileSync(resolve(process.cwd(), '../../supabase/migrations', file), 'utf8'));
      }

      const inventory = await db.query<{ name: string; rls: boolean; policies: number }>(`
        select c.relname as name, c.relrowsecurity as rls, count(p.policyname)::int as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        left join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
        where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'noor_%'
        group by c.relname,c.relrowsecurity order by c.relname
      `);
      expect(inventory.rows.length).toBeGreaterThan(15);
      expect(inventory.rows.filter((row) => !row.rls)).toEqual([]);
      const noPolicies = inventory.rows.filter((row) => row.policies === 0).map((row) => row.name);
      expect(noPolicies.sort()).toEqual([
        'noor_comment_canvas_targets', 'noor_private_share_sessions', 'noor_shared_comments',
        'noor_sync_operations', 'noor_vault_invites', 'noor_vault_transfers',
      ].sort());
      for (const table of noPolicies) {
        for (const role of ['anon', 'authenticated']) {
          const privilege = await db.query<{ readable: boolean; writable: boolean }>(
            'select has_table_privilege($1,$2,$3) as readable, has_table_privilege($1,$2,$4) as writable',
            [role, `public.${table}`, 'SELECT', 'INSERT,UPDATE,DELETE'],
          );
          expect(privilege.rows[0]).toEqual({ readable: false, writable: false });
        }
      }
      const anonymousDefiners = await db.query<{ name: string }>(`
        select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'noor_%' and p.prosecdef
          and has_function_privilege('anon', p.oid, 'EXECUTE')
        order by p.proname
      `);
      expect(anonymousDefiners.rows.map((row) => row.name)).toEqual(['noor_open_private_share']);

      for (const [person, email] of [[owner, 'owner'], [other, 'other'], [editor, 'editor'],
        [commenter, 'commenter'], [viewer, 'viewer']] as const) {
        await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
          [person, `${email}@example.test`]);
      }
      await asUser(owner, async () => {
        await db.query('insert into public.noor_sync_vaults(id,owner_id,name) values($1,$2,$3)',
          [vault, owner, 'Owner vault']);
        await db.query('insert into public.noor_sync_vaults(id,owner_id,name,encryption_mode) values($1,$2,$3,$4)',
          [encryptedVault, owner, 'Encrypted vault', 'e2ee']);
        await push(vault, note);
        await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',
          ['noor-note-attachments', `${owner}/${vault}/${id()}/asset`]);
        const invite = await rpc('noor_invite_vault_member', [vault, 'editor@example.test', 'editor']);
        await expect(rpc('noor_add_vault_member', [vault, 'viewer@example.test'])).rejects.toThrow();
        await asUser(editor, async () => {
          await rpc('noor_respond_vault_invite', [(invite.rows[0] as { result: string }).result, true]);
        });
      });
      await asUser(other, async () => {
        await db.query('insert into public.noor_sync_vaults(id,owner_id,name) values($1,$2,$3)',
          [otherVault, other, 'Other vault']);
        await push(otherVault, otherNote);
        expect((await db.query('select id from public.noor_sync_vaults')).rows).toHaveLength(1);
        await expect(push(vault, id())).rejects.toThrow();
      });
      await db.query('insert into public.noor_vault_members(vault_id,user_id,role) values($1,$2,$3),($1,$4,$5)',
        [vault, commenter, 'commenter', viewer, 'viewer']);
      await asUser(viewer, async () => {
        expect((await db.query('select id from public.noor_sync_vaults')).rows).toHaveLength(1);
        expect((await db.query('select item_id from public.noor_sync_records')).rows).toHaveLength(1);
        await expect(push(vault, id())).rejects.toThrow();
        await expect(rpc('noor_create_comment_thread', [vault, 'note', note, null, 'No'])).rejects.toThrow();
        await expect(rpc('noor_change_vault_member_role', [vault, editor, 'viewer'])).rejects.toThrow();
      });
      await asUser(commenter, async () => {
        await expect(push(vault, id())).rejects.toThrow();
        await expect(rpc('noor_remove_vault_member', [vault, editor])).rejects.toThrow();
        await rpc('noor_create_comment_thread', [vault, 'note', note, null, 'Comment']);
      });
      await asUser(editor, async () => {
        await push(vault, id());
        await expect(rpc('noor_change_vault_member_role', [vault, commenter, 'editor'])).rejects.toThrow();
        await expect(rpc('noor_remove_vault_member', [vault, commenter])).rejects.toThrow();
        await expect(rpc('noor_invite_vault_member', [vault, 'other@example.test', 'viewer'])).rejects.toThrow();
        expect((await db.query('select id from public.noor_sync_vaults')).rows).toHaveLength(1);
        expect((await db.query('select id from public.noor_sync_vaults where id=$1', [otherVault])).rows).toHaveLength(0);
        await expect(db.query('update public.noor_sync_records set checksum=$1 where vault_id=$2', ['b'.repeat(64), vault])).rejects.toThrow();
      });

      const outsiderEnvelope = id();
      await db.query('insert into public.noor_vault_key_envelopes(vault_id,recipient_user_id,recipient_device_id,key_epoch,envelope) values($1,$2,$3,$4,$5)',
        [encryptedVault, other, outsiderEnvelope, 1, JSON.stringify({ version: '1', vaultId: encryptedVault, epoch: 1 })]);
      await asUser(other, async () => {
        expect((await db.query('select * from public.noor_vault_key_envelopes')).rows).toHaveLength(0);
      });
      await asUser(owner, async () => {
        await expect(db.query('insert into public.noor_vault_key_envelopes(vault_id,recipient_user_id,recipient_device_id,key_epoch,envelope) values($1,$2,$3,$4,$5)',
          [encryptedVault, other, id(), 1, JSON.stringify({ version: '1', vaultId: encryptedVault, epoch: 1 })])).rejects.toThrow();
        await db.query('insert into public.noor_vault_key_envelopes(vault_id,recipient_user_id,recipient_device_id,key_epoch,envelope) values($1,$2,$3,$4,$5)',
          [encryptedVault, owner, id(), 1, JSON.stringify({ version: '1', vaultId: encryptedVault, epoch: 1 })]);
        expect((await db.query('select * from public.noor_vault_key_envelopes')).rows).toHaveLength(1);
      });

      await asUser(owner, async () => { await rpc('noor_remove_vault_member', [vault, viewer]); });
      await asUser(viewer, async () => {
        expect((await db.query('select * from public.noor_sync_records')).rows).toHaveLength(0);
        expect((await db.query('select * from storage.objects where bucket_id=$1', ['noor-note-attachments'])).rows).toHaveLength(0);
        await expect(push(vault, id())).rejects.toThrow();
      });
      await db.query('delete from auth.users where id=$1', [commenter]);
      await asUser(commenter, async () => {
        expect((await db.query('select * from public.noor_sync_vaults')).rows).toHaveLength(0);
        expect((await db.query('select * from public.noor_comment_threads')).rows).toHaveLength(0);
        await expect(rpc('noor_create_comment_thread', [vault, 'note', note, null, 'Stale token'])).rejects.toThrow();
      });
      expect((await db.query('select created_by from public.noor_comment_threads where vault_id=$1', [vault])).rows[0])
        .toEqual({ created_by: null });
      await db.query('delete from auth.users where id=$1', [editor]);
      await asUser(editor, async () => {
        expect((await db.query('select * from public.noor_sync_records')).rows).toHaveLength(0);
        await expect(push(vault, id())).rejects.toThrow();
      });

      const share = await asUser(owner, () => rpc('noor_create_private_share',
        [vault, note, 'Private', 'private body', null, null, false]));
      const { id: shareId, token } = (share.rows[0] as { result: { id: string; token: string } }).result;
      await asAnon(async () => {
        expect((await rpc('noor_open_private_share', [token, null, null])).rows[0])
          .toMatchObject({ result: { status: 'ok', markdown: 'private body' } });
        await expect(db.query('select * from public.noor_private_shares')).rejects.toThrow();
      });
      await asUser(owner, async () => { await rpc('noor_revoke_private_share', [shareId]); });
      await asAnon(async () => {
        expect((await rpc('noor_open_private_share', [token, null, null])).rows[0])
          .toEqual({ result: { status: 'unavailable' } });
      });
    } finally { await db.close(); }
  }, 120_000);
});
