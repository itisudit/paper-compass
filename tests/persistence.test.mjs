// Step 12 checks for persistence.js and its integration with the state and annotation stores.
// Run with `npm test` (Node 20 or later). No dependencies, no browser: localStorage is a small stub.
import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { appState, resetAppState, createReadingSession } from "../js/state.js";
import { pathFor } from "../js/depths.js";
import {
  STORAGE_KEY, REJECTED_KEY, SCHEMA_VERSION, buildSnapshot, clearSnapshot, configurePersistence, flushSave,
  loadSnapshot, pdfMatches, persistenceHealthy, requestSave, restoreSnapshot,
} from "../js/persistence.js";
import {
  addAnnotation, addEvidence, connectEvidence, getAllEvidence, getAnnotationsForPage, getEvidenceForStage,
  markEvidenceUsed, onAnnotationStateChange, removeAnnotation,
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
  store = new FakeStorage();
  globalThis.localStorage = store;
  configurePersistence();
  onAnnotationStateChange(null);
  startReading();
  flushSave(); // one successful write resets the module's health flag between tests
  resetAppState();
  clearSnapshot();
  store.writes = 0;
});

function startReading(depth = "dive-deep") {
  appState.paper = { title: "Land tenure and crop switching", authors: "A. Author", journal: "J. Ag Econ", year: "2024", doi: "10.1000/x", volume: "12", issue: "3", pages: "100-120", pdf: { fake: "file" }, pdfName: "paper.pdf", pdfSize: 1234, pdfHash: "abc123" };
  appState.readingIntention = "Check the tenure result";
  appState.initialInterpretation = "I suspect selection";
  appState.selectedDepth = depth;
  appState.decision = depth;
  appState.readingSession = createReadingSession();
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
  const b = addAnnotation({ pageNumber: 2, type: "underline", color: null, text: "another", rects: [{ x: 0.1, y: 0.5, w: 0.2, h: 0.02 }] });
  const ev = addEvidence({ annotationId: a.id, text: "a passage", pageNumber: 4 });
  connectEvidence(ev.id, "appraise");
  connectEvidence(ev.id, "judge");
  markEvidenceUsed(ev.id, "appraise");
  addEvidence({ annotationId: null, text: "loose evidence", pageNumber: 1 });
  return { a, b, ev };
}

function freshTab() { // what a browser refresh does: memory is gone, storage stays
  resetAppState();
  onAnnotationStateChange(null);
}

test("a session round trips through storage with every listed part intact", () => {
  startReading();
  const { a, ev } = fillReading();
  assert.equal(flushSave(), true);
  const before = JSON.parse(JSON.stringify(buildSnapshot()));

  freshTab();
  const { status, snapshot } = loadSnapshot();
  assert.equal(status, "ok");
  restoreSnapshot(snapshot);

  assert.equal(appState.paper.title, "Land tenure and crop switching");
  assert.equal(appState.paper.pdf, null);
  assert.equal(appState.paper.pdfName, "paper.pdf");
  assert.equal(appState.selectedDepth, "dive-deep");
  assert.equal(appState.decision, "dive-deep");
  assert.equal(appState.readingIntention, "Check the tenure result");
  assert.equal(appState.initialInterpretation, "I suspect selection");
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
  assert.equal(getEvidenceForStage("judge").length, 1);

  const after = JSON.parse(JSON.stringify(buildSnapshot()));
  after.savedAt = before.savedAt;
  assert.deepEqual(after, before);
});

test("the PDF file and other non-serialisable state never reach storage", () => {
  startReading();
  fillReading();
  flushSave();
  const raw = store.getItem(STORAGE_KEY);
  assert.equal(raw.includes("fake"), false);
  assert.equal(Object.hasOwn(JSON.parse(raw).paper, "pdf"), false);
  assert.equal(JSON.parse(raw).version, SCHEMA_VERSION);
});

test("repeated resume does not duplicate annotations or evidence", () => {
  startReading();
  fillReading();
  flushSave();
  for (let i = 0; i < 4; i += 1) {
    freshTab();
    restoreSnapshot(loadSnapshot().snapshot);
    flushSave();
  }
  assert.equal(appState.readingSession.annotations.length, 2);
  assert.equal(getAllEvidence().length, 2);
});

test("a new paper starts with clean arrays and cannot see the old annotations", () => {
  startReading();
  fillReading();
  resetAppState();
  assert.deepEqual(appState.readingSession.annotations, []);
  assert.deepEqual(appState.readingSession.evidence, []);
  assert.deepEqual(getAllEvidence(), []);
  addAnnotation({ pageNumber: 1, type: "highlight", color: "yellow", text: "x", rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }] });
  assert.equal(appState.readingSession.annotations.length, 1);
});

test("every depth keeps a valid stage after a round trip", () => {
  for (const depth of ["surf", "swim", "dive-deep"]) {
    resetAppState();
    startReading(depth);
    const last = pathFor(depth).at(-1);
    appState.readingSession.stage = last;
    flushSave();
    freshTab();
    restoreSnapshot(loadSnapshot().snapshot);
    assert.equal(appState.selectedDepth, depth);
    assert.equal(appState.readingSession.stage, last);
    assert.deepEqual(Object.keys(appState.readingSession.stages).sort(), ["appraise", "connect", "judge", "orient", "place", "reconstruct", "test"]);
  }
});

test("nothing is written unless a reading is in progress", () => {
  store.setItem(STORAGE_KEY, "sentinel");
  store.writes = 0;
  assert.equal(flushSave(), false);
  requestSave();
  assert.equal(store.writes, 0);
  assert.equal(store.getItem(STORAGE_KEY), "sentinel");
});

test("malformed JSON is set aside and reported, never thrown", () => {
  store.setItem(STORAGE_KEY, "{not json");
  const result = loadSnapshot();
  assert.equal(result.status, "invalid");
  assert.equal(result.snapshot, null);
  assert.equal(store.getItem(STORAGE_KEY), null);
  assert.equal(store.getItem(REJECTED_KEY), "{not json");
});

test("wrong shapes, unknown depths, older and newer versions are all rejected safely", () => {
  const bad = [
    "null", "[]", "42", '"text"', "{}",
    JSON.stringify({ version: SCHEMA_VERSION, selectedDepth: "paddle", session: {} }),
    JSON.stringify({ version: SCHEMA_VERSION, selectedDepth: "constructor", session: {} }),
    JSON.stringify({ version: 0, selectedDepth: "swim" }),
    JSON.stringify({ selectedDepth: "swim" }),
    JSON.stringify({ version: SCHEMA_VERSION + 1, selectedDepth: "swim" }),
  ];
  for (const raw of bad) {
    store.setItem(STORAGE_KEY, raw);
    assert.equal(loadSnapshot().status, "invalid", raw);
  }
});

test("damaged parts are repaired or dropped without losing the rest", () => {
  startReading("swim");
  const { a } = fillReading();
  flushSave();
  const saved = JSON.parse(store.getItem(STORAGE_KEY));
  saved.session.stage = "connect"; // not on the Swim path
  saved.session.stages.reconstruct.hintLevel = "lots";
  saved.session.stages.judge = "nonsense";
  saved.session.annotations.push({ id: "bad1", pageNumber: 0, type: "highlight", rects: [] });
  saved.session.annotations.push({ ...saved.session.annotations[0] }); // duplicate id
  saved.session.evidence[0].annotationId = "gone";
  saved.session.evidence[0].connections = ["appraise", "appraise", "not-a-stage"];
  saved.session.evidence.push({ id: "e-bad", text: "", pageNumber: 1 });
  saved.session.view = { page: -3, fraction: 99 };
  store.setItem(STORAGE_KEY, JSON.stringify(saved));

  const { status, snapshot } = loadSnapshot();
  assert.equal(status, "ok");
  assert.equal(snapshot.session.stage, "orient");
  assert.equal(snapshot.session.stages.reconstruct.hintLevel, 0);
  assert.equal(snapshot.session.stages.reconstruct.revision, "Revised sketch");
  assert.equal(snapshot.session.stages.judge.judgement, "");
  assert.equal(snapshot.session.annotations.length, 2);
  assert.ok(snapshot.session.annotations.some((x) => x.id === a.id));
  assert.equal(snapshot.session.evidence.length, 2);
  assert.equal(snapshot.session.evidence[0].annotationId, null);
  assert.deepEqual(snapshot.session.evidence[0].connections, ["appraise"]);
  assert.deepEqual(snapshot.session.view, { page: 1, fraction: 1 });
});

test("unavailable storage does not throw and is reported", () => {
  const statuses = [];
  configurePersistence({ onStatusChange: (ok) => statuses.push(ok) });
  delete globalThis.localStorage;
  assert.equal(loadSnapshot().status, "unavailable");
  startReading();
  assert.equal(flushSave(), false);
  assert.equal(persistenceHealthy(), false);
  assert.deepEqual(statuses, [false]);
  clearSnapshot(); // must not throw either
  quarantineSafe();
});

function quarantineSafe() {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new DOMException("blocked", "SecurityError"); } });
  assert.equal(loadSnapshot().status, "unavailable");
  assert.equal(flushSave(), false);
  delete globalThis.localStorage;
}

test("a quota error fails soft and recovers on the next successful write", () => {
  const statuses = [];
  configurePersistence({ onStatusChange: (ok) => statuses.push(ok) });
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
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    startReading();
    for (let i = 0; i < 20; i += 1) { requestSave(); mock.timers.tick(100); }
    // 2 s of typing at 100 ms intervals: the debounce keeps deferring, but the 4 s cap has not been hit yet.
    assert.equal(store.writes, 0);
    mock.timers.tick(500);
    assert.equal(store.writes, 1);

    for (let i = 0; i < 100; i += 1) { requestSave(); mock.timers.tick(100); }
    // 10 s of continuous events must still have produced writes on the way.
    assert.ok(store.writes >= 3, `writes: ${store.writes}`);
  } finally {
    mock.timers.reset();
  }
});

test("clearing cancels a pending save so a discarded reading cannot come back", () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    startReading();
    requestSave();
    clearSnapshot();
    mock.timers.tick(5000);
    assert.equal(store.getItem(STORAGE_KEY), null);
  } finally {
    mock.timers.reset();
  }
});

test("annotation and evidence edits notify the persistence hook, including 'Use this'", () => {
  startReading();
  let calls = 0;
  onAnnotationStateChange(() => { calls += 1; });
  const a = addAnnotation({ pageNumber: 1, type: "highlight", color: "blue", text: "t", rects: [{ x: 0, y: 0, w: 1, h: 1 }] });
  const ev = addEvidence({ annotationId: a.id, text: "t", pageNumber: 1 });
  connectEvidence(ev.id, "test");
  markEvidenceUsed(ev.id, "test");
  removeAnnotation(a.id);
  assert.equal(calls, 5);
  removeAnnotation("missing");
  assert.equal(calls, 5);
});

test("pdfMatches prefers the content hash and falls back to name and size", () => {
  const paper = { pdfName: "p.pdf", pdfSize: 10, pdfHash: "h1" };
  assert.equal(pdfMatches(paper, { name: "renamed.pdf", size: 10 }, "h1"), true);
  assert.equal(pdfMatches(paper, { name: "p.pdf", size: 10 }, "h2"), false);
  assert.equal(pdfMatches({ ...paper, pdfHash: "" }, { name: "p.pdf", size: 10 }, ""), true);
  assert.equal(pdfMatches({ ...paper, pdfHash: "" }, { name: "p.pdf", size: 11 }, ""), false);
});
