import { clipBody, clipContent, clipMetadata, clipProvenance, webClipSchema, type WebClip } from './web-clip';
import { renderTemplate, templateBody } from './template-engine';

export interface WebClipTemplateOptions {
  title: string;
  path: string;
  tags?: string[];
  properties?: Record<string, string>;
  screenshotLink?: string;
}

/** Render a user-authored vault template through the bounded expression interpreter. */
export function renderWebClipTemplate(template: string, input: WebClip, options: WebClipTemplateOptions): string {
  const clip = webClipSchema.parse(input);
  const content = clipContent(clip, options.screenshotLink);
  const highlights = clip.highlights.length
    ? clipContent({ ...clip, mode: 'highlights' })
    : '';
  const filename = options.path.split('/').at(-1) ?? '';
  const selection = clip.mode === 'selection' || clip.mode === 'highlight' ? clip.markdown.trim() : '';
  const rendered = renderTemplate(template, {
    title: options.title,
    filename,
    folder: options.path.slice(0, -filename.length - 1) || '/',
    selection,
    now: new Date(clip.capturedAt),
    properties: clipMetadata(clip, options.tags ?? [], options.properties ?? {}),
    clipVariables: {
      url: clip.url,
      author: clip.author ?? '',
      content,
      highlights,
      published: clip.publishedAt ?? '',
      domain: new URL(clip.url).hostname,
      description: clip.description ?? '',
    },
  });
  const renderedBody = templateBody(rendered);
  const contentIncluded = (Boolean(content) && renderedBody.includes(content))
    || (Boolean(selection) && renderedBody.includes(selection))
    || (Boolean(highlights) && renderedBody.includes(highlights));
  const tail = contentIncluded
    ? renderedBody.includes(clip.url) ? '' : clipProvenance(clip)
    : clipBody(clip, options.screenshotLink);
  return tail ? `${rendered.trimEnd()}\n\n${tail.trim()}\n` : `${rendered.trimEnd()}\n`;
}
