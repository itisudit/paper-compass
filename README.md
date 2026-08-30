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
