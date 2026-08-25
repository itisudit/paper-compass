# Paper Compass

A structured seven-step workspace for critically reading primary research papers — built for the paper that matters enough to interrogate before it changes your thinking, not for casual literature summarizing.

**Live app:** https://itisudit.github.io/paper-compass/

## What it does

Most research tools optimize for finding, summarizing, and storing papers. Paper Compass is for the next step: a slow, structured, single-paper deep read.

- **Explore** — broad-reading launchpad linking out to Google Scholar, Elicit, Zotero, and Gemini Notebook for finding and screening papers.
- **Deep dive** — a seven-step guided reading practice across three phases:
  1. Aerial view — overview, core question, knowledge gap
  2. Interrogation — methods & power, and a *blind verdict* written and locked before reading the Discussion
  3. Verdict — reconciling your conclusion with the authors', naming confounders and limits
- **Research audit trail** — a per-paper evidence log, a claim → evidence matrix, a confidence profile across ten dimensions, a "what would change my mind" note, a red-team section, a compact "paper passport" summary, and revision history snapshots.
- **DOI lookup** — paste a DOI/link or upload a PDF and Paper Compass fills in title and citation via Crossref metadata.
- **Export** — back up any paper as JSON, or export a finished review as plain text.

## Cloud sync

Papers are stored in a [Supabase](https://supabase.com) Postgres database with row-level security, behind passwordless email sign-in. Sign in with the same email on any device to see the same library.

## Stack

Single-file HTML/CSS/JS, no build step. Hosted on GitHub Pages. Database and auth via Supabase JS (loaded from CDN). Metadata lookup via the Crossref API.

## Practice, not automation

Paper Compass deliberately keeps the AI out of the interpretation step. The blind-verdict lock exists so you write your own conclusion from the evidence before reading what the authors claim — the point is to preserve independent scientific judgement, not replace it.
