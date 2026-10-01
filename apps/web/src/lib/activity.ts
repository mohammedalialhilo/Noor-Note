import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

export const activityKindSchema = z.enum([
  'note_created', 'note_renamed', 'note_moved', 'note_restored',
  'member_invited', 'member_removed', 'permission_changed',
  'comment_added', 'comment_resolved', 'revision_restored',
]);
export type ActivityKind = z.infer<typeof activityKindSchema>;
export const activityEventSchema = z.object({
  id: z.uuid(), vault_id: z.uuid(), actor_id: z.uuid().nullable(), actor_email: z.email(),
  event_kind: activityKindSchema, note_id: z.uuid().nullable(), target_user_id: z.uuid().nullable(),
  details: z.record(z.string(), z.unknown()), occurred_at: z.iso.datetime({ offset: true }),
}).strict();
export type ActivityEvent = z.infer<typeof activityEventSchema>;
export interface ActivityFilters { actorId: string; kind: ActivityKind | ''; from: string; to: string; noteId: string }
export const emptyActivityFilters: ActivityFilters = { actorId: '', kind: '', from: '', to: '', noteId: '' };
const actorSchema = z.object({ actor_id: z.uuid(), actor_email: z.email() });
const noteOptionSchema = z.object({ note_id: z.uuid(), title: z.string() });
export type ActivityActor = z.infer<typeof actorSchema>;
export type ActivityNote = z.infer<typeof noteOptionSchema>;
export const activityPageSize = 50;

function localDayBoundary(value: string, nextDay: boolean): string {
  const date = z.iso.date().parse(value);
  const [year, month, day] = date.split('-').map(Number);
  const boundary = new Date(year, month - 1, day + (nextDay ? 1 : 0));
  if (Number.isNaN(boundary.getTime())) throw new Error('Invalid activity date');
  return boundary.toISOString();
}

export async function loadActivityPage(client: SupabaseClient, vaultId: string, filters: ActivityFilters, page: number): Promise<ActivityEvent[]> {
  let query = client.from('noor_activity_events')
    .select('id,vault_id,actor_id,actor_email,event_kind,note_id,target_user_id,details,occurred_at')
    .eq('vault_id', z.uuid().parse(vaultId));
  if (filters.actorId) query = query.eq('actor_id', z.uuid().parse(filters.actorId));
  if (filters.kind) query = query.eq('event_kind', activityKindSchema.parse(filters.kind));
  if (filters.noteId) query = query.eq('note_id', z.uuid().parse(filters.noteId));
  if (filters.from) query = query.gte('occurred_at', localDayBoundary(filters.from, false));
  if (filters.to) query = query.lt('occurred_at', localDayBoundary(filters.to, true));
  const result = await query.order('occurred_at', { ascending: false }).order('id', { ascending: false })
    .range(page * activityPageSize, (page + 1) * activityPageSize - 1);
  if (result.error) throw result.error;
  return z.array(activityEventSchema).parse(result.data);
}

export async function loadActivityOptions(client: SupabaseClient, vaultId: string): Promise<{ actors: ActivityActor[]; notes: ActivityNote[] }> {
  const id = z.uuid().parse(vaultId);
  const [actors, notes] = await Promise.all([
    client.rpc('noor_list_activity_actors', { p_vault: id }),
    client.rpc('noor_list_activity_notes', { p_vault: id }),
  ]);
  if (actors.error) throw actors.error;
  if (notes.error) throw notes.error;
  return { actors: z.array(actorSchema).parse(actors.data), notes: z.array(noteOptionSchema).parse(notes.data) };
}

function field(event: ActivityEvent, name: string): string | null {
  const value = event.details[name];
  return typeof value === 'string' && value.trim() ? value : null;
}
export function describeActivity(event: ActivityEvent, noteTitle?: string): string {
  const title = field(event, 'title') ?? noteTitle ?? 'a note';
  const email = field(event, 'email') ?? 'a member';
  const role = field(event, 'role') ?? 'member';
  switch (event.event_kind) {
    case 'note_created': return `Created ${title}`;
    case 'note_renamed': return `Renamed ${field(event, 'previousTitle') ?? 'a note'} to ${title}`;
    case 'note_moved': return `Moved ${title} to ${field(event, 'path') ?? 'another folder'}`;
    case 'note_restored': return `Restored ${title} from Trash`;
    case 'member_invited': return `Invited ${email} as ${role}`;
    case 'member_removed': return `Removed ${email} from the vault`;
    case 'permission_changed': return `Changed ${email} from ${field(event, 'previousRole') ?? 'a role'} to ${role}`;
    case 'comment_added': return event.note_id ? `Commented on ${title}` : `Commented on a ${field(event, 'targetKind') ?? 'shared item'}`;
    case 'comment_resolved': return event.note_id ? `Resolved a comment on ${title}` : `Resolved a ${field(event, 'targetKind') ?? 'shared item'} comment`;
    case 'revision_restored': return `Restored a revision of ${title}`;
  }
}
