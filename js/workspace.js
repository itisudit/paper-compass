// The reading workspace shell: header, progress, navigation between stages, and the stuck panel.
//
// The shell knows the stage contract, not stage internals. A stage module exports:
//   id                 unique stage id, also the key of its slice in appState.readingSession.stages
//   entryLabel         text of the Continue button that leads into this stage
//   activity(depth)    short activity name shown in the header for a given depth
//   initialState()     the shape of the stage's own state
//   mount(panel, ctx)  build markup and bind events, once
//   render(ctx)        show the stage for ctx.depth from ctx.state
//   save(ctx)          copy what the reader has written into ctx.state
//   latestNote(state)  the reader's most recent note from this stage, or ""
// ctx gives a stage: depth, state (its own slice), app (paper and triage answers), focusPaper(),
// latestNote() (the reader's latest earlier note), and changeDepth(depth).
import { appState, stageModules } from "./state.js";
import { depthLabel, firstNewStage, pathFor } from "./depths.js";
import { initStuck } from "./stuck.js";
// Step 11: evidence-in-stage integration
import { mountStageEvidence, renderStageEvidence, registerNavigationCallback } from "./stage-evidence.js";

const stagePanels = document.querySelector("#stage-panels");
const previousButton = document.querySelector('[data-action="previous-stage"]');
const continueButton = document.querySelector('[data-action="continue-stage"]');
const panels = {};
let stuck = null;

function currentModule() {
  return stageModules[appState.readingSession.stage];
}

function latestNote() {
  const path = pathFor(appState.selectedDepth);
  for (let index = path.indexOf(appState.readingSession.stage) - 1; index >= 0; index -= 1) {
    const stage = stageModules[path[index]];
    const note = stage.latestNote?.(appState.readingSession.stages[stage.id])?.trim();
    if (note) return note;
  }
  return "";
}

function contextFor(stage) {
  return {
    get depth() { return appState.selectedDepth; },
    get state() { return appState.readingSession.stages[stage.id]; },
    get app() { return appState; },
    focusPaper: () => document.querySelector("#pdf-pages").focus({ preventScroll: true }),
    latestNote,
    changeDepth,
  };
}

function paperMetadata() {
  const { paper } = appState;
  const publication = [paper.journal, paper.year].filter(Boolean).join(" · ");
  const location = [paper.volume && `Vol. ${paper.volume}`, paper.issue && `No. ${paper.issue}`, paper.pages].filter(Boolean).join(", ");
  return [paper.authors, publication, location].filter(Boolean).join(" · ") || "Details to be added";
}

function saveCurrentStage() {
  currentModule().save(contextFor(currentModule()));
}

function renderProgress(path, stageId) {
  const index = path.indexOf(stageId);
  const steps = path.map((id, position) => {
    const item = document.createElement("li");
    item.className = "progress-step";
    if (position < index) item.classList.add("is-done");
    if (position === index) {
      item.classList.add("is-current");
      item.setAttribute("aria-current", "step");
    }
    const label = document.createElement("span");
    label.className = "screen-reader-status";
    label.textContent = `Step ${position + 1} of ${path.length}`;
    item.append(label);
    return item;
  });
  document.querySelector("#progress-steps").replaceChildren(...steps);
}

function render() {
  const { selectedDepth: depth, readingSession: session } = appState;
  const path = pathFor(depth);
  if (!path.includes(session.stage)) session.stage = path[0];
  const stage = currentModule();
  const index = path.indexOf(stage.id);

  document.querySelector("#selected-depth").textContent = depthLabel(depth);
  document.querySelector("#paper-workspace-title").textContent = appState.paper.title;
  document.querySelector("#paper-metadata").textContent = paperMetadata();
  const intention = document.querySelector("#paper-intention");
  intention.hidden = !appState.readingIntention;
  intention.textContent = appState.readingIntention ? `Reading for: ${appState.readingIntention}` : "";
  intention.title = appState.readingIntention;
  document.querySelector("#reading-activity").textContent = stage.activity(depth);
  renderProgress(path, stage.id);

  Object.entries(panels).forEach(([id, panel]) => { panel.hidden = id !== stage.id; });
  stage.render(contextFor(stage));

  // Step 11: update the evidence area for the stage that just became visible
  renderStageEvidence(stage.id, depth);

  previousButton.hidden = index === 0;
  continueButton.hidden = index === path.length - 1;
  if (!continueButton.hidden) {
    const next = stageModules[path[index + 1]];
    continueButton.innerHTML = `${next.entryLabel || "Continue"} <span aria-hidden="true">→</span>`;
  }
}

function focusStageTitle() {
  panels[appState.readingSession.stage].querySelector("[data-stage-title]").focus();
}

function goToStage(stageId) {
  appState.readingSession.stage = stageId;
  stuck.close({ returnFocus: false });
  render();
  focusStageTitle();
}

function moveStage(direction) {
  saveCurrentStage();
  const path = pathFor(appState.selectedDepth);
  const next = path[path.indexOf(appState.readingSession.stage) + direction];
  if (next) goToStage(next);
}

// Moving to a deeper route keeps every note and picks up at the first stage the lighter route skipped.
function changeDepth(newDepth) {
  saveCurrentStage();
  const earlier = appState.selectedDepth;
  appState.selectedDepth = newDepth;
  appState.decision = newDepth;
  goToStage(firstNewStage(earlier, newDepth));
}

export function initWorkspace() {
  Object.values(stageModules).forEach((stage) => {
    const panel = document.createElement("div");
    panel.className = "stage-panel";
    panel.dataset.stage = stage.id;
    panel.hidden = true;
    stagePanels.append(panel);
    panels[stage.id] = panel;
    stage.mount(panel, contextFor(stage));
    // Step 11: append evidence slot to qualifying stage panels after stage markup is built
    mountStageEvidence(panel, stage.id);
  });
  stuck = initStuck({ getSession: () => appState.readingSession });
  continueButton.addEventListener("click", () => moveStage(1));
  previousButton.addEventListener("click", () => moveStage(-1));
  // Keep state current as the reader types, so nothing depends on a save call being remembered.
  stagePanels.addEventListener("input", saveCurrentStage);
  return { render, saveCurrentStage, focusStageTitle };
}

// Step 11: app.js calls this once pdfViewer is available, so workspace doesn't
// need to import pdfViewer directly (keeping the dependency direction clean).
export function registerPdfNavigation(fn) {
  registerNavigationCallback(fn);
}
