// Application wiring: the library home, paper entry, triage, and moving into the reading workspace.
// Stage behaviour lives in js/stages/, the workspace shell lives in workspace.js, one session's worth
// of validation/codec/autosave-engine lives in persistence.js, and the saved collection of readings —
// the library — lives in library.js. This file is the composition root: it decides when to call each,
// and holds the one thing none of them own — which record, if any, is the active reading right now.
import { PdfViewer } from "./pdf-viewer.js";
import { extractPdfMetadata } from "./metadata-extractor.js";
import { appState, createReadingSession, readingInProgress, resetAppState } from "./state.js";
import { depthLabel } from "./depths.js";
import { initWorkspace, registerPdfNavigation } from "./workspace.js";
import { addAnnotation, addEvidence, onAnnotationStateChange, removeAnnotation } from "./annotations.js";
import { SelectionMenu } from "./selection-menu.js";
import {
  buildSnapshot, cancelScheduledSave, configurePersistence, fingerprintFile, flushSave,
  pdfMatches, persistenceHealthy, requestSave, restoreSnapshot,
} from "./persistence.js";
import {
  createRecordId, deleteRecord, describeRecord, getRecord, loadLibrary, touchOpened, upsertRecord,
} from "./library.js";

const screens = document.querySelectorAll("[data-screen]");
const status = document.querySelector("#screen-status");
const paperForm = document.querySelector("#paper-form");
const triageForm = document.querySelector("#triage-form");
const pdfInput = document.querySelector("#paper-pdf");
const extractionStatus = document.querySelector("#metadata-extraction-status");
const startButton = document.querySelector('[data-action="start"]');
const libraryNotice = document.querySelector("#library-notice");
const libraryEmpty = document.querySelector("#library-empty");
const libraryList = document.querySelector("#library-list");
const saveNotice = document.querySelector("#save-notice");
const reattach = document.querySelector("#pdf-reattach");
const reattachButton = document.querySelector("#pdf-reattach-button");
const reattachInput = document.querySelector("#pdf-reattach-input");
const pdfViewer = new PdfViewer(document.querySelector(".pdf-viewer"));
const workspace = initWorkspace({ onChange: () => requestSave() });
const extractionPrompt = extractionStatus.textContent;

// Startup status of the library load ("none" | "ok" | "invalid" | "unavailable"), shown as a quiet
// notice on the library screen — the malformed-data and storage-unavailable protection Step 12 had
// for one session now covers the whole library instead.
let libraryStartupStatus = "none";

const libraryNotices = {
  invalid: "A saved paper could not be restored, so it has been set aside. The rest of your library is unaffected.",
  unavailable: "This browser is not allowing local saving, so papers will not survive a refresh.",
};

configurePersistence({
  // Copy live values into state just before each write: the open textarea and the PDF position.
  beforeSave() {
    workspace.saveCurrentStage();
    const anchor = pdfViewer.currentAnchor();
    if (anchor) appState.readingSession.view = anchor;
  },
  onStatusChange(healthy) { saveNotice.hidden = healthy; },
  // The autosave engine in persistence.js knows nothing about the library; it only calls this, and
  // only while a reading is active (appState.recordId is set the moment one begins — see enterWorkspace
  // and openRecord below).
  save: () => Boolean(upsertRecord(appState.recordId, buildSnapshot())),
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

// Give workspace.js a way to navigate the PDF by page number, without importing pdfViewer directly
// (keeping the dependency direction clean).
registerPdfNavigation((pageNumber) => {
  // An opened reading has no PDF until the file is chosen again; say so rather than do nothing.
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

// ---------- Library home ----------

function renderLibrary() {
  const { records } = loadLibrary();
  const sorted = [...records].sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
  libraryEmpty.hidden = sorted.length > 0;
  libraryList.hidden = sorted.length === 0;
  libraryList.replaceChildren(...sorted.map(buildLibraryCard));
  const notice = libraryNotices[libraryStartupStatus] || "";
  libraryNotice.textContent = notice;
  libraryNotice.hidden = !notice;
}

function buildLibraryCard(record) {
  const info = describeRecord(record);
  const item = document.createElement("li");
  item.className = "library-item";
  item.dataset.recordId = record.id;

  const main = document.createElement("div");
  main.className = "library-item-main";
  const title = document.createElement("p");
  title.className = "library-item-title";
  title.textContent = info.title;
  main.append(title);
  if (info.byline) {
    const byline = document.createElement("p");
    byline.className = "library-item-byline";
    byline.textContent = info.byline;
    main.append(byline);
  }
  const meta = document.createElement("p");
  meta.className = "library-item-meta";
  meta.textContent = `${info.depthLabel} · ${info.status}`;
  main.append(meta);
  if (info.lastOpenedLabel) {
    const when = document.createElement("p");
    when.className = "library-item-when";
    when.textContent = `Last read: ${info.lastOpenedLabel}`;
    main.append(when);
  }

  const actions = document.createElement("div");
  actions.className = "library-item-actions";
  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "button button-primary";
  openButton.dataset.action = "open-record";
  openButton.textContent = "Continue";
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "library-item-delete";
  deleteButton.dataset.action = "delete-record";
  deleteButton.textContent = "Delete";
  deleteButton.setAttribute("aria-label", `Delete "${info.title}"`);
  actions.append(openButton, deleteButton);

  item.append(main, actions);
  return item;
}

// One listener for the whole list handles every card's buttons, present or future.
libraryList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  const item = event.target.closest("[data-record-id]");
  if (!button || !item) return;
  const id = item.dataset.recordId;
  if (button.dataset.action === "open-record") openRecord(id);
  if (button.dataset.action === "delete-record") deleteRecordWithConfirm(id);
});

function deleteRecordWithConfirm(id) {
  const record = getRecord(id);
  const title = record ? describeRecord(record).title : "this paper";
  if (!window.confirm(`Delete your reading of "${title}"? This cannot be undone.`)) return;
  deleteRecord(id);
  // Defensive: deletion is only reachable from the library screen, where nothing should be the
  // active in-memory reading — but if it somehow is, do not leave appState pointing at a ghost record.
  if (appState.recordId === id) { cancelScheduledSave(); resetAppState(); }
  renderLibrary();
}

function showLibrary(announcement) {
  renderLibrary();
  showScreen("library", announcement);
}

// Shown in the PDF pane after opening a saved reading, when the record knew a PDF but the file
// itself (which is never stored) has not been chosen again.
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
  // The hash lets an opened reading check it has been given the same file. It is computed in the
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

// Starting a new paper never touches any saved reading — every paper gets its own independent
// library record, so there is nothing here to confirm or overwrite.
function startNewPaper() {
  cancelScheduledSave();
  resetAppState();
  paperForm.reset();
  triageForm.reset();
  extractionStatus.textContent = extractionPrompt;
  pdfViewer.load(null);
  reattach.hidden = true;
  showScreen("paper-entry", "Add a paper.");
  pdfInput.focus();
}

// Choosing a depth begins a fresh reading session for the paper just described, and gives it a
// library record of its own straight away (a brand-new record's lastOpened is "now" — see library.js).
function enterWorkspace(depth) {
  appState.decision = depth;
  appState.selectedDepth = depth;
  appState.readingSession = createReadingSession();
  appState.recordId = createRecordId();
  workspace.render();
  showScreen("workspace", `${depthLabel(depth)} reading is ready.`);
  pdfViewer.load(appState.paper.pdf);
  workspace.focusStageTitle();
  flushSave();
}

// Opens a saved reading from the library into the active workspace. The PDF file is not stored, so
// the paper pane waits for the file to be chosen again; everything the reader wrote is back at once.
function openRecord(id) {
  const record = getRecord(id);
  if (!record) { renderLibrary(); return; } // vanished since the list was drawn (e.g. deleted elsewhere)
  try {
    restoreSnapshot(record);
    appState.recordId = record.id;
  } catch (error) {
    console.warn("Paper Compass could not open this saved reading.", error);
    showLibrary("That saved reading could not be opened.");
    return;
  }
  touchOpened(record.id);
  workspace.render();
  showScreen("workspace", `${depthLabel(appState.selectedDepth)} reading resumed.`);
  pdfViewer.load(null);
  refreshReattach();
  workspace.focusStageTitle();
}

// The reader chooses the PDF again after opening a saved reading.
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
document.querySelector('[data-action="back-to-library"]').addEventListener("click", () => showLibrary("Paper Compass library."));
document.querySelector('[data-action="back-to-paper"]').addEventListener("click", () => { saveTriageResponses(); populatePaperForm(); showScreen("paper-entry", "Paper details."); });
document.querySelector('[data-action="review-triage"]').addEventListener("click", () => { showScreen("triage", "Review your triage."); document.querySelector("#reading-intention").focus(); });
document.querySelector('[data-action="return-to-start"]').addEventListener("click", () => { resetAppState(); showLibrary("Paper Compass library."); });

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
  // The record is already safely persisted, so the active reading can leave memory entirely — the
  // library, not appState, is what keeps it (see library.js's upsertRecord/getRecord).
  resetAppState();
  showLibrary("Reading paused. Your notes are saved.");
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

// Startup: load the library (folding in a Step 12 single-session record if one is found — see
// library.js) and show it. Nothing here can stop the app opening.
libraryStartupStatus = loadLibrary().status;
showLibrary("Paper Compass library.");
