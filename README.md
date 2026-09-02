# Paper Compass — Focused Deep Dive layout update

This update changes only the Deep Dive reading workflow:

- PDF viewer is on the left on desktop.
- The currently active step and its writing area are on the right, so reading and writing happen side by side.
- The existing one-step-at-a-time navigation remains intact.
- Linked annotations move below the PDF instead of occupying a second column.
- Linked annotations are compact preview chips by default.
- Clicking an annotation opens a full editor where the saved excerpt itself can be corrected, plus its note and link target can be changed.
- Delete is also available inside the annotation editor.
- On narrower screens the layout stacks vertically for usability.

Replace the corresponding files in your repository:

- `index.html`
- `assets/css/base.css`
- `assets/js/core.js`

Keep your other repository files unchanged.
