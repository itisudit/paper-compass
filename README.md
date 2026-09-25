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

## Saving and recovery

The active reading is saved to the browser's localStorage as you work (typing, hints, stage moves, annotations, evidence, and PDF position). Saving is centralised in `js/persistence.js`; nothing else touches localStorage.

When you open Paper Compass with a saved reading, the opening screen offers **Resume reading** or **Start fresh**. Nothing is loaded until you choose, and the saved reading is only discarded when you confirm Start fresh.

The PDF file itself is not stored. A resumed reading keeps its notes, annotations, evidence and position, and asks you to choose the PDF again. Paper Compass checks the file against the saved name, size and content hash and tells you if it looks different.

Data lives only in this browser profile: there is no backend, no sync across devices, and clearing site data removes it. If saving is blocked or full, the reading continues in memory and a quiet notice appears.

## Tests

```text
npm test
```

Runs `tests/persistence.test.mjs` with Node 20 or later. No dependencies.