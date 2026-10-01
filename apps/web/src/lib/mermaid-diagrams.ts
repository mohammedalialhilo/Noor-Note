import mermaid from 'mermaid';

const MAX_DIAGRAM_LENGTH = 50_000;

// Note content is untrusted. Keep the renderer configuration under application control.
const CONFIG: Parameters<typeof mermaid.initialize>[0] = {
  startOnLoad: false,
  securityLevel: 'strict',
  htmlLabels: false,
  maxTextSize: MAX_DIAGRAM_LENGTH,
  maxEdges: 500,
  suppressErrorRendering: true,
  theme: 'neutral',
  secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'htmlLabels', 'dompurifyConfig'],
};

let renderQueue: Promise<void> = Promise.resolve();

export function validateMermaidSource(source: string): void {
  if (!source.trim()) throw new Error('The Mermaid diagram is empty.');
  if (source.length > MAX_DIAGRAM_LENGTH) throw new Error('The Mermaid diagram exceeds the 50,000 character limit.');
  if (/%%\s*\{/u.test(source) || /^\s*---\s*(?:\r?\n|$)/u.test(source)) {
    throw new Error('Mermaid configuration directives are unavailable in notes.');
  }
}

export async function renderMermaidSvg(source: string, id: string): Promise<string> {
  validateMermaidSource(source);
  const task = renderQueue.then(async () => {
    mermaid.initialize(CONFIG);
    const result = await mermaid.render(id, source);
    return result.svg;
  });
  renderQueue = task.then(() => undefined, () => undefined);
  return task;
}
