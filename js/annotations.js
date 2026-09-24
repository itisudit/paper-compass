// annotations.js
// Central store for annotation and evidence state.
// Stored inside appState.readingSession so it resets with each new paper
// and survives leave/return within the same session.
//
// Annotation shape (Step 10):
// {
//   id:         string
//   pageNumber: number  (1-based)
//   type:       "highlight" | "underline"
//   color:      string | null
//   text:       string
//   rects:      [{x, y, w, h}]  — fractions of canvas display size
// }
//
// Evidence shape (Step 10 + Step 11):
// {
//   id:           string
//   annotationId: string | null
//   text:         string
//   pageNumber:   number
//   connections:  string[]   — stage ids connected by the reader
//   usedInStages: string[]   — stage ids where reader pressed "Use this" (Step 11)
// }

let _session = null;

export function setSession(session) {
  _session = session;
  if (!Array.isArray(_session.annotations)) _session.annotations = [];
  if (!Array.isArray(_session.evidence))    _session.evidence = [];
  // Back-fill usedInStages on any items created before Step 11 upgrade
  _session.evidence.forEach(ev => {
    if (!Array.isArray(ev.usedInStages)) ev.usedInStages = [];
  });
}

// ---- helpers ----

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function ann()  { return _session?.annotations ?? []; }
function evs()  { return _session?.evidence ?? []; }

// ---- annotations ----

export function addAnnotation({ pageNumber, type, color, text, rects }) {
  const a = { id: uid(), pageNumber, type, color: color ?? null, text, rects };
  ann().push(a);
  return a;
}

export function removeAnnotation(id) {
  const idx = ann().findIndex(a => a.id === id);
  if (idx !== -1) ann().splice(idx, 1);
  // Detach from evidence but keep evidence item
  evs().forEach(ev => { if (ev.annotationId === id) ev.annotationId = null; });
}

export function getAnnotationsForPage(pageNumber) {
  return ann().filter(a => a.pageNumber === pageNumber);
}

// ---- evidence ----

export function addEvidence({ annotationId, text, pageNumber }) {
  const ev = {
    id: uid(),
    annotationId: annotationId ?? null,
    text,
    pageNumber,
    connections: [],
    usedInStages: [],   // Step 11
  };
  evs().push(ev);
  return ev;
}

export function removeEvidence(id) {
  const idx = evs().findIndex(e => e.id === id);
  if (idx !== -1) evs().splice(idx, 1);
}

export function connectEvidence(id, stageId) {
  const ev = evs().find(e => e.id === id);
  if (ev && !ev.connections.includes(stageId)) ev.connections.push(stageId);
}

export function disconnectEvidence(id, stageId) {
  const ev = evs().find(e => e.id === id);
  if (ev) ev.connections = ev.connections.filter(s => s !== stageId);
}

// Step 11: mark an evidence item as being used for a particular stage's thinking.
// Does not modify the reader's written response.
export function markEvidenceUsed(id, stageId) {
  const ev = evs().find(e => e.id === id);
  if (ev && !ev.usedInStages.includes(stageId)) ev.usedInStages.push(stageId);
}

export function unmarkEvidenceUsed(id, stageId) {
  const ev = evs().find(e => e.id === id);
  if (ev) ev.usedInStages = ev.usedInStages.filter(s => s !== stageId);
}

// ---- queries ----

export function getAllEvidence() {
  return evs();
}

export function getEvidenceForStage(stageId) {
  return evs().filter(ev => ev.connections.includes(stageId));
}

export function getOtherEvidence(stageId) {
  return evs().filter(ev => !ev.connections.includes(stageId));
}
