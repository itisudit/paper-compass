// library.js
// Step 13: the library of saved readings — the persistent collection Paper Compass keeps in
// localStorage. This module owns the collection only: listing, creating, updating, deleting and
// sorting records, and folding in a Step 12 single-session record the first time it finds one. It
// never touches appState — exactly one record is "open" at a time, in appState.readingSession, and
// that stays app.js's responsibility (see restoreSnapshot in persistence.js).
//
// Storage shape (paperCompass.library):
//   {
//     version: LIBRARY_VERSION,
//     migratedLegacySession: boolean,  // true once the old Step 12 single-session key has been folded in
//     records: [ { id, createdAt, lastOpened, ...session snapshot } ]
//   }
// The "...session snapshot" part of each record is exactly what persistence.js's buildSnapshot() /
// sanitizeSnapshot() produce (paper, readingIntention, initialInterpretation, selectedDepth, session,
// version, savedAt) — library.js does not re-implement that validation, only wraps it with an id and
// two timestamps of its own: when the record was first created, and when it was last opened.

import {
  migrate as migrateSessionData, quarantineItem, readStorageJSON, removeStorageItem,
  sanitizeSnapshot as sanitizeSessionData, writeStorageJSON,
} from "./persistence.js";
import { stageModules } from "./state.js";
import { depthLabel } from "./depths.js";

export const LIBRARY_KEY = "paperCompass.library";
export const LIBRARY_REJECTED_KEY = "paperCompass.library.rejected";
// The single storage key Step 12 used for the one active reading. Kept only so a browser that still
// has one lying around gets it folded into the library exactly once.
export const LEGACY_SESSION_KEY = "paperCompass.session";
export const LEGACY_REJECTED_KEY = "paperCompass.session.rejected";
export const LIBRARY_VERSION = 1;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

function newId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* fall through to the manual id below */ }
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function emptyLibrary() {
  return { version: LIBRARY_VERSION, migratedLegacySession: false, records: [] };
}

// A validated record: a sanitized session snapshot (see persistence.js) plus its library-only fields.
// Returns null if the id is missing (a record with no id could never be found again, so it is not a
// usable record) or the session snapshot itself does not validate.
function sanitizeRecord(raw) {
  if (!isObject(raw) || typeof raw.id !== "string" || !raw.id) return null;
  const migrated = migrateSessionData(raw);
  const body = migrated ? sanitizeSessionData(migrated) : null;
  if (!body) return null;
  return {
    ...body,
    id: raw.id,
    createdAt: isFiniteNumber(raw.createdAt) ? raw.createdAt : (body.savedAt || Date.now()),
    lastOpened: isFiniteNumber(raw.lastOpened) ? raw.lastOpened : (body.savedAt || Date.now()),
  };
}

function sanitizeLibrary(raw) {
  if (!isObject(raw) || !Number.isInteger(raw.version)) return null;
  const records = (Array.isArray(raw.records) ? raw.records : []).map(sanitizeRecord).filter(Boolean);
  // Two records sharing an id would make "open" and "delete" ambiguous; keep the more recently saved.
  const byId = new Map();
  for (const record of records) {
    const existing = byId.get(record.id);
    if (!existing || (record.savedAt || 0) >= (existing.savedAt || 0)) byId.set(record.id, record);
  }
  return { version: LIBRARY_VERSION, migratedLegacySession: raw.migratedLegacySession === true, records: [...byId.values()] };
}

// Most-recently-opened first. Exported separately so callers (and tests) can sort a record list
// without going through storage, and so this is the one place the order is decided.
export function sortRecords(records) {
  return [...records].sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
}

// Folds a Step 12 single-session record into the library the first time one is found. Idempotent:
// once migratedLegacySession is true, this is a no-op even if the old key still exists (e.g. because
// removing it failed under a quota error) — the flag, not the key's absence, is the source of truth.
// Returns null when there was nothing new to do, or the updated library (not yet written) otherwise.
function migrateLegacySession(library) {
  if (library.migratedLegacySession) return null;
  const found = readStorageJSON(LEGACY_SESSION_KEY);
  let addition = null;
  if (found.status === "ok") {
    const migrated = migrateSessionData(found.data);
    const body = migrated ? sanitizeSessionData(migrated) : null;
    if (body) addition = { ...body, id: newId(), createdAt: body.savedAt || Date.now(), lastOpened: body.savedAt || Date.now() };
  } else if (found.status === "invalid") {
    quarantineItem(LEGACY_SESSION_KEY, LEGACY_REJECTED_KEY);
  }
  // Best effort; migratedLegacySession makes the next load correct even if this fails.
  removeStorageItem(LEGACY_SESSION_KEY);
  return { ...library, migratedLegacySession: true, records: addition ? [...library.records, addition] : library.records };
}

// Loads the library, running the legacy migration above if it has not happened yet. Never throws.
// status: "none" (nothing saved yet), "ok", "invalid" (the library file itself was unreadable and has
// been quarantined; the reader still gets an empty, working library), "unavailable" (no localStorage).
export function loadLibrary() {
  const found = readStorageJSON(LIBRARY_KEY);
  if (found.status === "unavailable") return { status: "unavailable", records: [] };
  let library = found.status === "ok" ? sanitizeLibrary(found.data) : null;
  const invalid = found.status === "invalid" || (found.status === "ok" && !library);
  if (invalid) quarantineItem(LIBRARY_KEY, LIBRARY_REJECTED_KEY);
  if (!library) library = emptyLibrary();
  const migrated = migrateLegacySession(library);
  if (migrated) {
    library = migrated;
    writeStorageJSON(LIBRARY_KEY, library); // best effort; the in-memory result is returned regardless
  }
  return { status: invalid ? "invalid" : found.status, records: library.records };
}

// The library, sorted for display.
export function listRecords() {
  return sortRecords(loadLibrary().records);
}

export function getRecord(id) {
  return loadLibrary().records.find((record) => record.id === id) ?? null;
}

export function createRecordId() {
  return newId();
}

// Creates or updates one record. `touchOpened` bumps lastOpened to now (used when the reader opens a
// paper); otherwise lastOpened is left as it was, so routine autosaves do not reorder the library
// while the reader is mid-reading. A brand-new record (an id not seen before, i.e. a paper just
// started) always gets lastOpened set to now — the moment it is created is the moment it was opened.
// Returns the stored record, or null if writing failed (storage unavailable or full).
export function upsertRecord(id, sessionData, { touchOpened = false } = {}) {
  if (!id) return null;
  const found = readStorageJSON(LIBRARY_KEY);
  const library = (found.status === "ok" ? sanitizeLibrary(found.data) : null) || emptyLibrary();
  const now = Date.now();
  const index = library.records.findIndex((record) => record.id === id);
  const record = index === -1
    ? { ...sessionData, id, createdAt: now, lastOpened: now }
    : { ...library.records[index], ...sessionData, lastOpened: touchOpened ? now : library.records[index].lastOpened };
  const records = index === -1 ? [...library.records, record] : library.records.map((r, i) => (i === index ? record : r));
  return writeStorageJSON(LIBRARY_KEY, { ...library, records }) ? record : null;
}

// Marks a record as just opened without changing its content. Used when the reader chooses Continue
// on a saved paper, so the library reflects that even before anything about the reading changes.
export function touchOpened(id) {
  const record = getRecord(id);
  if (!record) return null;
  const { id: recordId, createdAt, lastOpened, ...sessionData } = record;
  return upsertRecord(recordId, sessionData, { touchOpened: true });
}

// Removes one record. Returns true if a record was found and the library was written back.
export function deleteRecord(id) {
  const found = readStorageJSON(LIBRARY_KEY);
  const library = found.status === "ok" ? sanitizeLibrary(found.data) : null;
  if (!library) return false;
  const records = library.records.filter((record) => record.id !== id);
  if (records.length === library.records.length) return false;
  return writeStorageJSON(LIBRARY_KEY, { ...library, records });
}

function startOfDay(ts) {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatLastOpened(ts) {
  if (!isFiniteNumber(ts) || ts <= 0) return "";
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  try {
    return new Date(ts).toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return "";
  }
}

// A short, card-friendly description of a record: title, byline, depth, a status derived from where
// the reading stands (not a score), and when it was last opened. Nothing here is stored on the
// record itself — it is recomputed from the reading state every time, so it can never drift from it.
export function describeRecord(record) {
  const { selectedDepth: depth, session, paper } = record;
  let stageLabel = "";
  try {
    stageLabel = stageModules[session.stage]?.activity(depth) || "";
  } catch { /* fall back to depth alone below */ }
  const judgement = session.stages?.judge?.judgement?.trim();
  return {
    id: record.id,
    title: paper.title || "Untitled paper",
    byline: [paper.authors, paper.journal].filter(Boolean).join(" · "),
    depthLabel: depthLabel(depth),
    status: judgement ? "Judgement recorded" : (stageLabel || "In progress"),
    lastOpenedLabel: formatLastOpened(record.lastOpened),
  };
}
