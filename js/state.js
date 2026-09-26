// Application state. Lives in memory; persistence.js saves and restores it (Step 12).
// Each stage defines the shape of its own slice; this file only assembles them.
import orient from "./stages/orient.js";
import place from "./stages/place.js";
import reconstruct from "./stages/reconstruct.js";
import appraise from "./stages/appraise.js";
import test from "./stages/test.js";
import connect from "./stages/connect.js";
import judge from "./stages/judge.js";

export const stageModules = Object.fromEntries([orient, place, reconstruct, appraise, test, connect, judge].map((stage) => [stage.id, stage]));

export function createReadingSession() {
  return {
    stage: "orient",
    stuck: [],
    stages: Object.fromEntries(Object.values(stageModules).map((stage) => [stage.id, stage.initialState()])),
    // Step 10: annotation and evidence state, centralised in the reading session.
    annotations: [],  // [{id, pageNumber, type, color, text, rects}]
    evidence: [],     // [{id, annotationId, text, pageNumber, connections, usedInStages}]
    // Step 12: where the reader was in the PDF, as a page and a fraction of that page.
    view: { page: 1, fraction: 0 },
  };
}

function createAppState() {
  return {
    paper: { title: "", authors: "", journal: "", year: "", doi: "", volume: "", issue: "", pages: "", pdf: null, pdfName: "", pdfSize: 0, pdfHash: "" },
    readingIntention: "",
    initialInterpretation: "",
    selectedDepth: null,
    decision: null,
    readingSession: createReadingSession(),
    // Step 13: the id of the library record this reading is saved as, or null before one exists yet
    // (opening screen, paper entry, triage, Shore). Set the moment a reading begins — see enterWorkspace
    // and openRecord in app.js — and the one thing that ties an in-memory reading back to its record.
    recordId: null,
  };
}

export const appState = createAppState();

export function resetAppState() {
  Object.assign(appState, createAppState());
}

export function readingInProgress() {
  return appState.selectedDepth !== null;
}
