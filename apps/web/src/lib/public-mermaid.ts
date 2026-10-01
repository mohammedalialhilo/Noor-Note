import { renderMermaidSvg } from './mermaid-diagrams';

try {
  const stored = localStorage.getItem('noor-public-theme');
  if (stored === 'light' || stored === 'dark') document.documentElement.dataset.theme = stored;
} catch { /* Private browsing can disable storage. */ }

document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('noor-public-theme', next); } catch { /* Theme remains active for this page. */ }
});

async function renderDiagrams(): Promise<void> {
  const diagrams = [...document.querySelectorAll<HTMLElement>('[data-diagram]')];
  if (!diagrams.length) return;
  for (const item of diagrams) {
    const source = item.textContent ?? '';
    try {
      const svg = await renderMermaidSvg(source, `noor-public-${crypto.randomUUID().replaceAll('-', '')}`);
      const objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      const image = document.createElement('img');
      image.alt = 'Mermaid diagram';
      image.src = objectUrl;
      image.onload = () => URL.revokeObjectURL(objectUrl);
      image.onerror = () => URL.revokeObjectURL(objectUrl);
      item.replaceWith(image);
    } catch (error) { item.textContent = `${error instanceof Error ? error.message : 'Could not render this Mermaid diagram.'}\n${source}`; }
  }
}
void renderDiagrams();
