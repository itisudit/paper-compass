# Changelog

## Unreleased

- Started the clean rebuild of Paper Compass.
- Added initial product and design documentation.
- Added the initial application shell.
- Added persistence and recovery (Step 12): autosave to localStorage, Resume reading / Start fresh on startup, versioned and validated saved state, PDF identity check on reattach.
- Annotation store now reads the current reading session instead of holding its own pointer, and reports changes so they are saved.
- Annotation and evidence layer wired end to end (verified in Chromium): PDF.js 6 TextLayer and its CSS, selection menu, highlight/underline/evidence creation, remove, evidence connect/disconnect and click-to-navigate in stage panels.
- Annotation rects are stored as fractions of the unrotated page and mapped through PDF.js viewport maths, so marks stay on their text through zoom, fit and rotation.
- Added a Library home (Step 13): saved papers are now a collection of independent reading sessions, each with its own stable id, rather than one single autosaved reading. New paper always creates a new record; Continue reopens one with everything restored; Leave reading returns to the Library; Delete removes one paper only.
- Refactored persistence.js into a generic storage codec + per-reading validation/autosave engine, and added library.js to own the saved collection (list/create/update/delete/sort) and migration. A Step 12 single-session save is folded into the library once, automatically.
- Added cross-paper relationships (Step 14): from a Library card, Relate one paper to another as Supports, Challenges, Extends, Contrasts or Related, with an optional note. Shown on both papers from each side's point of view; a paper cannot relate to itself, duplicates are refused, and deleting a paper removes its relationships. Stored in the library file (now version 2; Step 13 files load unchanged) and validated by the new relationships.js.
