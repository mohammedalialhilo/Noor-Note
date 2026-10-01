// @vitest-environment jsdom
import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';

describe('Mermaid syntax support', () => {
  it.each([
    ['flowchart', 'flowchart LR\nA --> B'],
    ['sequence', 'sequenceDiagram\nAlice->>Bob: Hello'],
    ['class', 'classDiagram\nAnimal <|-- Dog'],
    ['state', 'stateDiagram-v2\n[*] --> Active'],
    ['ER', 'erDiagram\nCUSTOMER ||--o{ ORDER : places'],
    ['Gantt', 'gantt\ndateFormat YYYY-MM-DD\nsection Work\nBuild : 2026-01-01, 2d'],
    ['mind map', 'mindmap\n  root((Notes))\n    Ideas'],
  ])('parses a %s diagram', async (_kind, source) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false });
    await expect(mermaid.parse(source)).resolves.toBeTruthy();
  });
});
