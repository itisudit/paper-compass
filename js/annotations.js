// annotations.js
// Manages all annotation state (highlights, underlines) and evidence items/connections
// for the current reading session. State lives inside appState.readingSession so it
// is cleared when a new paper starts and preserved when the reader leaves and returns.
//
// Annotation representation
// --------------------------
// Each annotation is tied to the PDF page and to the text content items that were
// selected, NOT to raw pixel coordinates. This lets annotations be redrawn correctly
// after zoom, fit, rotate, or re-layout. The quads (bounding rects in PDF user-space)
// are stored as unit fractions of the page's natural (scale=1) viewport so they are
// scale-independent.
//
// {
//   id:        unique string id
//   pageNumber: 1-based integer
//   type:      "highlight" | "underline"
//   color:     color key (for highlights) | null (for underline)
//   text:      the selected text (for display/evidence)
//   rects:     [{x, y, w, h}] in PDF user-space fractions (0–1 of natural viewport)
// }
//
// Evidence representation
// -----------------------
// {
//   id:          unique string id
//   annotationId: id of associated annotation | null (if created without a mark)
//   text:        the selected/annotated text
//   pageNumber:  source page
//   connections: [stageId, …]
// }

let _session = null; // set by setSession()

export function setSession(session) {
  _session = session;
  if (!_session.annotations) _session.annotations = [];
  if (!_session.evidence) _session.evidence = [];
}

// --- internal helpers ---

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function annotations() { return _session.annotations; }
function evidence() { return _session.evidence; }

// --- annotation CRUD ---

export function addAnnotation({ pageNumber, type, color, text, rects }) {
  const ann = { id: uid(), pageNumber, type, color: color || null, text, rects };
  annotations().push(ann);
  return ann;
}

export function removeAnnotation(id) {
  const index = annotations().findIndex((a) => a.id === id);
  if (index !== -1) annotations().splice(index, 1);
  // Detach from evidence but keep the evidence item
  evidence().forEach((ev) => { if (ev.annotationId === id) ev.annotationId = null; });
}

export function getAnnotationsForPage(pageNumber) {
  return annotations().filter((a) => a.pageNumber === pageNumber);
}

// --- evidence CRUD ---

export function addEvidence({ annotationId, text, pageNumber }) {
  const ev = { id: uid(), annotationId: annotationId || null, text, pageNumber, connections: [] };
  evidence().push(ev);
  return ev;
}

export function addConnection(evidenceId, stageId) {
  const ev = evidence().find((e) => e.id === evidenceId);
  if (ev && !ev.connections.includes(stageId)) ev.connections.push(stageId);
}

export function removeConnection(evidenceId, stageId) {
  const ev = evidence().find((e) => e.id === evidenceId);
  if (ev) ev.connections = ev.connections.filter((s) => s !== stageId);
}

export function removeEvidence(id) {
  const index = evidence().findIndex((e) => e.id === id);
  if (index !== -1) evidence().splice(index, 1);
}

export function getAllEvidence() { return evidence(); }
