# Changelog

## Unreleased

- Started the clean rebuild of Paper Compass.
- Added initial product and design documentation.
- Added the initial application shell.
- Added persistence and recovery (Step 12): autosave to localStorage, Resume reading / Start fresh on startup, versioned and validated saved state, PDF identity check on reattach.
- Annotation store now reads the current reading session instead of holding its own pointer, and reports changes so they are saved.
- Annotation and evidence layer wired end to end (verified in Chromium): PDF.js 6 TextLayer and its CSS, selection menu, highlight/underline/evidence creation, remove, evidence connect/disconnect and click-to-navigate in stage panels.
- Annotation rects are stored as fractions of the unrotated page and mapped through PDF.js viewport maths, so marks stay on their text through zoom, fit and rotation.
