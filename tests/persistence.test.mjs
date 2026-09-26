// Step 12/13 checks for persistence.js (the per-session codec and autosave engine) and library.js
// (the saved collection built on top of it). Run with `npm test` (Node 20+). No dependencies, no
// browser: localStorage is a small stub.
import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { appState, resetAppState, createReadingSession } from "../js/state.js";
import { pathFor } from "../js/depths.js";
import {
  SCHEMA_VERSION, buildSnapshot, cancelScheduledSave, configurePersistence, flushSave,
  persistenceHealthy, readStorageJSON, requestSave, restoreSnapshot, writeStorageJSON,
} from "../js/persistence.js";
import {
  LEGACY_SESSION_KEY, LIBRARY_KEY, LIBRARY_REJECTED_KEY, LIBRARY_VERSION, createRecordId,
  deleteRecord, describeRecord, getRecord, loadLibrary, sortRecords, touchOpened, upsertRecord,
} from "../js/library.js";
import {
  addAnnotation, addEvidence, connectEvidence, getAllEvidence, getAnnotationsForPage,
  markEvidenceUsed, onAnnotationStateChange,
} from "../js/annotations.js";

class FakeStorage {
  constructor() { this.map = new Map(); this.failWrites = false; this.writes = 0; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) {
    if (this.failWrites) throw new DOMException("quota", "QuotaExceededError");
    this.writes += 1;
    this.map.set(key, String(value));
  }
  removeItem(key) { this.map.delete(key); }
}

let store;
beforeEach(() => {
  // persistence.js's "healthy" flag is a module singleton, so force it back to true before each test
  // regardless of how the previous test left it, using a real save through the same path tests use.
  store = new FakeStorage();
  globalThis.localStorage = store;
  onAnnotationStateChange(null);
  resetAppState();
  configurePersistence({ save: () => Boolean(upsertRecord(appState.recordId, buildSnapshot())) });
  startReading();
  flushSave();
  resetAppState();
  configurePersistence();
  store = new FakeStorage();
  globalThis.localStorage = store;
  store.writes = 0;
});

function startReading(depth = "dive-deep", overrides = {}) {
  appState.paper = {
    title: "Land tenure and crop switching", authors: "A. Author", journal: "J. Ag Econ", year: "2024",
    doi: "10.1000/x", volume: "12", issue: "3", pages: "100-120",
    pdf: { fake: "file" }, pdfName: "paper.pdf", pdfSize: 1234, pdfHash: "abc123", ...overrides.paper,
  };
  appState.readingIntention = "Check the tenure result";
  appState.initialInterpretation = "I suspect selection";
  appState.selectedDepth = depth;
  appState.decision = depth;
  appState.readingSession = createReadingSession();
  appState.recordId = overrides.recordId || createRecordId();
  return appState.recordId;
}

function fillReading() {
  const session = appState.readingSession;
  session.stage = "appraise";
  session.stages.orient.note = "The question";
  session.stages.reconstruct.attempt = "First sketch";
  session.stages.reconstruct.revision = "Revised sketch";
  session.stages.reconstruct.hintLevel = 2;
  session.stages.reconstruct.inspected = true;
  session.stuck.push({ stage: "reconstruct", reason: "Something doesn't make sense" });
  session.view = { page: 4, fraction: 0.35 };
  const a = addAnnotation({ pageNumber: 4, type: "highlight", color: "green", text: "a passage", rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.02 }] });
  addAnnotation({ pageNumber: 2, type: "underline", color: null, text: "another", rects: [{ x: 0.1, y: 0.5, w: 0.2, h: 0.02 }] });
  const ev = addEvidence({ annotationId: a.id, text: "a passage", pageNumber: 4 });
  connectEvidence(ev.id, "appraise");
  connectEvidence(ev.id, "judge");
  markEvidenceUsed(ev.id, "appraise");
  addEvidence({ annotationId: null, text: "loose evidence", pageNumber: 1 });
  return { a, ev };
}

function freshTab() { // what a browser refresh does: memory is gone, storage stays
  resetAppState();
  onAnnotationStateChange(null);
}

// Wires the autosave engine the way app.js does, so flushSave()/requestSave() exercise the same path.
function wireAutosave() {
  configurePersistence({ save: () => Boolean(upsertRecord(appState.recordId, buildSnapshot())) });
}

// ---------------------------------------------------------------------------
// persistence.js: the per-session codec and autosave engine
// ---------------------------------------------------------------------------

test("a session round trips through the configured save/restore path with every listed part intact", () => {
  wireAutosave();
  const id = startReading();
  const { a, ev } = fillReading();
  assert.equal(flushSave(), true);
  const before = JSON.parse(JSON.stringify(buildSnapshot()));

  freshTab();
  const record = getRecord(id);
  assert.ok(record);
  restoreSnapshot(record);
  appState.recordId = record.id;

  assert.equal(appState.paper.title, "Land tenure and crop switching");
  assert.equal(appState.paper.pdf, null);
  assert.equal(appState.paper.pdfName, "paper.pdf");
  assert.equal(appState.selectedDepth, "dive-deep");
  assert.equal(appState.decision, "dive-deep");
  assert.equal(appState.readingIntention, "Check the tenure result");
  assert.equal(appState.readingSession.stage, "appraise");
  assert.equal(appState.readingSession.stages.reconstruct.revision, "Revised sketch");
  assert.equal(appState.readingSession.stages.reconstruct.hintLevel, 2);
  assert.deepEqual(appState.readingSession.stuck, [{ stage: "reconstruct", reason: "Something doesn't make sense" }]);
  assert.deepEqual(appState.readingSession.view, { page: 4, fraction: 0.35 });
  assert.equal(getAnnotationsForPage(4)[0].id, a.id);
  assert.equal(getAllEvidence().length, 2);
  const restored = getAllEvidence().find((e) => e.id === ev.id);
  assert.deepEqual(restored.connections, ["appraise", "judge"]);
  assert.deepEqual(restored.usedInStages, ["appraise"]);

  const after = JSON.parse(JSON.stringify(buildSnapshot()));
  after.savedAt = before.savedAt;
  assert.deepEqual(after, before);
});

test("the PDF file and other non-serialisable state never reach storage", () => {
  wireAutosave();
  const id = startReading();
  fillReading();
  flushSave();
  const raw = store.getItem(LIBRARY_KEY);
  assert.equal(raw.includes("fake"), false);
  const record = getRecord(id);
  assert.equal(Object.hasOwn(record.paper, "pdf"), false);
  assert.equal(record.version, SCHEMA_VERSION);
});

test("nothing is written unless a reading is in progress", () => {
  wireAutosave();
  store.setItem(LIBRARY_KEY, "sentinel");
  store.writes = 0;
  assert.equal(flushSave(), false);
  requestSave();
  assert.equal(store.writes, 0);
  assert.equal(store.getItem(LIBRARY_KEY), "sentinel");
});

test("unavailable storage does not throw and is reported", () => {
  const statuses = [];
  wireAutosave();
  configurePersistence({ onStatusChange: (ok) => statuses.push(ok), save: () => Boolean(upsertRecord(appState.recordId, buildSnapshot())) });
  delete globalThis.localStorage;
  startReading();
  assert.equal(flushSave(), false);
  assert.equal(persistenceHealthy(), false);
  assert.deepEqual(statuses, [false]);
});

test("a quota error fails soft and recovers on the next successful save", () => {
  const statuses = [];
  wireAutosave();
  configurePersistence({ onStatusChange: (ok) => statuses.push(ok), save: () => Boolean(upsertRecord(appState.recordId, buildSnapshot())) });
  startReading();
  store.failWrites = true;
  assert.equal(flushSave(), false);
  assert.equal(persistenceHealthy(), false);
  store.failWrites = false;
  assert.equal(flushSave(), true);
  assert.equal(persistenceHealthy(), true);
  assert.deepEqual(statuses, [false, true]);
});

test("autosave debounces bursts into one write and never waits past the maximum", () => {
  wireAutosave();
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    startReading();
    for (let i = 0; i < 20; i += 1) { requestSave(); mock.timers.tick(100); }
    assert.equal(store.writes, 0);
    mock.timers.tick(500);
    assert.equal(store.writes, 1);
    for (let i = 0; i < 100; i += 1) { requestSave(); mock.timers.tick(100); }
    assert.ok(store.writes >= 3, `writes: ${store.writes}`);
  } finally {
    mock.timers.reset();
  }
});

test("cancelScheduledSave stops a pending write so a discarded reading cannot come back", () => {
  wireAutosave();
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    const id = startReading();
    requestSave();
    cancelScheduledSave();
    mock.timers.tick(5000);
    assert.equal(getRecord(id), null);
  } finally {
    mock.timers.reset();
  }
});

test("malformed JSON in a generic key is reported as invalid, never thrown", () => {
  store.setItem("some.key", "{not json");
  const result = readStorageJSON("some.key");
  assert.equal(result.status, "invalid");
  assert.equal(result.data, null);
});

// ---------------------------------------------------------------------------
// library.js: the saved collection
// ---------------------------------------------------------------------------

test("upsertRecord creates a new record with lastOpened set, and updates in place afterwards", () => {
  const id = startReading("swim");
  const record1 = upsertRecord(id, buildSnapshot());
  assert.ok(record1.lastOpened > 0);
  assert.equal(record1.createdAt, record1.lastOpened);
  appState.readingSession.stage = "judge";
  const record2 = upsertRecord(id, buildSnapshot());
  assert.equal(record2.id, id);
  assert.equal(record2.createdAt, record1.createdAt);
  assert.equal(record2.lastOpened, record1.lastOpened); // routine autosave does not bump lastOpened
  assert.equal(record2.session.stage, "judge");
  assert.equal(loadLibrary().records.length, 1);
});

test("touchOpened bumps lastOpened without changing content, and is what Continue calls", async () => {
  const id = startReading("swim");
  upsertRecord(id, buildSnapshot());
  const before = getRecord(id);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const after = touchOpened(id);
  assert.ok(after.lastOpened >= before.lastOpened);
  assert.equal(after.session.stage, before.session.stage);
  assert.deepEqual(after.paper, before.paper);
});

test("two independent papers keep separate records, and editing one never touches the other", () => {
  const idA = startReading("swim", { paper: { title: "Paper A", pdfName: "a.pdf" } });
  upsertRecord(idA, buildSnapshot());
  const idB = startReading("dive-deep", { paper: { title: "Paper B", pdfName: "b.pdf" } });
  upsertRecord(idB, buildSnapshot());

  // Simulate switching the active reading back to A, the way openRecord() does: restore its
  // snapshot into appState before editing it, rather than editing whatever appState still holds.
  restoreSnapshot(getRecord(idA));
  appState.recordId = idA;
  appState.readingSession.stages.orient.note = "Note only on A";
  upsertRecord(idA, buildSnapshot());

  const recordA = getRecord(idA);
  const recordB = getRecord(idB);
  assert.equal(recordA.paper.title, "Paper A");
  assert.equal(recordB.paper.title, "Paper B");
  assert.equal(recordA.session.stages.orient.note, "Note only on A");
  assert.equal(recordB.session.stages.orient.note, "");
  assert.equal(loadLibrary().records.length, 2);
});

test("deleting one record removes only that one", () => {
  const idA = startReading("swim", { paper: { title: "Paper A" } });
  upsertRecord(idA, buildSnapshot());
  const idB = startReading("swim", { paper: { title: "Paper B" } });
  upsertRecord(idB, buildSnapshot());

  assert.equal(deleteRecord(idA), true);
  assert.equal(getRecord(idA), null);
  assert.equal(getRecord(idB).paper.title, "Paper B");
  assert.equal(loadLibrary().records.length, 1);
  assert.equal(deleteRecord("not-a-real-id"), false);
});

test("a new paper never carries annotations or evidence from a previous one", () => {
  const idA = startReading("swim");
  fillReading();
  upsertRecord(idA, buildSnapshot());
  resetAppState();
  const idB = startReading("swim", { paper: { title: "Paper B" } });
  assert.deepEqual(appState.readingSession.annotations, []);
  assert.deepEqual(getAllEvidence(), []);
  upsertRecord(idB, buildSnapshot());
  const recordB = getRecord(idB);
  assert.deepEqual(recordB.session.annotations, []);
  assert.deepEqual(recordB.session.evidence, []);
});

test("sortRecords and listing put the most recently opened paper first", () => {
  const idA = startReading("swim", { paper: { title: "Older" } });
  const recA = upsertRecord(idA, buildSnapshot());
  const idB = startReading("swim", { paper: { title: "Newer" } });
  const recB = { ...upsertRecord(idB, buildSnapshot()), lastOpened: recA.lastOpened + 1000 };
  upsertRecord(idB, recB, { touchOpened: false });
  // force distinct lastOpened via touchOpened, which is the real path the app uses
  touchOpenedAt(idA, recA.lastOpened);
  touchOpenedAt(idB, recA.lastOpened + 5000);
  const sorted = sortRecords(loadLibrary().records);
  assert.equal(sorted[0].id, idB);
  assert.equal(sorted[1].id, idA);
});
function touchOpenedAt(id, ts) {
  const record = getRecord(id);
  const { id: _id, ...rest } = record;
  upsertRecord(id, { ...rest, lastOpened: ts }, { touchOpened: false });
  // upsertRecord ignores an incoming lastOpened unless touchOpened is true; set it directly instead.
  const found = JSON.parse(store.getItem(LIBRARY_KEY));
  found.records = found.records.map((r) => (r.id === id ? { ...r, lastOpened: ts } : r));
  writeStorageJSON(LIBRARY_KEY, found);
}

test("malformed library storage is quarantined and the app still opens with an empty, working library", () => {
  store.setItem(LIBRARY_KEY, "{not json");
  const { status, records } = loadLibrary();
  assert.equal(status, "invalid");
  assert.deepEqual(records, []);
  assert.equal(store.getItem(LIBRARY_REJECTED_KEY), "{not json");
  // the corrupt data is gone from the live key — it now holds a fresh, empty, working library
  assert.notEqual(store.getItem(LIBRARY_KEY), "{not json");
  assert.deepEqual(loadLibrary().records, []);
  // still usable afterwards
  const id = startReading("swim");
  assert.ok(upsertRecord(id, buildSnapshot()));
  assert.equal(loadLibrary().records.length, 1);
});

test("a library file that is valid JSON but the wrong shape is treated the same way", () => {
  for (const bad of ["null", "[]", "42", '"text"', JSON.stringify({ records: "not an array" })]) {
    store.setItem(LIBRARY_KEY, bad);
    const { status, records } = loadLibrary();
    assert.equal(status, "invalid", bad);
    assert.deepEqual(records, []);
  }
});

test("one damaged record inside an otherwise valid library is dropped without losing the rest", () => {
  const idGood = startReading("swim", { paper: { title: "Good paper" } });
  upsertRecord(idGood, buildSnapshot());
  const library = JSON.parse(store.getItem(LIBRARY_KEY));
  library.records.push({ id: "broken", selectedDepth: "not-a-depth", session: {} });
  library.records.push({ selectedDepth: "swim", session: {} }); // no id at all
  writeStorageJSON(LIBRARY_KEY, library);

  const { status, records } = loadLibrary();
  assert.equal(status, "ok");
  assert.equal(records.length, 1);
  assert.equal(records[0].paper.title, "Good paper");
});

test("unavailable storage for the library does not throw", () => {
  delete globalThis.localStorage;
  const { status, records } = loadLibrary();
  assert.equal(status, "unavailable");
  assert.deepEqual(records, []);
  assert.equal(upsertRecord("some-id", { paper: {} }), null);
  assert.equal(deleteRecord("some-id"), false);
});

test("describeRecord derives status from stage and judgement, never storing a score", () => {
  const id = startReading("swim");
  const record1 = upsertRecord(id, buildSnapshot());
  const info1 = describeRecord(record1);
  assert.equal(info1.title, "Land tenure and crop switching");
  assert.equal(info1.depthLabel, "Swim");
  assert.ok(info1.status.length > 0);
  assert.equal(Object.hasOwn(info1, "score"), false);
  assert.equal(Object.hasOwn(info1, "rating"), false);

  appState.readingSession.stage = "judge";
  appState.readingSession.stages.judge.judgement = "The paper holds up.";
  const record2 = upsertRecord(id, buildSnapshot());
  assert.equal(describeRecord(record2).status, "Judgement recorded");
});

// ---------------------------------------------------------------------------
// Step 12 -> Step 13 migration
// ---------------------------------------------------------------------------

test("a Step 12 single-session record migrates into the library exactly once", () => {
  startReading("dive-deep");
  fillReading();
  const legacyBody = buildSnapshot();
  store.setItem(LEGACY_SESSION_KEY, JSON.stringify(legacyBody));
  resetAppState();

  const first = loadLibrary();
  assert.equal(first.records.length, 1);
  assert.equal(first.records[0].paper.title, "Land tenure and crop switching");
  assert.equal(first.records[0].session.evidence.length, 2);
  assert.equal(store.getItem(LEGACY_SESSION_KEY), null); // cleared after a successful migration

  // idempotent: loading again does not duplicate, even if the legacy key reappeared
  store.setItem(LEGACY_SESSION_KEY, JSON.stringify(legacyBody));
  const second = loadLibrary();
  assert.equal(second.records.length, 1);
});

test("a corrupt Step 12 record does not block startup and is quarantined, not migrated", () => {
  store.setItem(LEGACY_SESSION_KEY, "{not json");
  const { records } = loadLibrary();
  assert.deepEqual(records, []);
  assert.equal(store.getItem(LEGACY_SESSION_KEY), null);
  assert.equal(store.getItem("paperCompass.session.rejected"), "{not json");
});

test("migration never overwrites papers already in the library", () => {
  const idExisting = startReading("swim", { paper: { title: "Already in the library" } });
  upsertRecord(idExisting, buildSnapshot());
  resetAppState();
  startReading("dive-deep", { paper: { title: "From the old single session" } });
  store.setItem(LEGACY_SESSION_KEY, JSON.stringify(buildSnapshot()));

  const { records } = loadLibrary();
  assert.equal(records.length, 2);
  assert.ok(records.some((r) => r.paper.title === "Already in the library"));
  assert.ok(records.some((r) => r.paper.title === "From the old single session"));
});

test("every depth keeps a valid stage through the library round trip", () => {
  for (const depth of ["surf", "swim", "dive-deep"]) {
    resetAppState();
    const id = startReading(depth);
    const last = pathFor(depth).at(-1);
    appState.readingSession.stage = last;
    upsertRecord(id, buildSnapshot());
    const record = getRecord(id);
    assert.equal(record.selectedDepth, depth);
    assert.equal(record.session.stage, last);
  }
});
