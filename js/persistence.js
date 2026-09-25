// persistence.js
// Step 12: local persistence for the active reading session.
//
// This module owns everything about saving and restoring a reading: the storage key, the schema
// version, serialization, validation and migration, and the autosave schedule. Nothing else in the
// app touches localStorage.
//
// What is saved: paper details, the PDF's identity (name, size, content hash), reading intention and
// first hunch, depth, current stage, every stage's own state, annotations, evidence, stuck records,
// and the PDF reading position. What is never saved: the PDF file itself, PDF.js objects, selection
// ranges, open menus, or any other DOM state.
//
// A saved snapshot is treated as untrusted input. loadSnapshot() never throws and never returns
// anything the rest of the app cannot safely render.

import { appState, createReadingSession, readingInProgress, stageModules } from "./state.js";
import { depthLabel, depths, pathFor } from "./depths.js";

export const STORAGE_KEY = "paperCompass.session";
export const REJECTED_KEY = "paperCompass.session.rejected";
export const SCHEMA_VERSION = 1;

const SAVE_DELAY_MS = 500;
const SAVE_MAX_WAIT_MS = 4000;
const STAGE_IDS = Object.keys(stageModules);
const ANNOTATION_TYPES = ["highlight", "underline"];

// ---------- storage access (every touch is guarded; localStorage can throw even on read) ----------

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

let healthy = true;
let onStatusChange = () => {};
let beforeSave = () => {};

function setHealthy(value) {
  if (healthy === value) return;
  healthy = value;
  try { onStatusChange(healthy); } catch { /* a status listener must never break saving */ }
}

// False after a failed read or write, true again after the next successful write.
export function persistenceHealthy() {
  return healthy;
}

// beforeSave() runs just before each write so the app can copy live DOM values (the open textarea,
// the PDF position) into state. onStatusChange(healthy) fires when saving starts or stops working.
export function configurePersistence(options = {}) {
  beforeSave = options.beforeSave || (() => {});
  onStatusChange = options.onStatusChange || (() => {});
}

// ---------- validation ----------

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => (typeof value === "string" ? value : "");
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isPageNumber = (value) => Number.isInteger(value) && value >= 1;
const uniqueStageIds = (value) => [...new Set(Array.isArray(value) ? value.filter((id) => STAGE_IDS.includes(id)) : [])];

function sanitizePaper(raw) {
  const paper = isObject(raw) ? raw : {};
  return {
    title: text(paper.title), authors: text(paper.authors), journal: text(paper.journal), year: text(paper.year),
    doi: text(paper.doi), volume: text(paper.volume), issue: text(paper.issue), pages: text(paper.pages),
    pdfName: text(paper.pdfName),
    pdfSize: isFiniteNumber(paper.pdfSize) && paper.pdfSize > 0 ? paper.pdfSize : 0,
    pdfHash: text(paper.pdfHash),
  };
}

// Each stage owns the shape of its state (initialState). A saved value is kept only if it has the
// same type as the default, so a stage that gains a field later still gets a sensible default.
function sanitizeStages(raw) {
  const saved = isObject(raw) ? raw : {};
  return Object.fromEntries(STAGE_IDS.map((id) => {
    const initial = stageModules[id].initialState();
    const slice = isObject(saved[id]) ? saved[id] : {};
    const clean = Object.fromEntries(Object.keys(initial).map((key) => {
      const value = slice[key];
      const sameType = typeof value === typeof initial[key] && Array.isArray(value) === Array.isArray(initial[key]);
      const usable = sameType && (typeof value !== "number" || (Number.isFinite(value) && value >= 0));
      return [key, usable ? value : initial[key]];
    }));
    return [id, clean];
  }));
}

function sanitizeAnnotations(raw) {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : []).flatMap((item) => {
    if (!isObject(item) || typeof item.id !== "string" || !item.id || seen.has(item.id)) return [];
    if (!isPageNumber(item.pageNumber) || !ANNOTATION_TYPES.includes(item.type)) return [];
    const rects = (Array.isArray(item.rects) ? item.rects : [])
      .filter((r) => isObject(r) && ["x", "y", "w", "h"].every((key) => isFiniteNumber(r[key])))
      .map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
    if (!rects.length) return [];
    seen.add(item.id);
    return [{ id: item.id, pageNumber: item.pageNumber, type: item.type, color: typeof item.color === "string" ? item.color : null, text: text(item.text), rects }];
  });
}

function sanitizeEvidence(raw, annotationIds) {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : []).flatMap((item) => {
    if (!isObject(item) || typeof item.id !== "string" || !item.id || seen.has(item.id)) return [];
    if (typeof item.text !== "string" || !item.text || !isPageNumber(item.pageNumber)) return [];
    seen.add(item.id);
    return [{
      id: item.id,
      // An annotation that did not survive validation is detached, as removeAnnotation() does.
      annotationId: typeof item.annotationId === "string" && annotationIds.has(item.annotationId) ? item.annotationId : null,
      text: item.text,
      pageNumber: item.pageNumber,
      connections: uniqueStageIds(item.connections),
      usedInStages: uniqueStageIds(item.usedInStages),
    }];
  });
}

function sanitizeStuck(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((item) => isObject(item) && typeof item.stage === "string" && typeof item.reason === "string")
    .map((item) => ({ stage: item.stage, reason: item.reason }));
}

function sanitizeView(raw) {
  const view = isObject(raw) ? raw : {};
  return {
    page: isPageNumber(view.page) ? view.page : 1,
    fraction: isFiniteNumber(view.fraction) ? Math.min(Math.max(view.fraction, -1), 1) : 0,
  };
}

// Returns a clean snapshot, or null when the data is not a usable reading.
function sanitizeSnapshot(raw) {
  if (!isObject(raw) || !Object.hasOwn(depths, raw.selectedDepth)) return null;
  const session = isObject(raw.session) ? raw.session : {};
  const path = pathFor(raw.selectedDepth);
  const annotations = sanitizeAnnotations(session.annotations);
  const annotationIds = new Set(annotations.map((a) => a.id));
  return {
    version: SCHEMA_VERSION,
    savedAt: isFiniteNumber(raw.savedAt) ? raw.savedAt : 0,
    paper: sanitizePaper(raw.paper),
    readingIntention: text(raw.readingIntention),
    initialInterpretation: text(raw.initialInterpretation),
    selectedDepth: raw.selectedDepth,
    session: {
      stage: path.includes(session.stage) ? session.stage : path[0],
      stuck: sanitizeStuck(session.stuck),
      stages: sanitizeStages(session.stages),
      annotations,
      evidence: sanitizeEvidence(session.evidence, annotationIds),
      view: sanitizeView(session.view),
    },
  };
}

// ---------- versioning ----------

// migrations[n] upgrades a version n snapshot to version n + 1. Empty while version 1 is the only schema.
const migrations = {};

function migrate(raw) {
  if (!isObject(raw) || !Number.isInteger(raw.version) || raw.version < 1) return null;
  let data = raw;
  while (data.version < SCHEMA_VERSION) {
    const step = migrations[data.version];
    if (!step) return null;
    data = { ...step(data), version: data.version + 1 };
  }
  // A snapshot from a newer app is not guessed at; it is set aside untouched.
  return data.version === SCHEMA_VERSION ? data : null;
}

// ---------- snapshot build and restore ----------

export function buildSnapshot(state = appState) {
  const { paper, readingSession: session } = state;
  return {
    version: SCHEMA_VERSION,
    savedAt: Date.now(),
    paper: {
      title: paper.title, authors: paper.authors, journal: paper.journal, year: paper.year, doi: paper.doi,
      volume: paper.volume, issue: paper.issue, pages: paper.pages,
      pdfName: paper.pdfName, pdfSize: paper.pdfSize, pdfHash: paper.pdfHash,
    },
    readingIntention: state.readingIntention,
    initialInterpretation: state.initialInterpretation,
    selectedDepth: state.selectedDepth,
    session: {
      stage: session.stage, stuck: session.stuck, stages: session.stages,
      annotations: session.annotations, evidence: session.evidence, view: session.view,
    },
  };
}

// Puts a validated snapshot into appState. The PDF file is not part of it, so paper.pdf is null.
export function restoreSnapshot(snapshot, state = appState) {
  state.paper = { ...snapshot.paper, pdf: null };
  state.readingIntention = snapshot.readingIntention;
  state.initialInterpretation = snapshot.initialInterpretation;
  state.selectedDepth = snapshot.selectedDepth;
  state.decision = snapshot.selectedDepth;
  state.readingSession = Object.assign(createReadingSession(), snapshot.session);
}

// One-line description of a snapshot for the recovery note.
export function describeSnapshot(snapshot) {
  const { selectedDepth: depth, session, savedAt, paper } = snapshot;
  let activity = "";
  try { activity = stageModules[session.stage].activity(depth); } catch { /* fall back to depth only */ }
  let when = "";
  try {
    when = savedAt ? new Date(savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
  } catch { /* locale formatting is decoration only */ }
  return {
    title: paper.title || "Untitled paper",
    detail: [depthLabel(depth), activity, when && `saved ${when}`].filter(Boolean).join(" · "),
  };
}

// ---------- PDF identity ----------

export async function fingerprintFile(file) {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || !file) return "";
    const digest = await subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

// Same file? Uses the content hash when both sides have one, otherwise name and size.
export function pdfMatches(paper, file, hash) {
  if (paper.pdfHash && hash) return paper.pdfHash === hash;
  return paper.pdfName === file.name && paper.pdfSize === file.size;
}

// ---------- load, save, clear ----------

// Moves unreadable data out of the way (kept once, for recovery by hand) so it cannot block the app.
export function quarantineSnapshot() {
  const store = storage();
  if (!store) return;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (raw !== null) store.setItem(REJECTED_KEY, raw);
  } catch { /* the backup is best effort */ }
  try { store.removeItem(STORAGE_KEY); } catch { /* nothing more to do */ }
}

// status: "none" (nothing saved), "ok" (snapshot is usable), "invalid" (set aside), "unavailable" (no storage).
export function loadSnapshot() {
  const store = storage();
  if (!store) {
    setHealthy(false);
    return { status: "unavailable", snapshot: null };
  }
  let stored;
  try {
    stored = store.getItem(STORAGE_KEY);
  } catch {
    setHealthy(false);
    return { status: "unavailable", snapshot: null };
  }
  if (stored === null) return { status: "none", snapshot: null };
  let snapshot = null;
  try {
    const migrated = migrate(JSON.parse(stored));
    snapshot = migrated ? sanitizeSnapshot(migrated) : null;
  } catch {
    snapshot = null;
  }
  if (!snapshot) {
    quarantineSnapshot();
    return { status: "invalid", snapshot: null };
  }
  return { status: "ok", snapshot };
}

function write(snapshot) {
  const store = storage();
  if (!store) {
    setHealthy(false);
    return false;
  }
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    setHealthy(true);
    return true;
  } catch {
    // Quota exceeded, storage disabled, or blocked by the browser. The reading carries on in memory.
    setHealthy(false);
    return false;
  }
}

let timer = null;
let firstPendingAt = 0;

function cancelPendingSave() {
  clearTimeout(timer);
  timer = null;
  firstPendingAt = 0;
}

// Writes now. Only a reading in progress is ever saved, so opening the app, browsing the paper form,
// or sitting on the recovery choice can never overwrite a stored reading.
export function flushSave() {
  cancelPendingSave();
  if (!readingInProgress()) return false;
  try { beforeSave(); } catch { /* still save what state already holds */ }
  return write(buildSnapshot());
}

// Debounced save for typing, clicks, annotation edits and scrolling. A steady stream of events is
// collapsed into one write after `delay`, and no more than SAVE_MAX_WAIT_MS passes without a write.
export function requestSave({ delay = SAVE_DELAY_MS } = {}) {
  if (!readingInProgress()) return;
  const now = Date.now();
  if (!firstPendingAt) firstPendingAt = now;
  clearTimeout(timer);
  timer = setTimeout(flushSave, Math.max(0, Math.min(delay, firstPendingAt + SAVE_MAX_WAIT_MS - now)));
}

// Forgets the saved reading, and any save still waiting to happen.
export function clearSnapshot() {
  cancelPendingSave();
  const store = storage();
  if (!store) return;
  try { store.removeItem(STORAGE_KEY); } catch { /* nothing more to do */ }
}
