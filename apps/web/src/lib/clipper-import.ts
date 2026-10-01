import { clipBody, clipFrontmatter, clipMetadata, inspectMetadata, renderWebClipTemplate, updateFrontmatterProperty, webClipSchema, type WebClip, type VaultNote } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';
import { z } from 'zod';

export interface ClipDestination {
  vaultId: string; folderId: string | null; noteId: string | null; title: string;
  tags: string[]; properties: Record<string, string>; templateMarkdown: string | null;
}
function screenshotBlob(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/u);
  if (!match) throw new Error('Invalid screenshot data');
  const binary = atob(match[2]!);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: match[1]! });
}
function imageLink(notePath: string, attachmentPath: string, name: string): string {
  const from = notePath.split('/').slice(1, -1), to = attachmentPath.split('/').slice(1);
  while (from.length && to.length && from[0]!.toLocaleLowerCase() === to[0]!.toLocaleLowerCase()) { from.shift(); to.shift(); }
  const path = [...from.map(() => '..'), ...to].map((part) => encodeURIComponent(part)).join('/');
  return `![${name.replaceAll('[', '\\[').replaceAll(']', '\\]')}](${path})`;
}
function metadataOnNew(markdown: string, clip: WebClip, tags: string[], properties: Record<string, string>): string {
  for (const [key, value] of Object.entries(clipMetadata(clip, tags, properties))) markdown = updateFrontmatterProperty(markdown, key, value);
  return markdown;
}
export async function saveWebClip(repository: VaultRepository, input: unknown, destination: ClipDestination): Promise<VaultNote> {
  const clip = webClipSchema.parse(input);
  if (clip.mode === 'screenshot' && !clip.screenshotDataUrl) throw new Error('The screenshot bytes are missing. Capture the visible page again.');
  if (clip.mode === 'image' && !clip.imageUrl) throw new Error('The selected image is unavailable.');
  const vaultId = z.uuid().parse(destination.vaultId);
  const tree = await repository.listTree(vaultId);
  if (destination.folderId && !tree.folders.some((folder) => folder.id === destination.folderId)) throw new Error('Choose an available folder.');
  const target = destination.noteId ? await repository.getNote(z.uuid().parse(destination.noteId)) : null;
  if (destination.noteId && (!target || target.vaultId !== vaultId || target.deletedAt)) throw new Error('Choose an available note in this vault.');
  if (target?.collaborative) throw new Error('Open this collaborative note and paste the clip through its live editor.');
  const title = destination.title.trim().slice(0, 200) || clip.title;
  const metadata = clipMetadata(clip, destination.tags, destination.properties);
  if (destination.templateMarkdown && destination.templateMarkdown.length > 200_000) throw new Error('Template is too long.');
  const image = clip.screenshotDataUrl ? screenshotBlob(clip.screenshotDataUrl) : null;
  const ext = image?.type === 'image/png' ? 'png' : image?.type === 'image/webp' ? 'webp' : 'jpg';
  const filename = `Screenshot ${clip.capturedAt.slice(0, 19).replaceAll(':', '-')}.${ext}`;
  const attachment = image ? await repository.addAttachment(vaultId, target?.folderId ?? destination.folderId, image, filename) : null;
  try {
    if (target) {
      const body = clipBody(clip, attachment ? imageLink(target.path, attachment.path, attachment.name) : undefined);
      const content = destination.templateMarkdown ? renderWebClipTemplate(destination.templateMarkdown, clip, { title, path: target.path, tags: destination.tags, properties: destination.properties, screenshotLink: attachment ? imageLink(target.path, attachment.path, attachment.name) : undefined }).replace(/^(?:\uFEFF)?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/u, '').trim() : body;
      let markdown = `${target.markdown.trimEnd()}\n\n${content.trim()}\n`;
      const addedTags = Array.isArray(metadata.tags) ? metadata.tags : [];
      if (addedTags.length) {
        const existing = inspectMetadata(markdown).values.tags;
        const mergedTags = [...new Set([...(Array.isArray(existing) ? existing.filter((tag): tag is string => typeof tag === 'string') : typeof existing === 'string' ? [existing] : []), ...addedTags])];
        markdown = updateFrontmatterProperty(markdown, 'tags', mergedTags);
      }
      for (const [key, value] of Object.entries(destination.properties)) markdown = updateFrontmatterProperty(markdown, key, value);
      return await repository.saveNote(target.id, { markdown }, true);
    }
    const note = await repository.createNote(vaultId, destination.folderId, title, (path) => {
      const body = clipBody(clip, attachment ? imageLink(path, attachment.path, attachment.name) : undefined);
      return destination.templateMarkdown
        ? metadataOnNew(renderWebClipTemplate(destination.templateMarkdown, clip, { title, path, tags: destination.tags, properties: destination.properties, screenshotLink: attachment ? imageLink(path, attachment.path, attachment.name) : undefined }), clip, destination.tags, destination.properties)
        : `${clipFrontmatter(clip, destination.tags, destination.properties)}${body}\n`;
    });
    return note;
  } catch (error) {
    if (attachment) { await repository.deleteAttachment(attachment.id); await repository.permanentlyDeleteAttachment(attachment.id); }
    throw error;
  }
}
