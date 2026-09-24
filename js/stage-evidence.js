// stage-evidence.js
// Renders evidence connected to the current stage directly inside the stage panel,
// below the stage's own content. Handles clicking to navigate the PDF and marking
// evidence as being used for the current thinking task.
//
// Called by workspace.js after stage.render(). Stage modules themselves are not modified.
//
// Evidence is sourced from the reading session via annotations.js. Only the
// connections[] array determines what appears here; usedInStages[] tracks which
// items the reader has marked as active for their current thinking.
//
// Stages that show evidence: reconstruct, appraise, test, connect, judge.
// Orient and place are excluded — they are orientation stages where evidence
// gathering has not yet happened in the workflow.

import { getAllEvidence, markEvidenceUsed, unmarkEvidenceUsed } from "./annotations.js";

// Stages that receive the evidence panel.
const EVIDENCE_STAGES = new Set(["reconstruct", "appraise", "test", "connect", "judge"]);

// Human-readable labels for connected-stage chips shown on "other" evidence.
const STAGE_LABELS = {
  orient:      "Orient",
  place:       "Place",
  reconstruct: "Reconstruct",
  appraise:    "Appraise",
  test:        "Test",
  connect:     "Connect",
  judge:       "Judge",
};

// One container per stage panel, created once in mount(), updated every render().
// Map from stageId → { container, currentSection, otherSection }
const containers = new Map();

// Registered navigation callback: (pageNumber) → void
let _navigateFn = null;

export function registerNavigationCallback(fn) {
  _navigateFn = fn;
}

// Called once per stage panel when workspace mounts each stage.
// Appends a dedicated evidence container to the panel, below stage content.
// Returns the container element so workspace.js can store it if needed.
export function mountStageEvidence(panel, stageId) {
  if (!EVIDENCE_STAGES.has(stageId)) return null;

  const container = document.createElement("div");
  container.className = "stage-evidence";
  container.dataset.stageEvidence = stageId;
  // Start hidden; renderStageEvidence shows/hides based on content.
  container.hidden = true;
  panel.append(container);

  const currentSection = document.createElement("div");
  currentSection.className = "stage-evidence-current";

  const otherSection = document.createElement("div");
  otherSection.className = "stage-evidence-other";

  container.append(currentSection, otherSection);
  containers.set(stageId, { container, currentSection, otherSection });
  return container;
}

// Called by workspace.js on every render() after stage.render().
// stageId: the currently active stage.
// depth: current reading depth (used to restrict stage list in "other").
export function renderStageEvidence(stageId, depth) {
  if (!EVIDENCE_STAGES.has(stageId)) return;
  const slot = containers.get(stageId);
  if (!slot) return;

  const all = getAllEvidence();
  const current = all.filter(ev => ev.connections.includes(stageId));
  const other   = all.filter(ev => !ev.connections.includes(stageId) && ev.text);

  const hasContent = current.length > 0 || other.length > 0;
  slot.container.hidden = !hasContent;

  renderCurrentEvidence(slot.currentSection, current, stageId);
  renderOtherEvidence(slot.otherSection, other, stageId, depth);
}

// ---- Current-stage evidence ----

function renderCurrentEvidence(section, items, stageId) {
  section.innerHTML = "";
  if (!items.length) return;

  const heading = document.createElement("h3");
  heading.className = "stage-evidence-heading";
  heading.textContent = "Evidence";
  section.append(heading);

  items.forEach(ev => {
    section.append(buildEvidenceCard(ev, stageId, true));
  });
}

// ---- Other evidence ----

function renderOtherEvidence(section, items, stageId, depth) {
  section.innerHTML = "";
  if (!items.length) return;

  const details = document.createElement("details");
  details.className = "stage-evidence-other-details";

  const summary = document.createElement("summary");
  summary.className = "stage-evidence-other-summary";
  summary.textContent = `Other saved evidence (${items.length})`;
  details.append(summary);

  const list = document.createElement("div");
  list.className = "stage-evidence-other-list";
  items.forEach(ev => {
    list.append(buildEvidenceCard(ev, stageId, false));
  });
  details.append(list);
  section.append(details);
}

// ---- Card builder ----

function buildEvidenceCard(ev, currentStageId, isCurrent) {
  const card = document.createElement("div");
  card.className = "evidence-card";
  card.dataset.evidenceId = ev.id;
  if (isCurrent && ev.usedInStages?.includes(currentStageId)) {
    card.classList.add("is-used");
  }

  // Passage quote
  const quote = document.createElement("blockquote");
  quote.className = "evidence-quote";
  const maxLen = 180;
  quote.textContent = ev.text.length > maxLen ? ev.text.slice(0, maxLen) + "…" : ev.text;

  // Meta: page number + connected stages (only show connected stages on "other" cards)
  const meta = document.createElement("p");
  meta.className = "evidence-meta";

  const pagePart = `p. ${ev.pageNumber}`;

  if (!isCurrent && ev.connections.length) {
    const connNames = ev.connections.map(id => STAGE_LABELS[id] || id).join(", ");
    meta.textContent = `${pagePart} · ${connNames}`;
  } else {
    meta.textContent = pagePart;
  }

  // Actions row
  const actions = document.createElement("div");
  actions.className = "evidence-actions";

  // Go to page button
  const goBtn = document.createElement("button");
  goBtn.type = "button";
  goBtn.className = "evidence-go";
  goBtn.textContent = `Go to page ${ev.pageNumber}`;
  goBtn.setAttribute("aria-label", `Go to page ${ev.pageNumber} in the PDF`);
  goBtn.addEventListener("click", () => {
    if (_navigateFn) _navigateFn(ev.pageNumber);
  });

  actions.append(goBtn);

  // "Use this" toggle — only on current-stage evidence
  if (isCurrent) {
    const used = ev.usedInStages?.includes(currentStageId);
    const useBtn = document.createElement("button");
    useBtn.type = "button";
    useBtn.className = `evidence-use${used ? " is-active" : ""}`;
    useBtn.textContent = used ? "In use" : "Use this";
    useBtn.setAttribute("aria-pressed", used ? "true" : "false");
    useBtn.setAttribute("aria-label", used
      ? `Mark evidence as not in use for this stage`
      : `Mark evidence as in use for this stage`);
    useBtn.addEventListener("click", () => {
      if (used) {
        unmarkEvidenceUsed(ev.id, currentStageId);
      } else {
        markEvidenceUsed(ev.id, currentStageId);
      }
      // Re-render this stage's evidence in place without touching stage content or state
      renderStageEvidence(currentStageId, null);
    });
    actions.append(useBtn);
  }

  card.append(quote, meta, actions);
  return card;
}
