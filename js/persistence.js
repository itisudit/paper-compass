// persistence.js
// Step 12 gave a reading session a schema, validation, and an autosave loop. Step 13 turns that into
// a small library of readings (library.js), so this module now provides the pieces both a single
// active reading and a whole library are built from, rather than owning one fixed storage key itself:
//
//   - a generic, guarded JSON codec for localStorage (readStorageJSON / writeStorageJSON /
//     removeStorageItem / quarantineItem) — used by library.js for the library file, and by this
//     module's own migration helper for the old Step 12 key
//   - the schema version, validation and migration for one session's worth of data (paper, depth,
//     stage, thinking, annotations, evidence, view) — the payload a library record wraps
//   - PDF identity (content hash, and matching a re-chosen file against what was saved)
//   - the autosave engine: a debounced, capped schedule that calls back into whatever `save()` the
//     caller configures — app.js supplies one that writes the active reading into the library
//
// A saved session is treated as untrusted input throughout: nothing here throws on bad data, and
// nothing here returns anything the rest of the app cannot safely render.

import { appState, readingInProgress, stageModules } from "./state.js";
import { depths, pathFor } from "./depths.js";

export const SCHEMA_VERSION = 1;

const SAVE_DELAY_MS = 500;
const SAVE_MAX_WAIT_MS = 4000;
const STAGE_IDS = Object.keys(stageModules);
const ANNOTATION_TYPES = ["highlight", "underline"];

// ---------- generic storage codec (every touch guarded; localStorage can throw even on read) ----------

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// status: "none" (key absent), "ok" (parsed successfully), "invalid" (present but not valid JSON),
// "unavailable" (localStorage itself could not be reached — blocked, disabled, or absent).
export function readStorageJSON(key) {
  const store = storage();
  if (!store) return { status: "unavailable", data: null };
  let raw;
  try {
    raw = store.getItem(key);
  } catch {
    return { status: "unavailable", data: null };
  }
  if (raw === null) return { status: "none", data: null };
  try {
    return { status: "ok", data: JSON.parse(raw) };
  } catch {
    return { status: "invalid", data: null };
  }
}

export function writeStorageJSON(key, value) {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Quota exceeded, storage disabled, or blocked by the browser.
    return false;
  }
}

export function removeStorageItem(key) {
  const store = storage();
  if (!store) return;
  try { store.removeItem(key); } catch { /* nothing more to do */ }
}

// Moves whatever is at `key` aside to `rejectedKey` (kept once, for recovery by hand) and removes
// it, so unreadable data cannot block the app on the next load. Best effort either way.
export function quarantineItem(key, rejectedKey) {
  const store = storage();
  if (!store) return;
  try {
    const raw = store.getItem(key);
    if (raw !== null) store.setItem(rejectedKey, raw);
  } catch { /* the backup is best effort */ }
  try { store.removeItem(key); } catch { /* nothing more to do */ }
}

// ---------- one session's data: validation ----------

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

// Returns a clean session snapshot, or null when the data is not a usable reading. This is the shape
// a library record wraps (see library.js): paper, intention, hunch, depth, and the reading session
// itself (stage, stuck, per-stage thinking, annotations, evidence, view).
export function sanitizeSnapshot(raw) {
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

// ---------- one session's data: versioning ----------

// migrations[n] upgrades a version n session snapshot to version n + 1. Empty while version 1 is the
// only schema this app has had.
const migrations = {};

export function migrate(raw) {
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

// ---------- one session's data: build and restore ----------

// Builds the current reading (appState) into the plain session-snapshot shape above. This is what
// the configured `save()` hook (see configurePersistence) hands to the library for one active reading,
// and what a freshly-migrated Step 12 record looks like before library.js adds an id to it.
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

// Puts a validated session snapshot (a library record, or the result of sanitizeSnapshot) into
// appState. The PDF file is not part of it, so paper.pdf is null; the record's own id/createdAt/
// lastOpened (if any) are ignored here — assigning appState.recordId is app.js's job, not this one's.
export function restoreSnapshot(snapshot, state = appState) {
  state.paper = { ...snapshot.paper, pdf: null };
  state.readingIntention = snapshot.readingIntention;
  state.initialInterpretation = snapshot.initialInterpretation;
  state.selectedDepth = snapshot.selectedDepth;
  state.decision = snapshot.selectedDepth;
  state.readingSession = { stage: "orient", stuck: [], stages: {}, annotations: [], evidence: [], view: { page: 1, fraction: 0 }, ...snapshot.session };
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

// ---------- autosave engine ----------

let healthy = true;
let onStatusChange = () => {};
let beforeSave = () => {};
let saveFn = () => false;

function setHealthy(value) {
  if (healthy === value) return;
  healthy = value;
  try { onStatusChange(healthy); } catch { /* a status listener must never break saving */ }
}

// False after a failed save, true again after the next successful one.
export function persistenceHealthy() {
  return healthy;
}

// beforeSave() runs just before each save so the app can copy live DOM values (the open textarea,
// the PDF position) into state. save() does the actual write and returns whether it succeeded — for
// the active reading this is normally `() => library.upsertRecord(appState.recordId, buildSnapshot())`.
// onStatusChange(healthy) fires when saving starts or stops working.
export function configurePersistence(options = {}) {
  beforeSave = options.beforeSave || (() => {});
  onStatusChange = options.onStatusChange || (() => {});
  saveFn = options.save || (() => false);
}

let timer = null;
let firstPendingAt = 0;

function cancelPendingSave() {
  clearTimeout(timer);
  timer = null;
  firstPendingAt = 0;
}

// Saves now, via the configured save(). Only a reading in progress is ever saved, so opening the
// app, browsing the paper form, or sitting on the library screen can never overwrite a saved reading.
export function flushSave() {
  cancelPendingSave();
  if (!readingInProgress()) return false;
  try { beforeSave(); } catch { /* still save what state already holds */ }
  let ok = false;
  try { ok = Boolean(saveFn()); } catch { ok = false; }
  setHealthy(ok);
  return ok;
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

// Cancels any save still waiting to happen, without writing anything. Used when the in-memory
// reading is being discarded (left, or replaced) so a stale debounced write cannot land afterwards.
export function cancelScheduledSave() {
  cancelPendingSave();
}
