// Application wiring: opening, paper entry, triage, and moving into the reading workspace.
// Stage behaviour lives in js/stages/, and the workspace shell lives in workspace.js.
// Step 10 adds: SelectionMenu, annotation callbacks, evidence panel wiring.
import { PdfViewer } from "./pdf-viewer.js";
import { extractPdfMetadata } from "./metadata-extractor.js";
import { appState, createReadingSession, readingInProgress, resetAppState } from "./state.js";
import { depthLabel } from "./depths.js";
import { initWorkspace } from "./workspace.js";
import { setSession, addAnnotation, removeAnnotation, addEvidence } from "./annotations.js";
import { SelectionMenu } from "./selection-menu.js";
import { initEvidencePanel, renderEvidencePanel } from "./evidence-panel.js";

const screens = document.querySelectorAll("[data-screen]");
const status = document.querySelector("#screen-status");
const paperForm = document.querySelector("#paper-form");
const triageForm = document.querySelector("#triage-form");
const pdfInput = document.querySelector("#paper-pdf");
const extractionStatus = document.querySelector("#metadata-extraction-status");
const startButton = document.querySelector('[data-action="start"]');
const resumeButton = document.querySelector('[data-action="resume"]');
const pdfViewer = new PdfViewer(document.querySelector(".pdf-viewer"));
const workspace = initWorkspace();
const extractionPrompt = extractionStatus.textContent;

// Evidence panel container lives in the thinking pane
const evidencePanelContainer = document.querySelector("#evidence-panel");

// ---- Selection menu setup ----

const selectionMenu = new SelectionMenu({
  onHighlight: ({ range, text, color }) => {
    const pageNumber = pdfViewer._pageNumberForNode(range.startContainer);
    const rects = computeRects(range, pageNumber);
    if (!rects) return;
    const ann = addAnnotation({ pageNumber, type: "highlight", color, text, rects });
    pdfViewer.refreshAnnotations(pageNumber);
    renderEvidencePanel();
  },
  onUnderline: ({ range, text }) => {
    const pageNumber = pdfViewer._pageNumberForNode(range.startContainer);
    const rects = computeRects(range, pageNumber);
    if (!rects) return;
    addAnnotation({ pageNumber, type: "underline", color: null, text, rects });
    pdfViewer.refreshAnnotations(pageNumber);
    renderEvidencePanel();
  },
  onEvidence: ({ range, text }) => {
    const pageNumber = pdfViewer._pageNumberForNode(range.startContainer);
    // Create evidence without requiring a highlight/underline
    addEvidence({ annotationId: null, text, pageNumber });
    renderEvidencePanel();
  },
});

// Convert a selection range to fractional rects relative to the canvas display dimensions.
function computeRects(range, pageNumber) {
  const wrapper = pdfViewer.wrapperForPage(pageNumber);
  if (!wrapper) return null;
  const canvas = wrapper.querySelector(".pdf-page");
  if (!canvas) return null;
  const canvasBounds = canvas.getBoundingClientRect();
  if (!canvasBounds.width || !canvasBounds.height) return null;

  const clientRects = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 1);
  const rects = [];
  const SLACK = 12;
  for (const cr of clientRects) {
    if (
      cr.right < canvasBounds.left - SLACK ||
      cr.left > canvasBounds.right + SLACK ||
      cr.bottom < canvasBounds.top - SLACK ||
      cr.top > canvasBounds.bottom + SLACK
    ) continue;
    // Store as fraction of the canvas display dimensions (independent of devicePixelRatio)
    const lx = cr.left - canvasBounds.left;
    const ly = cr.top - canvasBounds.top;
    rects.push({
      x: lx / canvasBounds.width,
      y: ly / canvasBounds.height,
      w: cr.width / canvasBounds.width,
      h: cr.height / canvasBounds.height,
    });
  }
  return rects.length ? rects : null;
}

// Wire up the viewer's selection hook to show the menu
pdfViewer.onSelectionChange = (range, text, pageNumber) => {
  if (!text) return;
  selectionMenu.show(range, text);
};

// Wire up annotation remove callback
pdfViewer.onAnnotationRemove = (annotationId, pageNumber) => {
  removeAnnotation(annotationId);
  pdfViewer.refreshAnnotations(pageNumber);
  renderEvidencePanel();
};

// ---- Screen management ----

function showScreen(screenName, announcement) {
  screens.forEach((screen) => { screen.hidden = screen.dataset.screen !== screenName; });
  status.textContent = announcement;
}

function showOpening(announcement) {
  const inProgress = readingInProgress();
  resumeButton.hidden = !inProgress;
  startButton.textContent = inProgress ? "Start a different paper" : "Begin with a paper";
  startButton.classList.toggle("button-primary", !inProgress);
  startButton.classList.toggle("button-quiet", inProgress);
  resumeButton.classList.toggle("button-primary", inProgress);
  resumeButton.classList.toggle("button-quiet", !inProgress);
  resumeButton.classList.toggle("is-first", inProgress);
  showScreen("opening", announcement);
}

function populatePaperForm() {
  ["title", "authors", "journal", "year", "doi", "volume", "issue", "pages"].forEach((key) => {
    paperForm.elements.namedItem(key).value = appState.paper[key] || "";
  });
}

function savePaper() {
  const data = new FormData(paperForm);
  const pdf = paperForm.elements.pdf.files[0] || null;
  appState.paper = {
    title: data.get("title").trim(), authors: data.get("authors").trim(),
    journal: data.get("journal").trim(), year: data.get("year").trim(), doi: data.get("doi").trim(),
    volume: data.get("volume").trim(), issue: data.get("issue").trim(), pages: data.get("pages").trim(),
    pdf, pdfName: pdf?.name || "",
  };
}

function saveTriageResponses() {
  appState.readingIntention = triageForm.elements.intention.value.trim();
  appState.initialInterpretation = triageForm.elements.interpretation.value.trim();
}

function clearForNewPaper() {
  resetAppState();
  paperForm.reset();
  triageForm.reset();
  extractionStatus.textContent = extractionPrompt;
  pdfViewer.load(null);
  // Rebind annotation session state to the fresh session
  setSession(appState.readingSession);
  renderEvidencePanel();
}

function startNewPaper() {
  if (readingInProgress()) {
    if (!window.confirm("Starting a different paper will replace your current reading. Continue?")) return;
    clearForNewPaper();
  }
  showScreen("paper-entry", "Add a paper.");
  pdfInput.focus();
}

function enterWorkspace(depth) {
  appState.decision = depth;
  appState.selectedDepth = depth;
  appState.readingSession = createReadingSession();
  // Bind annotation module to the new session
  setSession(appState.readingSession);
  workspace.render();
  showScreen("workspace", `${depthLabel(depth)} reading is ready.`);
  pdfViewer.load(appState.paper.pdf);
  workspace.focusStageTitle();
  // Initialise evidence panel now that the depth/path is known
  initEvidencePanel(evidencePanelContainer, { onChanged: () => {} });
}

function showShoreConfirmation() {
  appState.decision = "shore";
  appState.selectedDepth = null;
  appState.readingSession = createReadingSession();
  document.querySelector("#confirmation-choice").textContent = "This paper is ashore for later.";
  document.querySelector("#confirmation-detail").textContent = "You have made room to return when the question or timing is right.";
  showScreen("confirmation", "This paper is ashore for later.");
  document.querySelector("#confirmation-title").focus();
}

async function readPdfDetails(file) {
  extractionStatus.textContent = "Reading the first two pages for details.";
  try {
    const { fields, hasText, uncertainFields } = await extractPdfMetadata(file);
    if (pdfInput.files[0] !== file) return;
    if (!hasText) {
      extractionStatus.textContent = "No extractable text was found in the first two pages. You can enter details manually.";
      return;
    }
    const updated = Object.entries(fields).filter(([key, value]) => {
      const field = paperForm.elements.namedItem(key);
      if (!value || field.value.trim()) return false;
      field.value = value;
      return true;
    }).map(([key]) => key);
    let message = updated.length
      ? `Details were read from the PDF. Please review the ${updated.join(", ")} field${updated.length === 1 ? "" : "s"}.`
      : "The first two pages were read, but no blank fields had clear details to add. Please review the form.";
    const stillUncertain = (uncertainFields || []).filter((key) => !paperForm.elements.namedItem(key)?.value.trim());
    if (stillUncertain.length) {
      message += ` The ${stillUncertain.join(", ")} field${stillUncertain.length === 1 ? "" : "s"} could not be read with confidence and ${stillUncertain.length === 1 ? "was" : "were"} left blank for manual entry.`;
    }
    extractionStatus.textContent = message;
  } catch (error) {
    if (pdfInput.files[0] !== file) return;
    extractionStatus.textContent = "These PDF details could not be read. You can enter them manually.";
    console.error("Paper Compass metadata extraction error:", error);
  }
}

// ---- Event bindings ----

pdfInput.addEventListener("change", () => {
  const file = pdfInput.files[0];
  if (file) readPdfDetails(file);
  else extractionStatus.textContent = extractionPrompt;
});

startButton.addEventListener("click", startNewPaper);
resumeButton.addEventListener("click", () => {
  workspace.render();
  showScreen("workspace", "Reading resumed.");
  pdfViewer.refit();
  workspace.focusStageTitle();
  // Re-bind session (annotations survive leave/return)
  setSession(appState.readingSession);
  renderEvidencePanel();
});
document.querySelector('[data-action="back-to-opening"]').addEventListener("click", () => showOpening("Paper Compass opening screen."));
document.querySelector('[data-action="back-to-paper"]').addEventListener("click", () => { saveTriageResponses(); populatePaperForm(); showScreen("paper-entry", "Paper details."); });
document.querySelector('[data-action="review-triage"]').addEventListener("click", () => { showScreen("triage", "Review your triage."); document.querySelector("#reading-intention").focus(); });
document.querySelector('[data-action="return-to-start"]').addEventListener("click", () => { clearForNewPaper(); showOpening("Paper Compass opening screen."); });

paperForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!paperForm.reportValidity()) return;
  savePaper();
  showScreen("triage", "Take a moment with this paper and choose how you want to read it.");
  document.querySelector("#reading-intention").focus();
});
document.querySelectorAll("[data-depth]").forEach((button) => {
  button.addEventListener("click", () => { saveTriageResponses(); enterWorkspace(button.dataset.depth); });
});
document.querySelector('[data-action="shore"]').addEventListener("click", () => { saveTriageResponses(); showShoreConfirmation(); });
document.querySelector('[data-action="leave-workspace"]').addEventListener("click", () => {
  workspace.saveCurrentStage();
  showOpening("Reading paused. Your notes remain available in this session.");
  resumeButton.focus();
});

window.addEventListener("beforeunload", (event) => {
  if (!readingInProgress()) return;
  event.preventDefault();
  event.returnValue = "";
});

// Initialise annotation session binding on startup
setSession(appState.readingSession);
