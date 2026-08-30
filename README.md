# Paper Compass Codebase

This is a functionality-preserving split of the original single-file application. Script files are loaded as classic scripts in dependency order, so existing global functions and state continue to work without a risky rewrite into ES modules.

## Structure

- `index.html` — markup and third-party library includes only
- `assets/css/base.css` — tokens, typography, global layout
- `assets/css/components.css` — reusable UI components
- `assets/css/pdf.css` — PDF viewer and annotation UI
- `assets/css/stats.css` — statistics dashboard
- `assets/css/responsive.css` — mobile/responsive rules and focused Deep Dive overrides
- `assets/js/config.js` — configuration, shared state, utility helpers
- `assets/js/core.js` — theme, labels, persistence helpers, completion history, reminders
- `assets/js/papers.js` — view management, paper creation, metadata lookup, explore search, legacy import
- `assets/js/pdf-annotations.js` — PDF.js rendering, text layer, selection and annotations
- `assets/js/sessions.js` — reading-session logging
- `assets/js/auth.js` — Supabase authentication and data loading
- `assets/js/wiring.js` — DOM event binding and startup orchestration
- `assets/js/stats.js` — stats dashboard
- `assets/js/deep-dive.js` — one-step-at-a-time Deep Dive navigation

## Best way to give this to another AI

For the annotation bug, provide only:
1. `index.html`
2. `assets/css/pdf.css`
3. `assets/js/pdf-annotations.js`
4. `assets/js/wiring.js`
5. `assets/js/config.js`

Ask it not to change unrelated files. This keeps the context focused on the actual failing subsystem.

## Important security note

The Supabase publishable/anon key is client-side by design, but database and storage security must be enforced with Supabase Row Level Security policies. Never put a service-role key in these files.
