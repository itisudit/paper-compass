# Paper Compass

Paper Compass is a calm, focused space for engaging thoughtfully with scientific papers.

## Run locally

Serve the project over HTTP, for example:

```text
python -m http.server 8000
```

Then open `http://localhost:8000`.

The project uses a pinned PDF.js build loaded from a CDN.

## Current slice

The app supports paper entry, reading triage, PDF reading, and a focused reading journey across Surf, Swim, Dive Deep, and Shore.

The reading workspace guides the reader through the stages appropriate to their chosen depth, with in-session thinking, optional hints, PDF inspection, revision, and a final independent judgement.

## Library and saving

Paper Compass opens on a **Library** of the papers you have started — each a compact card with its title, depth, current stage or status, and when you last opened it, sorted with the most recently opened first. **New paper** always starts an independent reading; it never overwrites another saved paper. **Continue** reopens a paper with its stage, thinking, revisions, annotations and evidence all restored. **Leave reading** saves and returns to the Library rather than closing the app; the paper is not deleted, just no longer the active one. Deleting a paper from its card asks for confirmation first and removes only that one.

Each reading autosaves to the browser's localStorage as you work (typing, hints, stage moves, annotations, evidence, and PDF position). `js/persistence.js` owns the storage codec, validation and the autosave engine for one reading; `js/library.js` owns the saved collection built from it — nothing else touches localStorage.

The PDF file itself is not stored. Reopening a paper keeps its notes, annotations, evidence and position, and asks you to choose the PDF again. Paper Compass checks the file against the saved name, size and content hash and tells you if it looks different.

You can also **Relate** one paper to another from its Library card: choose the other paper, one relationship type (Supports, Challenges, Extends, Contrasts, or Related), and optionally say why. The relationship shows on both papers, read from each side (Paper B challenges Paper A appears as "Challenged by Paper B" on Paper A). A paper cannot be related to itself, the same two papers cannot carry the same type twice, and deleting a paper removes every relationship that involved it. Relationships belong to the library, not to any one reading, and are recorded only because you recorded them; Paper Compass suggests none.

Data lives only in this browser profile: there is no backend, no sync across devices, and clearing site data removes it. If saving is blocked or full, a reading continues in memory and a quiet notice appears. A single-reading save from an earlier version of Paper Compass is folded into the library automatically the first time the app loads.

## Compare papers

From the Library, **Compare papers** starts a cross-paper synthesis: a question, at least two of your library papers, and one step at a time through what each paper contributes (with evidence you already saved from it), a side-by-side read of those contributions, your own notes on convergence, tension and gaps, and a current judgement with what would change it. Nothing here is written for you or inferred automatically; every field is left empty until you fill it, and an empty field is a fine answer. Comparisons show in their own "Comparisons" section of the Library, never mixed in with papers. Deleting a paper removes it from any comparison that used it; a comparison left with fewer than two papers is removed rather than kept broken.

## Tests

```text
npm test
```

Runs `tests/persistence.test.mjs` with Node 20 or later. No dependencies. Covers both the per-reading codec/autosave engine (`js/persistence.js`) and the saved-library operations and Step 12 migration (`js/library.js`).
