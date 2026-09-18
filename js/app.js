import { PdfViewer } from "./pdf-viewer.js";
import { extractPdfMetadata } from "./metadata-extractor.js";

// In-memory state is kept here until persistent storage is introduced.
const appState = {
  paper: { title: "", authors: "", journal: "", year: "", doi: "", volume: "", issue: "", pages: "", pdf: null, pdfName: "" },
  readingIntention: "",
  initialInterpretation: "",
  selectedDepth: null,
  decision: null,
  readingSession: { stage: "orient", responses: { orient: "", place: "" }, stuckReason: "" },
};

const stages = {
  orient: { name: "Orient", prompt: "What is this paper trying to establish?" },
  place: { name: "Place", prompt: "What conversation is this paper entering?" },
};
const screens = document.querySelectorAll("[data-screen]");
const status = document.querySelector("#screen-status");
const paperForm = document.querySelector("#paper-form");
const triageForm = document.querySelector("#triage-form");
const responseField = document.querySelector("#stage-response");
const pdfViewer = new PdfViewer(document.querySelector(".pdf-viewer"));
const pdfInput = document.querySelector("#paper-pdf");
const readPdfDetailsButton = document.querySelector('[data-action="read-pdf-details"]');
const extractionStatus = document.querySelector("#metadata-extraction-status");

function showScreen(screenName, announcement) {
  screens.forEach((screen) => { screen.hidden = screen.dataset.screen !== screenName; });
  status.textContent = announcement;
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

function paperMetadata() {
  const publication = [appState.paper.journal, appState.paper.year].filter(Boolean).join(" · ");
  const location = [appState.paper.volume && `Vol. ${appState.paper.volume}`, appState.paper.issue && `No. ${appState.paper.issue}`, appState.paper.pages].filter(Boolean).join(", ");
  return [appState.paper.authors, publication, location].filter(Boolean).join(" · ") || "Details to be added";
}

function selectedPdf() { return pdfInput.files[0] || null; }

function setExtractionStatus(message) { extractionStatus.textContent = message; }

pdfInput.addEventListener("change", () => {
  readPdfDetailsButton.disabled = !selectedPdf();
  setExtractionStatus(selectedPdf() ? "Ready to read the first two pages for available details." : "Choose a PDF, then read its first two pages for available details.");
});

readPdfDetailsButton.addEventListener("click", async () => {
  const file = selectedPdf();
  if (!file) return;
  readPdfDetailsButton.disabled = true;
  setExtractionStatus("Reading the first two pages for details.");
  try {
    const { fields, hasText } = await extractPdfMetadata(file);
    if (!hasText) {
      setExtractionStatus("No extractable text was found in the first two pages. You can enter details manually.");
      return;
    }
    const updated = Object.entries(fields).filter(([key, value]) => {
      const field = paperForm.elements.namedItem(key);
      if (!value || field.value.trim()) return false;
      field.value = value;
      return true;
    }).map(([key]) => key);
    setExtractionStatus(updated.length ? `Details were read from the PDF. Please review the ${updated.join(", ")} field${updated.length === 1 ? "" : "s"}.` : "The first two pages were read, but no blank fields had clear details to add. Please review the form.");
  } catch (error) {
    setExtractionStatus("These PDF details could not be read. You can enter them manually.");
    console.error("Paper Compass metadata extraction error:", error);
  } finally {
    readPdfDetailsButton.disabled = !selectedPdf();
  }
});

function saveStageResponse() {
  appState.readingSession.responses[appState.readingSession.stage] = responseField.value;
}

function renderWorkspace() {
  const { stage } = appState.readingSession;
  const depth = appState.selectedDepth === "dive-deep" ? "Dive Deep" : appState.selectedDepth[0].toUpperCase() + appState.selectedDepth.slice(1);
  document.querySelector("#selected-depth").textContent = depth;
  document.querySelector("#paper-workspace-title").textContent = appState.paper.title;
  document.querySelector("#paper-metadata").textContent = paperMetadata();
  document.querySelector("#workspace-title").textContent = stages[stage].name;
  document.querySelector("#workspace-prompt").textContent = stages[stage].prompt;
  responseField.value = appState.readingSession.responses[stage];
  document.querySelectorAll("[data-journey-stage]").forEach((item) => item.classList.toggle("is-current", item.dataset.journeyStage === stage));
  document.querySelector('[data-action="previous-stage"]').hidden = stage === "orient";
  document.querySelector('[data-action="continue-stage"]').hidden = stage === "place";
}

function enterWorkspace(depth) {
  appState.decision = depth;
  appState.selectedDepth = depth;
  appState.readingSession.stage = "orient";
  renderWorkspace();
  showScreen("workspace", `${depth === "dive-deep" ? "Dive Deep" : depth[0].toUpperCase() + depth.slice(1)} reading workspace. Orient is ready.`);
  pdfViewer.load(appState.paper.pdf);
  document.querySelector("#workspace-title").focus();
}

function showShoreConfirmation() {
  appState.decision = "shore";
  appState.selectedDepth = null;
  document.querySelector("#confirmation-choice").textContent = "This paper is ashore for later.";
  document.querySelector("#confirmation-detail").textContent = "You have made room to return when the question or timing is right.";
  showScreen("confirmation", "This paper is ashore for later.");
  document.querySelector("#confirmation-title").focus();
}

document.querySelector('[data-action="start"]').addEventListener("click", () => { showScreen("paper-entry", "Add a paper."); document.querySelector("#paper-title").focus(); });
document.querySelector('[data-action="back-to-opening"]').addEventListener("click", () => showScreen("opening", "Paper Compass opening screen."));
document.querySelector('[data-action="back-to-paper"]').addEventListener("click", () => { saveTriageResponses(); populatePaperForm(); showScreen("paper-entry", "Paper details."); });
document.querySelector('[data-action="review-triage"]').addEventListener("click", () => { showScreen("triage", "Review your triage."); document.querySelector("#reading-intention").focus(); });

paperForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!paperForm.reportValidity()) return;
  savePaper();
  showScreen("triage", "Orient yourself to this paper and choose a reading depth.");
  document.querySelector("#reading-intention").focus();
});
document.querySelectorAll("[data-depth]").forEach((button) => {
  button.addEventListener("click", () => { saveTriageResponses(); enterWorkspace(button.dataset.depth); });
});
document.querySelector('[data-action="shore"]').addEventListener("click", () => { saveTriageResponses(); showShoreConfirmation(); });
document.querySelector('[data-action="continue-stage"]').addEventListener("click", () => {
  saveStageResponse();
  appState.readingSession.stage = "place";
  renderWorkspace();
  document.querySelector("#workspace-title").focus();
});
document.querySelector('[data-action="previous-stage"]').addEventListener("click", () => {
  saveStageResponse();
  appState.readingSession.stage = "orient";
  renderWorkspace();
  document.querySelector("#workspace-title").focus();
});
document.querySelector('[data-action="open-stuck"]').addEventListener("click", () => { document.querySelector("#stuck-panel").hidden = false; document.querySelector("#stuck-title").focus(); });
document.querySelector('[data-action="close-stuck"]').addEventListener("click", () => { document.querySelector("#stuck-panel").hidden = true; document.querySelector('[data-action="open-stuck"]').focus(); });
document.querySelectorAll("[data-stuck-reason]").forEach((button) => {
  button.addEventListener("click", () => { appState.readingSession.stuckReason = button.dataset.stuckReason; document.querySelector("#stuck-panel").hidden = true; document.querySelector('[data-action="open-stuck"]').focus(); });
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || document.querySelector("#stuck-panel").hidden) return;
  document.querySelector("#stuck-panel").hidden = true;
  document.querySelector('[data-action="open-stuck"]').focus();
});
