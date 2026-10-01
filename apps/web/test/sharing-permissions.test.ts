import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

// Run the production SQL in an embedded PostgreSQL engine, with the minimum
// Supabase auth, Storage, and Realtime schemas needed to exercise RLS and RPCs.
const migrations = [
  '202609290001_noor_cloud_sync.sql',
  '202609290002_noor_e2ee.sql',
  '202609290003_noor_collaboration.sql',
  '202609290004_noor_sharing_permissions.sql',
  '202609290005_noor_comment_threads.sql',
  '202609300001_noor_activity_history.sql',
];
const uid = () => crypto.randomUUID();
const owner = uid(), admin = uid(), editor = uid(), commenter = uid(), viewer = uid(), outsider = uid();
const vault = uid(), note = uid(), collabNote = uid(), otherVault = uid(), otherNote = uid(), canvas = uid(), pdf = uid(), annotation = uid();
const checksum = 'a'.repeat(64);

describe('database enforced sharing and IDOR', () => {
  it('denies guessed IDs, limits actions by role, and transfers ownership without losing attachment paths', async () => {
    const db = new PGlite();
    const asUser = async <T>(userId: string, work: () => Promise<T>): Promise<T> => {
      await db.exec('set role authenticated');
      await db.query('select set_config($1, $2, false)', ['request.jwt.claim.sub', userId]);
      try { return await work(); }
      finally { await db.exec('reset role'); }
    };
    const rpc = async (name: string, args: unknown[]) => {
      const placeholders = args.map((_, index) => `$${index + 1}`).join(', ');
      return db.query(`select public.${name}(${placeholders}) as result`, args);
    };
    try {
      await db.exec(`
        create role anon; create role authenticated;
        create schema auth; create schema storage; create schema realtime;
        create table auth.users (id uuid primary key, email text unique, email_confirmed_at timestamptz);
        create function auth.uid() returns uuid language sql stable as $$
          select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
        create table storage.buckets (id text primary key, name text, public boolean);
        create table storage.objects (bucket_id text, name text primary key);
        alter table storage.objects enable row level security;
        create function storage.foldername(p_name text) returns text[] language sql immutable as $$
          select string_to_array(p_name, '/') $$;
        create table realtime.messages (extension text, topic text);
        alter table realtime.messages enable row level security;
        create function realtime.topic() returns text language sql stable as $$
          select current_setting('request.realtime.topic', true) $$;
        create function realtime.send(jsonb, text, text, boolean) returns void language sql as $$ select null $$;
        grant usage on schema public, storage, realtime to authenticated;
        grant select, insert, update on storage.objects to authenticated;
        grant select, insert on realtime.messages to authenticated;
      `);
      for (const file of migrations.slice(0, -2)) await db.exec(readFileSync(resolve(process.cwd(), '../../supabase/migrations', file), 'utf8'));
      for (const [id, email] of [[owner, 'owner@example.test'], [admin, 'admin@example.test'], [editor, 'editor@example.test'], [commenter, 'commenter@example.test'], [viewer, 'viewer@example.test'], [outsider, 'outsider@example.test']] as const) {
        await db.query('insert into auth.users(id,email,email_confirmed_at) values ($1,$2,now())', [id, email]);
      }
      await asUser(owner, async () => {
        await db.query('insert into public.noor_sync_vaults(id,owner_id,name) values ($1,$2,$3)', [vault, owner, 'Shared']);
        await rpc('noor_push_sync_record', [uid(), vault, 'note', note, 0, uid(), checksum,
          JSON.stringify({ kind: 'note', item: { id: note, vaultId: vault } }), uid()]);
        expect((await rpc('noor_has_vault_permission', [vault, 'edit'])).rows[0]).toEqual({ result: true });
        expect((await db.query("select exists (select 1 from public.noor_sync_vaults v where v.id::text = (storage.foldername($1))[2] and v.storage_owner_id::text = (storage.foldername($1))[1] and public.noor_has_vault_permission(v.id, 'edit')) as allowed", [`${owner}/${vault}/${uid()}/asset`])).rows[0]).toEqual({ allowed: true });
        await db.query('insert into storage.objects(bucket_id,name) values ($1,$2)', ['noor-note-attachments', `${owner}/${vault}/${uid()}/asset`]);
        for (const [email, role] of [['admin@example.test', 'admin'], ['editor@example.test', 'editor'], ['commenter@example.test', 'commenter'], ['viewer@example.test', 'viewer']] as const) {
          await rpc('noor_invite_vault_member', [vault, email, role]);
        }
      });
      const legacy = await asUser(owner, async () => db.query('insert into public.noor_shared_comments(vault_id,note_id,author_id,body) values ($1,$2,$3,$4) returning id', [vault, note, owner, 'Existing comment']));
      const legacyId = (legacy.rows[0] as { id: string }).id;
      await db.exec(readFileSync(resolve(process.cwd(), '../../supabase/migrations', migrations.at(-2)!), 'utf8'));
      expect((await db.query('select target_id from public.noor_comment_threads where id=$1', [legacyId])).rows[0]).toEqual({ target_id: note });
      expect((await db.query('select body from public.noor_comment_messages where thread_id=$1', [legacyId])).rows[0]).toEqual({ body: 'Existing comment' });
      await db.exec(readFileSync(resolve(process.cwd(), '../../supabase/migrations', migrations.at(-1)!), 'utf8'));
      const activityNote = uid();
      const activityRevision = uid();
      await asUser(owner, async () => {
        const push = async (version: number, title: string, path: string, markdown: string, deletedAt: string | null) => {
          const result = await rpc('noor_push_sync_record', [uid(), vault, 'note', activityNote, version, uid(), checksum,
            JSON.stringify({ kind: 'note', item: { id: activityNote, vaultId: vault, title, path, markdown, deletedAt } }), uid()]);
          expect((result.rows[0] as { result: { status: string } }).result.status).toBe('applied');
        };
        await push(0, 'Plan', 'Plan.md', 'first', null);
        await push(1, 'Plan', 'Plan.md', 'changed body', null);
        await push(2, 'Roadmap', 'Plan.md', 'changed body', null);
        await push(3, 'Roadmap', 'Projects/Roadmap.md', 'changed body', null);
        await push(4, 'Roadmap', 'Projects/Roadmap.md', 'changed body', new Date().toISOString());
        await push(5, 'Roadmap', 'Projects/Roadmap.md', 'changed body', null);
        await rpc('noor_record_revision_restore', [vault, activityNote, activityRevision, activityRevision]);
        await rpc('noor_record_revision_restore', [vault, activityNote, activityRevision, activityRevision]);
        const events = await db.query('select event_kind from public.noor_activity_events where note_id=$1 order by occurred_at,id', [activityNote]);
        expect(events.rows.map((row) => (row as { event_kind: string }).event_kind).sort()).toEqual([
          'note_created', 'note_moved', 'note_renamed', 'note_restored', 'revision_restored',
        ]);
        expect((await db.query('select count(*)::int as count from public.noor_activity_events where note_id=$1 and event_kind=$2', [activityNote, 'revision_restored'])).rows[0]).toEqual({ count: 1 });
        expect((await db.query('select * from public.noor_list_activity_notes($1)', [vault])).rows).toContainEqual({ note_id: activityNote, title: 'Roadmap' });
        expect((await db.query('select * from public.noor_list_activity_actors($1)', [vault])).rows).toContainEqual({ actor_id: owner, actor_email: 'owner@example.test' });
        await expect(db.query('insert into public.noor_activity_events(vault_id,actor_id,actor_email,event_kind) values($1,$2,$3,$4)', [vault, owner, 'owner@example.test', 'note_created'])).rejects.toThrow();
      });
      for (const userId of [admin, editor, commenter, viewer]) {
        await asUser(userId, async () => {
          const invites = await db.query('select id from public.noor_list_vault_invites()');
          expect(invites.rows).toHaveLength(1);
          expect((await db.query('select id from public.noor_sync_vaults where id=$1', [vault])).rows).toHaveLength(0);
          const inviteId = (invites.rows[0] as { id: string }).id;
          await rpc('noor_respond_vault_invite', [inviteId, true]);
        });
      }
      await db.query('insert into public.noor_collab_documents(note_id,vault_id,initial_update,created_by) values ($1,$2,$3,$4)', [collabNote, vault, 'AQ==', owner]);
      await asUser(outsider, async () => {
        expect((await db.query('select id from public.noor_sync_vaults where id=$1', [vault])).rows).toHaveLength(0);
        expect((await db.query('select id from public.noor_activity_events where vault_id=$1', [vault])).rows).toHaveLength(0);
        await expect(db.query('select * from public.noor_list_activity_actors($1)', [vault])).rejects.toThrow();
        await expect(rpc('noor_record_revision_restore', [vault, activityNote, uid(), uid()])).rejects.toThrow();
        expect((await db.query('select item_id from public.noor_sync_records where vault_id=$1 and item_id=$2', [vault, note])).rows).toHaveLength(0);
        expect((await db.query('select name from storage.objects where name like $1', [`${owner}/${vault}/%`])).rows).toHaveLength(0);
        expect((await rpc('noor_vault_role', [vault])).rows[0]).toEqual({ result: null });
        expect((await rpc('noor_has_vault_permission', [vault, 'edit'])).rows[0]).toEqual({ result: false });
        expect((await rpc('noor_has_scope_permission', [vault, 'note', note, 'read'])).rows[0]).toEqual({ result: false });
        await expect(rpc('noor_push_sync_record', [uid(), vault, 'note', note, 1, uid(), checksum,
          JSON.stringify({ kind: 'note', item: { id: note, vaultId: vault } }), uid()])).rejects.toThrow();
        await expect(rpc('noor_invite_vault_member', [vault, 'outsider@example.test', 'viewer'])).rejects.toThrow();
        await expect(rpc('noor_add_vault_member', [vault, 'outsider@example.test'])).rejects.toThrow();
        await expect(db.query('insert into public.noor_sync_records(vault_id,kind,item_id,version,revision_id,checksum,payload,device_id) values ($1,$2,$3,$4,$5,$6,$7,$8)', [vault, 'note', uid(), 1, uid(), checksum, JSON.stringify({ kind: 'note', item: { id: uid(), vaultId: vault } }), uid()])).rejects.toThrow();
      });
      await asUser(owner, async () => {
        await db.query('insert into public.noor_sync_vaults(id,owner_id,name) values ($1,$2,$3)', [otherVault, owner, 'Private']);
        await rpc('noor_push_sync_record', [uid(), otherVault, 'note', otherNote, 0, uid(), checksum,
          JSON.stringify({ kind: 'note', item: { id: otherNote, vaultId: otherVault } }), uid()]);
        await rpc('noor_push_sync_record', [uid(), vault, 'attachment', pdf, 0, uid(), checksum,
          JSON.stringify({ kind: 'attachment', item: { id: pdf, vaultId: vault, mime: 'application/pdf' } }), uid()]);
      });
      await asUser(viewer, async () => {
        expect((await db.query('select item_id from public.noor_sync_records where vault_id=$1', [otherVault])).rows).toHaveLength(0);
        await expect(rpc('noor_push_sync_record', [uid(), vault, 'note', note, 1, uid(), checksum,
          JSON.stringify({ kind: 'note', item: { id: note, vaultId: vault } }), uid()])).rejects.toThrow();
        await expect(db.query('insert into public.noor_shared_comments(vault_id,note_id,author_id,body) values ($1,$2,$3,$4)', [vault, note, viewer, 'No'])).rejects.toThrow();
        await expect(rpc('noor_create_comment_thread', [vault, 'note', note, null, 'No'])).rejects.toThrow();
        await expect(db.query('insert into storage.objects(bucket_id,name) values ($1,$2)', ['noor-note-attachments', `${owner}/${vault}/${uid()}/asset`])).rejects.toThrow();
        await db.query('select set_config($1,$2,false)', ['request.realtime.topic', `noor:note:${collabNote}`]);
        // A viewer may observe presence, but cannot broadcast document edits.
        await db.query('insert into realtime.messages(extension,topic) values ($1,$2)', ['presence', `noor:note:${collabNote}`]);
        await expect(db.query('insert into realtime.messages(extension,topic) values ($1,$2)', ['broadcast', `noor:note:${collabNote}`])).rejects.toThrow();
      });
      await asUser(commenter, async () => {
        const thread = await rpc('noor_create_comment_thread', [vault, 'note', note, null, 'A comment']);
        const threadId = (thread.rows[0] as { result: string }).result;
        expect(threadId).toMatch(/^[0-9a-f-]{36}$/);
        const reply = await rpc('noor_reply_comment', [threadId, 'Please ask @owner@example.test']);
        const replyId = (reply.rows[0] as { result: string }).result;
        expect((await db.query('select mentions from public.noor_comment_messages where id=$1', [replyId])).rows[0]).toEqual({ mentions: [owner] });
        await rpc('noor_edit_comment', [replyId, 'Updated @editor@example.test']);
        expect((await db.query('select mentions from public.noor_comment_messages where id=$1', [replyId])).rows[0]).toEqual({ mentions: [editor] });
        await expect(db.query('insert into public.noor_comment_messages(thread_id,vault_id,author_id,body) values ($1,$2,$3,$4)', [threadId, vault, owner, 'Spoofed'])).rejects.toThrow();
        await expect(rpc('noor_create_comment_thread', [vault, 'note', note, { kind: 'text', exact: 'abc', start: 0, end: 3, prefix: '', suffix: '' }, 'Inline'])).resolves.toBeDefined();
        await expect(rpc('noor_create_comment_thread', [vault, 'note', note, { kind: 'text', exact: '', start: 0, end: 1 }, 'Bad anchor'])).rejects.toThrow();
        await expect(rpc('noor_create_comment_thread', [vault, 'note', note, { kind: 'text', start: 0, end: 1 }, 'Missing quote'])).rejects.toThrow();
        await expect(rpc('noor_create_comment_thread', [vault, 'note', otherNote, null, 'Guessed note'])).rejects.toThrow();
        await expect(rpc('noor_create_comment_thread', [otherVault, 'note', otherNote, null, 'Private'])).rejects.toThrow();
        const pdfThread = await rpc('noor_create_comment_thread', [vault, 'pdf', pdf, { kind: 'pdf', annotationId: annotation, page: 2, quote: 'PDF quote' }, 'PDF discussion']);
        expect((pdfThread.rows[0] as { result: string }).result).toMatch(/^[0-9a-f-]{36}$/);
        await expect(rpc('noor_create_comment_thread', [vault, 'canvas', canvas, null, 'Unregistered'])).rejects.toThrow();
        await rpc('noor_set_comment_resolved', [threadId, true]);
        await expect(rpc('noor_reply_comment', [threadId, 'Too late'])).rejects.toThrow();
        await rpc('noor_set_comment_resolved', [threadId, false]);
        await rpc('noor_delete_comment', [replyId]);
        expect((await db.query('select body,deleted_at is not null as deleted from public.noor_comment_messages where id=$1', [replyId])).rows[0]).toEqual({ body: '', deleted: true });
        await expect(rpc('noor_append_collab_update', [note, uid(), 'AQ=='])).rejects.toThrow();
      });
      const ownerThread = await asUser(owner, async () => rpc('noor_create_comment_thread', [vault, 'note', note, null, 'Owner note']));
      const ownerThreadId = (ownerThread.rows[0] as { result: string }).result;
      const ownerMessage = await db.query('select id from public.noor_comment_messages where thread_id=$1', [ownerThreadId]);
      const ownerMessageId = (ownerMessage.rows[0] as { id: string }).id;
      await asUser(outsider, async () => {
        expect((await db.query('select id from public.noor_comment_threads where vault_id=$1', [vault])).rows).toHaveLength(0);
        expect((await db.query('select id from public.noor_comment_messages where thread_id=$1', [ownerThreadId])).rows).toHaveLength(0);
        await expect(rpc('noor_delete_comment', [ownerMessageId])).rejects.toThrow();
        await expect(rpc('noor_set_comment_resolved', [ownerThreadId, true])).rejects.toThrow();
        await expect(db.query('select * from public.noor_list_comment_participants($1)', [vault])).rejects.toThrow();
      });
      await asUser(viewer, async () => {
        expect((await db.query('select id from public.noor_comment_messages where thread_id=$1', [ownerThreadId])).rows).toHaveLength(1);
        await expect(rpc('noor_reply_comment', [ownerThreadId, 'Viewer reply'])).rejects.toThrow();
      });
      await asUser(commenter, async () => {
        await expect(rpc('noor_edit_comment', [ownerMessageId, 'Forged edit'])).rejects.toThrow();
        await expect(rpc('noor_delete_comment', [ownerMessageId])).rejects.toThrow();
        await expect(rpc('noor_set_comment_resolved', [ownerThreadId, true])).rejects.toThrow();
      });
      await asUser(admin, async () => {
        await rpc('noor_set_comment_resolved', [ownerThreadId, true]);
        await rpc('noor_delete_comment', [ownerMessageId]);
      });
      await asUser(editor, async () => { await rpc('noor_register_comment_canvas', [vault, canvas]); });
      await asUser(commenter, async () => {
        expect((await rpc('noor_comment_canvas_available', [vault, canvas])).rows[0]).toEqual({ result: true });
        expect((await db.query('select email from public.noor_list_comment_participants($1)', [vault])).rows).toHaveLength(5);
        const cardThread = await rpc('noor_create_comment_thread', [vault, 'canvas', canvas, { kind: 'canvas', nodeId: uid() }, 'Card discussion']);
        expect((cardThread.rows[0] as { result: string }).result).toMatch(/^[0-9a-f-]{36}$/);
        await expect(rpc('noor_register_comment_canvas', [vault, uid()])).rejects.toThrow();
      });
      await asUser(admin, async () => {
        await expect(rpc('noor_change_vault_member_role', [vault, admin, 'owner'])).rejects.toThrow();
        await expect(rpc('noor_change_vault_member_role', [vault, editor, 'admin'])).rejects.toThrow();
        await rpc('noor_change_vault_member_role', [vault, viewer, 'commenter']);
        await expect(rpc('noor_remove_vault_member', [vault, admin])).rejects.toThrow();
        const pending = await rpc('noor_invite_vault_member', [vault, 'outsider@example.test', 'viewer']);
        const pendingId = (pending.rows[0] as { result: string }).result;
        await rpc('noor_revoke_vault_invite', [vault, pendingId]);
        await expect(rpc('noor_invite_vault_member', [vault, 'editor@example.test', 'admin'])).rejects.toThrow();
      });
      await asUser(outsider, async () => {
        expect((await db.query('select id from public.noor_list_vault_invites()')).rows).toHaveLength(0);
      });
      await asUser(editor, async () => {
        const result = await rpc('noor_push_sync_record', [uid(), vault, 'note', note, 1, uid(), checksum,
          JSON.stringify({ kind: 'note', item: { id: note, vaultId: vault } }), uid()]);
        expect((result.rows[0] as { result: { status: string } }).result.status).toBe('applied');
        await db.query('insert into storage.objects(bucket_id,name) values ($1,$2)', ['noor-note-attachments', `${owner}/${vault}/${uid()}/asset`]);
        await expect(rpc('noor_push_sync_record', [uid(), otherVault, 'note', otherNote, 1, uid(), checksum,
          JSON.stringify({ kind: 'note', item: { id: otherNote, vaultId: otherVault } }), uid()])).rejects.toThrow();
      });
      await asUser(owner, async () => { await rpc('noor_request_vault_transfer', [vault, editor]); });
      await asUser(editor, async () => { await rpc('noor_respond_vault_transfer', [vault, true]); });
      const activityCounts = await db.query('select event_kind, count(*)::int as count from public.noor_activity_events where vault_id=$1 group by event_kind', [vault]);
      const counts = new Map(activityCounts.rows.map((row) => [(row as { event_kind: string }).event_kind, (row as { count: number }).count]));
      expect(counts.get('member_invited')).toBe(1);
      expect(counts.get('permission_changed')).toBe(1);
      expect(counts.get('comment_added')).toBeGreaterThanOrEqual(4);
      expect(counts.get('comment_resolved')).toBe(2);
      expect(counts.get('member_removed') ?? 0).toBe(0); // Ownership transfer is not a removal.
      const transferred = await db.query('select owner_id,storage_owner_id from public.noor_sync_vaults where id=$1', [vault]);
      expect(transferred.rows[0]).toEqual({ owner_id: editor, storage_owner_id: owner });
      await asUser(editor, async () => {
        expect((await db.query('select name from storage.objects where name like $1', [`${owner}/${vault}/%`])).rows).toHaveLength(2);
      });
      await asUser(owner, async () => {
        expect((await rpc('noor_vault_role', [vault])).rows[0]).toEqual({ result: 'admin' });
        await expect(rpc('noor_request_vault_transfer', [vault, admin])).rejects.toThrow();
      });
      await asUser(viewer, async () => {
        await rpc('noor_leave_vault', [vault]);
        expect((await db.query('select id from public.noor_sync_vaults where id=$1', [vault])).rows).toHaveLength(0);
      });
      await asUser(editor, async () => { await rpc('noor_remove_vault_member', [vault, commenter]); });
      expect((await db.query('select count(*)::int as count from public.noor_activity_events where vault_id=$1 and event_kind=$2', [vault, 'member_removed'])).rows[0]).toEqual({ count: 2 });
      await asUser(commenter, async () => {
        expect((await db.query('select id from public.noor_sync_vaults where id=$1', [vault])).rows).toHaveLength(0);
        expect((await db.query('select name from storage.objects where name like $1', [`${owner}/${vault}/%`])).rows).toHaveLength(0);
        await expect(rpc('noor_create_comment_thread', [vault, 'note', note, null, 'After removal'])).rejects.toThrow();
      });
    } finally { await db.close(); }
  }, 120_000);
});
