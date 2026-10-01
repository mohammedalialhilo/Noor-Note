# Study cards

Open **Study** from the activity bar, sidebar, mobile navigation, or command palette. Cards are optional and stored locally with the vault. A card references its source note by stable ID. The original Markdown remains editable and is never rewritten by a review.

## Creating cards

Choose **Import from note** to preview and select cards. The parser recognizes:

```markdown
Front:: Term
Back:: Definition

Q:: What is Noor Note?
A:: A local-first note workspace.

> [!flashcard] What stores local notes?
> IndexedDB.

The {{c1::mitochondrion::organelle}} produces {{c2::ATP}}.
```

`Front:`/`Back:` and `Q:`/`A:` also work. Code fences and YAML frontmatter are skipped. Each cloze number creates one card; an optional third `::hint` appears in the prompt. **Include headings and their sections** is an explicit import option because ordinary headings are not always good questions. A preview lets you deselect candidates. Importing the same unchanged card twice does not create duplicates.

Select text in the note editor and choose **Create study card** from Note actions to start a card with that text. You can also create a card directly in Study. Noor Note's **Generate flashcards** AI action asks for `Q::`/`A::` Markdown. After reviewing the suggestion, choose **Add as study cards** to save its parsed cards directly, or accept the Markdown into the note and import it later. Direct AI cards can be undone from the AI action. AI is optional and never needed for study.

Cards keep a copy of their prompt and answer, source note ID, optional source line, due time, interval, ease, last review, and complete local review history. If source Markdown changes, the existing card does not update automatically; preview the revised note and manage cards in the library. Deleted source notes leave cards with an unavailable source label until restored.

## Scheduling

The scheduler is a bounded, deterministic SM-2-inspired rule. It uses UTC elapsed time; `intervalDays` may be fractional for short follow-ups. New cards are due immediately and start at ease `2.5`. Ratings change the schedule as follows:

| Rating | First review | Later interval | Ease change | Repetitions |
| --- | --- | --- | --- | --- |
| Again | 10 minutes | 10 minutes | −0.20 | Reset to 0 |
| Hard | 12 hours | max(12 hours, previous interval × 1.2) | −0.15 | +1 |
| Good | 1 day | 3 days on the second successful review; then previous interval × new ease | 0 | +1 |
| Easy | 4 days | max(4 days, previous interval × new ease × 1.3) | +0.15 | +1 |

Ease stays between `1.3` and `3.0`; intervals are capped at 100 years. Each review records its rating, old/new interval, and old/new ease. Stats show due cards, total cards, cards without a review, and reviews in the last 30 days. No streak or pressure score is calculated.

Full-vault ZIP export includes cards and histories and remaps source note IDs on import. Folder ZIP export includes cards whose source notes are in that folder. Study cards are not included in cloud structured-object sync yet, so use a vault ZIP when moving them between browsers or devices.
