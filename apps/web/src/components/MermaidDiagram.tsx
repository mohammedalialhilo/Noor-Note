'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import styles from './MarkdownReadingView.module.css';

interface RenderState {
  source: string;
  url: string | null;
  error: string | null;
}

export function MermaidDiagram({ source }: { source: string }) {
  const [state, setState] = useState<RenderState | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    void import('../lib/mermaid-diagrams').then(({ renderMermaidSvg }) =>
      renderMermaidSvg(source, `noor-mermaid-${crypto.randomUUID().replaceAll('-', '')}`),
    ).then((svg) => {
      objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      if (active) setState({ source, url: objectUrl, error: null });
      else URL.revokeObjectURL(objectUrl);
    }).catch((error: unknown) => {
      if (active) setState({ source, url: null, error: error instanceof Error ? error.message : 'Could not render this Mermaid diagram.' });
    });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [source]);

  const current = state?.source === source ? state : null;
  return <figure className={styles.diagramFigure}>
    {current?.url ? <Image src={current.url} alt="Mermaid diagram" width={900} height={500} unoptimized className={styles.diagram} />
      : current?.error ? <p role="alert" className={styles.diagramError}>{current.error}</p>
        : <p role="status">Rendering Mermaid diagram…</p>}
    <details><summary>Diagram source</summary><pre><code>{source}</code></pre></details>
  </figure>;
}
