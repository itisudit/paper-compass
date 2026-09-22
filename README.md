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

Reading state is currently in memory and is not persisted between sessions.