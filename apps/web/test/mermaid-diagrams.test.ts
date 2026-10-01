// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock('mermaid', () => ({ default: mermaid }));

import { renderMermaidSvg, validateMermaidSource } from '../src/lib/mermaid-diagrams';

beforeEach(() => {
  mermaid.initialize.mockClear();
  mermaid.render.mockReset();
  mermaid.render.mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg" />' });
});

describe('Mermaid rendering boundary', () => {
  it('accepts the requested diagram families with strict, fixed rendering settings', async () => {
    const examples = [
      'flowchart LR\nA --> B',
      'sequenceDiagram\nAlice->>Bob: Hello',
      'classDiagram\nAnimal <|-- Dog',
      'stateDiagram-v2\n[*] --> Active',
      'erDiagram\nCUSTOMER ||--o{ ORDER : places',
      'gantt\ndateFormat YYYY-MM-DD\nsection Work\nBuild : 2026-01-01, 2d',
      'mindmap\n  root((Notes))\n    Ideas',
    ];
    for (const [index, source] of examples.entries()) {
      expect(await renderMermaidSvg(source, `diagram-${index}`)).toContain('<svg');
    }
    expect(mermaid.render).toHaveBeenCalledTimes(examples.length);
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({
      securityLevel: 'strict', htmlLabels: false, startOnLoad: false,
      suppressErrorRendering: true, maxTextSize: 50_000, maxEdges: 500,
    }));
    expect(mermaid.initialize.mock.lastCall?.[0].secure).toContain('securityLevel');
  });

  it('rejects configuration overrides and oversized source before invoking Mermaid', async () => {
    const unsafe = [
      '%%{init: {"securityLevel": "loose"}}%%\nflowchart LR\nA-->B',
      '---\nconfig:\n  securityLevel: loose\n---\nflowchart LR\nA-->B',
      'flowchart LR\nA-->B\n%% {init: {"securityLevel": "loose"}} %%',
      'x'.repeat(50_001),
      '   ',
    ];
    for (const source of unsafe) {
      expect(() => validateMermaidSource(source)).toThrow();
      await expect(renderMermaidSvg(source, 'blocked')).rejects.toThrow();
    }
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it('continues rendering later diagrams after a syntax failure', async () => {
    mermaid.render.mockRejectedValueOnce(new Error('Invalid diagram'));
    await expect(renderMermaidSvg('flowchart LR\nA-->', 'bad')).rejects.toThrow('Invalid diagram');
    await expect(renderMermaidSvg('flowchart LR\nA-->B', 'good')).resolves.toContain('<svg');
  });
});
