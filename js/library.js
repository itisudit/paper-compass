// library.js
// Step 13: the library of saved readings — the persistent collection Paper Compass keeps in
// localStorage. This module owns the collection only: listing, creating, updating, deleting and
// sorting records, and folding in a Step 12 single-session record the first time it finds one. It
// never touches appState — exactly one record is "open" at a time, in appState.readingSession, and
// that stays app.js's responsibility (see restoreSnapshot in persistence.js).
//
// Step 14 adds relationships — reader-created links between two records ("Paper B challenges Paper
// A", with an optional note) — to the same file. They belong to the library, not to any one reading
// session, so they live and are validated here too; the validation and dedupe rules themselves are
// relationships.js's, the same division as records and persistence.js.
//
// Storage shape (paperCompass.library):
//   {
//     version: LIBRARY_VERSION,
//     migratedLegacySession: boolean,  // true once the old Step 12 single-session key has been folded in
//     records: [ { id, createdAt, lastOpened, ...session snapshot } ],
//     relationships: [ { id, fromRecordId, toRecordId, type, note, createdAt, updatedAt } ],
//     syntheses: [ { id, question, paperIds, contributions, ..., createdAt, updatedAt } ]   // Step 15
//   }
// The "...session snapshot" part of each record is exactly what persistence.js's buildSnapshot() /
// sanitizeSnapshot() produce (paper, readingIntention, initialInterpretation, selectedDepth, session,
// version, savedAt) — library.js does not re-implement that validation, only wraps it with an id and
// two timestamps of its own: when the record was first created, and when it was last opened.

import {
  migrate as migrateSessionData, newId, quarantineItem, readStorageJSON, removeStorageItem,
  sanitizeSnapshot as sanitizeSessionData, writeStorageJSON,
} from "./persistence.js";
import {
  addRelationship as addRelationshipPure, describeRelationshipsForRecord as describeRelationshipsPure,
  removeRelationship as removeRelationshipPure, removeRelationshipsForRecord,
  sanitizeRelationships,
} from "./relationships.js";
import {
  createSynthesis as createSynthesisPure, describePaperRemoval as describePaperRemovalPure,
  removePaperFromSyntheses, removeSynthesis as removeSynthesisPure, sanitizeSyntheses,
  setContribution as setContributionPure, updateSynthesis as updateSynthesisPure,
} from "./synthesis.js";
import { stageModules } from "./state.js";
import { depthLabel } from "./depths.js";

export const LIBRARY_KEY = "paperCompass.library";
export const LIBRARY_REJECTED_KEY = "paperCompass.library.rejected";
// The single storage key Step 12 used for the one active reading. Kept only so a browser that still
// has one lying around gets it folded into the library exactly once.
export const LEGACY_SESSION_KEY = "paperCompass.session";
export const LEGACY_REJECTED_KEY = "paperCompass.session.rejected";
// Step 13 shipped with only records, at version 1. Step 14 added a relationships array alongside
// them (version 2), and Step 15 adds a syntheses array (version 3). A file missing either key is
// accepted at its own version and simply has none (see sanitizeLibrary below), so no earlier library
// needs an explicit upgrade step; it is rewritten at LIBRARY_VERSION the next time anything is saved.
// A version this app has never produced (0, or newer than LIBRARY_VERSION) is not guessed at.
export const LIBRARY_VERSION = 3;
const KNOWN_LIBRARY_VERSIONS = [1, 2, 3];

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

function emptyLibrary() {
  return { version: LIBRARY_VERSION, migratedLegacySession: false, records: [], relationships: [], syntheses: [] };
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
  if (!isObject(raw) || !KNOWN_LIBRARY_VERSIONS.includes(raw.version)) return null;
  const records = (Array.isArray(raw.records) ? raw.records : []).map(sanitizeRecord).filter(Boolean);
  // Two records sharing an id would make "open" and "delete" ambiguous; keep the more recently saved.
  const byId = new Map();
  for (const record of records) {
    const existing = byId.get(record.id);
    if (!existing || (record.savedAt || 0) >= (existing.savedAt || 0)) byId.set(record.id, record);
  }
  const keptRecords = [...byId.values()];
  // A version-1 file has no relationships key at all; sanitizeRelationships treats that exactly like
  // an empty array, which is the correct reading of "no relationships existed yet".
  const validIds = new Set(keptRecords.map((r) => r.id));
  const relationships = sanitizeRelationships(raw.relationships, validIds);
  // Syntheses are checked against the records themselves, not just their ids, because a contribution's
  // evidence has to belong to that paper's own reading session.
  const syntheses = sanitizeSyntheses(raw.syntheses, keptRecords);
  return { version: LIBRARY_VERSION, migratedLegacySession: raw.migratedLegacySession === true, records: keptRecords, relationships, syntheses };
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
    if (body) addition = { ...body, id: newId("rec"), createdAt: body.savedAt || Date.now(), lastOpened: body.savedAt || Date.now() };
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
  if (found.status === "unavailable") return { status: "unavailable", records: [], relationships: [], syntheses: [] };
  let library = found.status === "ok" ? sanitizeLibrary(found.data) : null;
  const invalid = found.status === "invalid" || (found.status === "ok" && !library);
  if (invalid) quarantineItem(LIBRARY_KEY, LIBRARY_REJECTED_KEY);
  if (!library) library = emptyLibrary();
  const migrated = migrateLegacySession(library);
  if (migrated) {
    library = migrated;
    writeStorageJSON(LIBRARY_KEY, library); // best effort; the in-memory result is returned regardless
  }
  return { status: invalid ? "invalid" : found.status, records: library.records, relationships: library.relationships, syntheses: library.syntheses };
}

// The library, sorted for display.
export function listRecords() {
  return sortRecords(loadLibrary().records);
}

export function getRecord(id) {
  return loadLibrary().records.find((record) => record.id === id) ?? null;
}

export function createRecordId() {
  return newId("rec");
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

// Removes one record, and — so nothing can ever point at a paper that no longer exists — every
// relationship that named it on either side, and its place in every synthesis (a synthesis left with
// fewer than two papers is removed; see synthesis.js). Returns true if a record was found and the
// library was written back.
export function deleteRecord(id) {
  const found = readStorageJSON(LIBRARY_KEY);
  const library = found.status === "ok" ? sanitizeLibrary(found.data) : null;
  if (!library) return false;
  const records = library.records.filter((record) => record.id !== id);
  if (records.length === library.records.length) return false;
  const relationships = removeRelationshipsForRecord(library.relationships, id);
  const syntheses = removePaperFromSyntheses(library.syntheses, id);
  return writeStorageJSON(LIBRARY_KEY, { ...library, records, relationships, syntheses });
}

// ---------- relationships ----------
// Storage lives in the same library file as records (paperCompass.library), so every operation here
// follows the same read-validate-modify-write shape as upsertRecord/deleteRecord above. The
// validation and dedupe rules themselves are relationships.js's job, not repeated here.

// Every relationship touching one record, described from that record's point of view, ready to show
// on its card. Always freshly computed from storage — nothing about a relationship is cached.
export function getRelationshipsForRecord(id) {
  const { records, relationships } = loadLibrary();
  return describeRelationshipsPure(id, relationships, records);
}

// Creates one relationship. Returns { ok: true, relationship } on success, or { ok: false, reason }
// — see relationships.js's addRelationship for what reason can be — including "storage" when the
// library itself could not be read or the write failed (unavailable storage, quota).
export function addRelationship(input) {
  const found = readStorageJSON(LIBRARY_KEY);
  if (found.status === "unavailable") return { ok: false, reason: "storage" };
  const library = (found.status === "ok" ? sanitizeLibrary(found.data) : null) || emptyLibrary();
  const result = addRelationshipPure(library.relationships, library.records, input);
  if (!result.ok) return result;
  if (!writeStorageJSON(LIBRARY_KEY, { ...library, relationships: result.relationships })) {
    return { ok: false, reason: "storage" };
  }
  return { ok: true, relationship: result.relationship };
}

// Removes one relationship by id. Returns true if it existed and the library was written back.
export function deleteRelationship(id) {
  const found = readStorageJSON(LIBRARY_KEY);
  const library = found.status === "ok" ? sanitizeLibrary(found.data) : null;
  if (!library) return false;
  const relationships = removeRelationshipPure(library.relationships, id);
  if (relationships === library.relationships) return false; // nothing had that id
  return writeStorageJSON(LIBRARY_KEY, { ...library, relationships });
}

// ---------- syntheses ----------
// Same read-validate-modify-write shape as the relationship operations above; the rules themselves
// live in synthesis.js. Every operation returns { ok: true, synthesis } or { ok: false, reason },
// where reason is "storage" when the library could not be read or written (unavailable storage,
// quota), otherwise one of the reasons synthesis.js documents.

export function listSyntheses() {
  return [...loadLibrary().syntheses].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSynthesis(id) {
  return loadLibrary().syntheses.find((s) => s.id === id) ?? null;
}

// What deleting a paper would do to syntheses ({ involved, removed, shrunk }), for the confirmation.
export function describePaperRemoval(recordId) {
  return describePaperRemovalPure(loadLibrary().syntheses, recordId);
}

function mutateSyntheses(operation) {
  const found = readStorageJSON(LIBRARY_KEY);
  if (found.status === "unavailable") return { ok: false, reason: "storage" };
  const library = (found.status === "ok" ? sanitizeLibrary(found.data) : null) || emptyLibrary();
  const result = operation(library);
  if (!result.ok) return result;
  if (!writeStorageJSON(LIBRARY_KEY, { ...library, syntheses: result.syntheses })) return { ok: false, reason: "storage" };
  return { ok: true, synthesis: result.synthesis };
}

export function createSynthesis(input) {
  return mutateSyntheses((library) => createSynthesisPure(library.syntheses, library.records, input));
}

export function updateSynthesis(id, patch) {
  return mutateSyntheses((library) => updateSynthesisPure(library.syntheses, library.records, id, patch));
}

export function setSynthesisContribution(id, patch) {
  return mutateSyntheses((library) => setContributionPure(library.syntheses, library.records, id, patch));
}

// Removes one synthesis by id. Returns true if it existed and the library was written back.
export function deleteSynthesis(id) {
  const found = readStorageJSON(LIBRARY_KEY);
  const library = found.status === "ok" ? sanitizeLibrary(found.data) : null;
  if (!library) return false;
  const syntheses = removeSynthesisPure(library.syntheses, id);
  if (syntheses === library.syntheses) return false;
  return writeStorageJSON(LIBRARY_KEY, { ...library, syntheses });
}

function startOfDay(ts) {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

// "Today", "Yesterday", "3 days ago", or a date — shared by "Last read" on papers and "Updated" on syntheses.
export function formatRelativeDay(ts) {
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
    lastOpenedLabel: formatRelativeDay(record.lastOpened),
  };
}
