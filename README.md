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

Data lives only in this browser profile: there is no backend, no sync across devices, and clearing site data removes it. If saving is blocked or full, a reading continues in memory and a quiet notice appears. A single-reading save from an earlier version of Paper Compass is folded into the library automatically the first time the app loads.

## Tests

```text
npm test
```

Runs `tests/persistence.test.mjs` with Node 20 or later. No dependencies. Covers both the per-reading codec/autosave engine (`js/persistence.js`) and the saved-library operations and Step 12 migration (`js/library.js`).
