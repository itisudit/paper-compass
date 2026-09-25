// Application wiring: opening, paper entry, triage, and moving into the reading workspace.
// Stage behaviour lives in js/stages/, the workspace shell lives in workspace.js, and saving and
// restoring a reading (Step 12) lives in persistence.js. This file only decides when to call it.
import { PdfViewer } from "./pdf-viewer.js";
import { extractPdfMetadata } from "./metadata-extractor.js";
import { appState, createReadingSession, readingInProgress, resetAppState } from "./state.js";
import { depthLabel } from "./depths.js";
import { initWorkspace, registerPdfNavigation } from "./workspace.js";
import { addAnnotation, addEvidence, onAnnotationStateChange, removeAnnotation } from "./annotations.js";
import { SelectionMenu } from "./selection-menu.js";
import {
  clearSnapshot, configurePersistence, describeSnapshot, fingerprintFile, flushSave, loadSnapshot,
  pdfMatches, persistenceHealthy, quarantineSnapshot, requestSave, restoreSnapshot,
} from "./persistence.js";

const screens = document.querySelectorAll("[data-screen]");
const status = document.querySelector("#screen-status");
const paperForm = document.querySelector("#paper-form");
const triageForm = document.querySelector("#triage-form");
const pdfInput = document.querySelector("#paper-pdf");
const extractionStatus = document.querySelector("#metadata-extraction-status");
const startButton = document.querySelector('[data-action="start"]');
const resumeButton = document.querySelector('[data-action="resume"]');
const recovery = document.querySelector("#recovery");
const recoveryTitle = document.querySelector("#recovery-title");
const recoveryDetail = document.querySelector("#recovery-detail");
const recoveryNotice = document.querySelector("#recovery-notice");
const saveNotice = document.querySelector("#save-notice");
const reattach = document.querySelector("#pdf-reattach");
const reattachButton = document.querySelector("#pdf-reattach-button");
const reattachInput = document.querySelector("#pdf-reattach-input");
const pdfViewer = new PdfViewer(document.querySelector(".pdf-viewer"));
const workspace = initWorkspace({ onChange: () => requestSave() });
const extractionPrompt = extractionStatus.textContent;

// Step 12: a saved reading found at startup waits here. It is not loaded into appState until the
// reader chooses Resume reading, and it is only deleted when they choose Start fresh.
let pendingSaved = null;
let startupStatus = "none"; // "none" | "ok" | "invalid" | "unavailable"

configurePersistence({
  // Copy live values into state just before each write: the open textarea and the PDF position.
  beforeSave() {
    workspace.saveCurrentStage();
    const anchor = pdfViewer.currentAnchor();
    if (anchor) appState.readingSession.view = anchor;
  },
  onStatusChange(healthy) { saveNotice.hidden = healthy; },
});
// Annotation and evidence edits, wherever the UI makes them, arrive through this one hook.
onAnnotationStateChange(() => {
  requestSave();
  workspace.refreshEvidence();
});

// Selecting PDF text offers Highlight, Underline, Evidence and Cancel. The selection's rects are
// worked out the moment it is made, because scrolling before a button is pressed would move them.
// Highlight and Underline make a mark only; Evidence makes an evidence item only. They are independent.
let pendingSelection = null;
const selectionMenu = new SelectionMenu({
  onHighlight: ({ color }) => addMark("highlight", color),
  onUnderline: () => addMark("underline", null),
  onEvidence: () => {
    if (!pendingSelection) return;
    const { text, pageNumber } = pendingSelection;
    addEvidence({ annotationId: null, text, pageNumber });
    status.textContent = `Evidence saved from page ${pageNumber}. Connect it to a stage when you reach one.`;
  },
});
function addMark(type, color) {
  if (!pendingSelection) return;
  const { text, pageNumber, rects } = pendingSelection;
  addAnnotation({ pageNumber, type, color, text, rects });
  pdfViewer.refreshAnnotations(pageNumber);
}
pdfViewer.onSelectionChange = (range, text, pageNumber) => {
  const rects = pdfViewer.selectionRects(range, pageNumber);
  if (!rects) return;
  pendingSelection = { text, pageNumber, rects };
  selectionMenu.show(range, text);
};
pdfViewer.onAnnotationRemove = (id, pageNumber) => {
  removeAnnotation(id); // the evidence item, if any, stays
  pdfViewer.refreshAnnotations(pageNumber);
};
// Scrolling changes the saved PDF position. The long delay keeps this from writing while the reader scrolls.
document.querySelector("#pdf-pages").addEventListener("scroll", () => requestSave({ delay: 1200 }), { passive: true });

// Step 11: give workspace.js a way to navigate the PDF by page number.
// This keeps the dependency direction clean — workspace doesn't import pdfViewer.
registerPdfNavigation((pageNumber) => {
  // A resumed reading has no PDF until the file is chosen again; say so rather than do nothing.
  if (!pdfViewer.document) {
    pdfViewer.setStatus("Choose the PDF again to go to that page.");
    return;
  }
  pdfViewer.goToPage(pageNumber);
});

function showScreen(screenName, announcement) {
  screens.forEach((screen) => { screen.hidden = screen.dataset.screen !== screenName; });
  status.textContent = announcement;
}

const startupNotices = {
  invalid: "A saved reading could not be restored, so Paper Compass has started clean.",
  unavailable: "This browser is not allowing local saving, so a reading will not survive a refresh.",
};

// Sets the opening screen for whichever of three situations applies: nothing under way, a reading
// under way in this tab, or a saved reading from an earlier visit waiting for a choice.
function renderOpening() {
  const inProgress = readingInProgress();
  const pending = !inProgress && pendingSaved !== null;
  const canReturn = inProgress || pending;
  resumeButton.hidden = !canReturn;
  resumeButton.textContent = pending ? "Resume reading" : "Return to reading";
  startButton.textContent = pending ? "Start fresh" : inProgress ? "Start a different paper" : "Begin with a paper";
  // With a reading to return to, returning is the main action.
  startButton.classList.toggle("button-primary", !canReturn);
  startButton.classList.toggle("button-quiet", canReturn);
  resumeButton.classList.toggle("button-primary", canReturn);
  resumeButton.classList.toggle("button-quiet", !canReturn);
  resumeButton.classList.toggle("is-first", canReturn);
  recovery.hidden = !pending;
  if (pending) {
    const { title, detail } = describeSnapshot(pendingSaved);
    recoveryTitle.textContent = title;
    recoveryDetail.textContent = detail;
  }
  const notice = canReturn ? "" : startupNotices[startupStatus] || "";
  recoveryNotice.textContent = notice;
  recoveryNotice.hidden = !notice;
}

function showOpening(announcement) {
  renderOpening();
  showScreen("opening", announcement);
}

// Shown in the PDF pane after a resume, when the saved reading knew a PDF but the file itself
// (which is never stored) has not been chosen again.
function refreshReattach() {
  const waiting = Boolean(appState.paper.pdfName) && !appState.paper.pdf && readingInProgress();
  reattach.hidden = !waiting;
  if (waiting) pdfViewer.showEmptyState(`Choose ${appState.paper.pdfName} again to see the paper.`);
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
    pdf, pdfName: pdf?.name || "", pdfSize: pdf?.size || 0, pdfHash: "",
  };
  // The hash lets a resumed reading check it has been given the same file. It is computed in the
  // background and saved whenever it arrives.
  if (pdf) {
    fingerprintFile(pdf).then((hash) => {
      if (!hash || appState.paper.pdf !== pdf) return;
      appState.paper.pdfHash = hash;
      requestSave();
    });
  }
}

function saveTriageResponses() {
  appState.readingIntention = triageForm.elements.intention.value.trim();
  appState.initialInterpretation = triageForm.elements.interpretation.value.trim();
}

function clearForNewPaper() {
  // The saved reading is only discarded here, after the reader has confirmed the replacement.
  clearSnapshot();
  pendingSaved = null;
  startupStatus = "none";
  resetAppState();
  paperForm.reset();
  triageForm.reset();
  extractionStatus.textContent = extractionPrompt;
  pdfViewer.load(null);
  reattach.hidden = true;
}

function startNewPaper() {
  if (readingInProgress() || pendingSaved) {
    const message = readingInProgress()
      ? "Starting a different paper will replace your current reading. Continue?"
      : `Starting fresh will discard your saved reading of "${pendingSaved.paper.title || "Untitled paper"}". Continue?`;
    if (!window.confirm(message)) return;
    clearForNewPaper();
  }
  startupStatus = "none";
  showScreen("paper-entry", "Add a paper.");
  pdfInput.focus();
}

// Choosing a depth begins a fresh reading session for the paper just described.
function enterWorkspace(depth) {
  appState.decision = depth;
  appState.selectedDepth = depth;
  appState.readingSession = createReadingSession();
  workspace.render();
  showScreen("workspace", `${depthLabel(depth)} reading is ready.`);
  pdfViewer.load(appState.paper.pdf);
  workspace.focusStageTitle();
  // Choosing a depth is the moment a paper becomes a reading, so it is saved straight away.
  flushSave();
}

// Loads the saved reading the reader chose to resume. The PDF file is not stored, so the paper pane
// waits for the file to be chosen again; everything the reader wrote is back at once.
function resumeSaved() {
  try {
    restoreSnapshot(pendingSaved);
    pendingSaved = null;
    workspace.render();
  } catch (error) {
    // A snapshot that passed validation but still cannot be shown: set it aside and start clean.
    console.warn("Paper Compass could not resume the saved reading.", error);
    quarantineSnapshot();
    pendingSaved = null;
    startupStatus = "invalid";
    resetAppState();
    showOpening("The saved reading could not be restored.");
    return;
  }
  showScreen("workspace", `${depthLabel(appState.selectedDepth)} reading resumed.`);
  pdfViewer.load(null);
  refreshReattach();
  workspace.focusStageTitle();
}

// The reader chooses the PDF again after a resume.
async function reattachPdf(file) {
  const session = appState.readingSession;
  const hash = await fingerprintFile(file);
  if (appState.readingSession !== session || !readingInProgress()) return; // the reading was replaced meanwhile
  const { paper } = appState;
  const same = pdfMatches(paper, file, hash);
  paper.pdf = file;
  paper.pdfName = file.name;
  paper.pdfSize = file.size;
  paper.pdfHash = hash || (same ? paper.pdfHash : "");
  reattach.hidden = true;
  await pdfViewer.load(file);
  if (appState.readingSession !== session) return;
  pdfViewer.restoreView(session.view);
  if (!same) pdfViewer.setStatus("This file differs from the PDF you were reading. Your notes are kept, but highlights may not line up.");
  requestSave();
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
    // Fields the extractor could not fill with confidence, and that the reader has not already
    // typed in themselves, are worth calling out separately so a blank field reads as "checked
    // and uncertain" rather than "not looked at".
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

pdfInput.addEventListener("change", () => {
  const file = pdfInput.files[0];
  if (file) readPdfDetails(file);
  else extractionStatus.textContent = extractionPrompt;
});

startButton.addEventListener("click", startNewPaper);
resumeButton.addEventListener("click", () => {
  if (!readingInProgress() && pendingSaved) {
    resumeSaved();
    return;
  }
  workspace.render();
  showScreen("workspace", "Reading resumed.");
  pdfViewer.refit();
  workspace.focusStageTitle();
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
  flushSave();
  showOpening("Reading paused. Your notes are saved.");
  resumeButton.focus();
});

reattachButton.addEventListener("click", () => reattachInput.click());
reattachInput.addEventListener("change", () => {
  const file = reattachInput.files[0];
  reattachInput.value = "";
  if (file) reattachPdf(file);
});

// Autosave is the primary mechanism. These only make the last few seconds safe: leaving the page
// (pagehide, and the tab going to the background, which is the reliable signal on mobile) writes at once.
window.addEventListener("pagehide", () => flushSave());
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushSave(); });
// The browser's leave-page warning appears only when saving is not working, because only then would
// a refresh actually lose the reading.
window.addEventListener("beforeunload", (event) => {
  if (!readingInProgress()) return;
  flushSave();
  if (persistenceHealthy()) return;
  event.preventDefault();
  event.returnValue = "";
});

// Startup: look for a saved reading, but do not load it. Nothing here can stop the app opening.
const found = loadSnapshot();
startupStatus = found.status;
pendingSaved = found.snapshot;
renderOpening();
if (pendingSaved) status.textContent = `A saved reading of ${describeSnapshot(pendingSaved).title} can be resumed.`;
