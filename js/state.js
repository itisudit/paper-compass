// Application state. In memory only, until persistent storage is introduced.
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
    evidence: [],     // [{id, annotationId, text, pageNumber, connections}]
  };
}

function createAppState() {
  return {
    paper: { title: "", authors: "", journal: "", year: "", doi: "", volume: "", issue: "", pages: "", pdf: null, pdfName: "" },
    readingIntention: "",
    initialInterpretation: "",
    selectedDepth: null,
    decision: null,
    readingSession: createReadingSession(),
  };
}

export const appState = createAppState();

export function resetAppState() {
  Object.assign(appState, createAppState());
}

export function readingInProgress() {
  return appState.selectedDepth !== null;
}
