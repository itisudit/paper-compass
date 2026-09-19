import { PdfViewer } from "./pdf-viewer.js";
import { extractPdfMetadata } from "./metadata-extractor.js";

// In-memory state is kept here until persistent storage is introduced.
const appState = {
  paper: { title: "", authors: "", journal: "", year: "", doi: "", volume: "", issue: "", pages: "", pdf: null, pdfName: "" },
  readingIntention: "",
  initialInterpretation: "",
  selectedDepth: null,
  decision: null,
  readingSession: {
    stage: "orient",
    responses: { orient: "", place: "" },
    reconstruct: { attempt: "", revision: "", hintLevel: 0, inspected: false },
    appraise: { attempt: "", revision: "", hintLevel: 0, inspected: false },
    stuckReason: "",
  },
};

const stages = {
  orient: "orient",
  place: "place",
};
const readingActivities = {
  surf: {
    orient: { activity: "Get the shape", title: "Take a quick first pass.", context: "You do not need to understand the whole paper yet.", prompt: "Read the title, abstract, figures or tables, and conclusion. Let the paper show you its shape before you try to explain it." },
    place: { activity: "Notice what matters", title: "Choose one thing to carry forward.", prompt: "After your skim, notice one question, finding, figure, or tension worth keeping in view. A rough note is enough." },
    reconstruct: { activity: "Map the route" },
    appraise: { activity: "Look at the approach" },
  },
  swim: {
    orient: { activity: "Find the question", title: "Read for the question.", context: "Start with the abstract and introduction. Stay with the paper before you try to state its answer.", prompt: "Notice what the authors are trying to find out and why it matters. You are only locating the question for now." },
    place: { activity: "Follow the approach", title: "See how they try to answer it.", prompt: "Read the methods and the first results that seem important. Notice what the authors chose to compare, measure, or test." },
    reconstruct: { activity: "Trace the argument" },
    appraise: { activity: "Question the approach" },
  },
  "dive-deep": {
    orient: { activity: "Find the claim", title: "Read for the claim and its stakes.", context: "Begin with the abstract, introduction, and conclusion. Let the paper state its own ambition first.", prompt: "Notice what the authors say is at stake and what they want the evidence to establish. Do not judge it yet." },
    place: { activity: "Trace the strategy", title: "See how the paper builds its case.", prompt: "Read across methods and results. Notice where the paper moves from question, to evidence, to interpretation. Keep an eye on what would change your mind." },
    reconstruct: { activity: "Rebuild the reasoning" },
    appraise: { activity: "Probe the inference" },
  },
};
const reconstructTasks = {
  surf: {
    context: "Build a light map. Short, provisional notes are enough.",
    task: "Sketch the paper's path in a few strokes. What seems to be the question, and what parts of the paper look likely to carry its answer?",
    hints: ["Start with the title or abstract. Notice the question and the broad claim.", "Which headings, figures, or sections seem to mark the paper's main turns?", "Inspect the abstract and conclusion, then glance at the first figure or table that appears central."],
  },
  swim: {
    context: "Form an expectation, inspect the paper, then revise your account.",
    task: "Sketch how the authors appear to move from their question to an answer. Include the research strategy and the evidence you think carries the argument.",
    hints: ["Begin with a tentative path, even if you are unsure of the details.", "What did the authors need to observe or compare in order to answer their question?", "Inspect the methods and results sections. Look for the result the conclusion seems to rely on."],
  },
  "dive-deep": {
    context: "Trace the links from claim, through evidence and interpretation, to conclusion.",
    task: "Rebuild the paper's chain of reasoning. How do the question, research strategy, key evidence, interpretation, and conclusion connect in the authors' account?",
    hints: ["Start by naming the claim and the pieces that would need to connect for it to follow.", "Where does the research strategy turn the question into evidence, and where does interpretation turn evidence into a conclusion?", "Inspect the methods, the central result, and the discussion together. Notice what each contributes to the chain."],
  },
};
const appraiseTasks = {
  surf: {
    context: "Stay with the one part of the paper that carries its answer.",
    task: "Read the part of the paper that carries its answer. What design, comparison, model, experiment, or strategy does it rely on?",
    hints: ["Begin with the result the paper treats as decisive.", "What single comparison or observation is meant to make the answer credible?", "Inspect the central figure or table and the short methods description explaining how that result was produced."],
  },
  swim: {
    context: "Follow the central research strategy, not every possible limitation.",
    task: "As you read, notice what would need to be true for this approach to support the conclusion, and one way the reasoning could go wrong.",
    hints: ["Stay with the main route from the approach to the conclusion.", "For the conclusion to follow, what must the comparison or measure be capturing rather than something else?", "Inspect the design and controls around the central result. Look for what the approach can and cannot separate."],
  },
  "dive-deep": {
    context: "Interrogate the link from the central result to the conclusion. A limitation matters only if it changes that link.",
    task: "Read for the crucial link between result and conclusion. Notice the assumption doing the most work, another possible explanation, whether the design separates those possibilities, and where the inference should stop.",
    hints: ["Follow only the inferential link that carries the most weight.", "What assumption turns this result into the claimed conclusion? What other process could lead to the same pattern?", "Inspect the methods, controls, and discussion around the central result. Notice where the authors rule out alternatives and where they leave scope."],
  },
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

function saveReconstructResponses() {
  appState.readingSession.reconstruct.attempt = document.querySelector("#reconstruct-attempt").value;
  appState.readingSession.reconstruct.revision = document.querySelector("#reconstruct-revision-text").value;
}

function saveAppraiseResponses() {
  appState.readingSession.appraise.attempt = document.querySelector("#appraise-attempt").value;
  appState.readingSession.appraise.revision = document.querySelector("#appraise-revision-text").value;
}

function renderWorkspace() {
  const { stage } = appState.readingSession;
  const depth = appState.selectedDepth === "dive-deep" ? "Dive Deep" : appState.selectedDepth[0].toUpperCase() + appState.selectedDepth.slice(1);
  document.querySelector("#selected-depth").textContent = depth;
  document.querySelector("#paper-workspace-title").textContent = appState.paper.title;
  document.querySelector("#paper-metadata").textContent = paperMetadata();
  const context = document.querySelector("#workspace-context");
  const previousButton = document.querySelector('[data-action="previous-stage"]');
  const continueButton = document.querySelector('[data-action="continue-stage"]');
  const activity = readingActivities[appState.selectedDepth][stage];
  document.querySelector("#reading-activity").textContent = activity.activity;
  if (stage === "reconstruct") {
    const mode = reconstructTasks[appState.selectedDepth];
    const reconstruction = appState.readingSession.reconstruct;
    document.querySelector("#workspace-title").textContent = appState.selectedDepth === "surf" ? "Sketch the paper's route." : appState.selectedDepth === "swim" ? "How does the paper get to its answer?" : "Rebuild the paper's reasoning.";
    context.hidden = false;
    context.textContent = mode.context;
    document.querySelector("#workspace-prompt").textContent = mode.task;
    document.querySelector("#standard-stage").hidden = true;
    document.querySelector("#reconstruct-stage").hidden = false;
    document.querySelector("#appraise-stage").hidden = true;
    document.querySelector("#reconstruct-attempt").value = reconstruction.attempt;
    document.querySelector("#reconstruct-revision-text").value = reconstruction.revision;
    document.querySelector("#reconstruct-revision").hidden = !reconstruction.inspected;
    const hint = document.querySelector("#reconstruct-hint");
    hint.hidden = reconstruction.hintLevel === 0;
    hint.textContent = reconstruction.hintLevel ? mode.hints[reconstruction.hintLevel - 1] : "";
    previousButton.hidden = false;
    continueButton.hidden = false;
    continueButton.innerHTML = 'Look at the approach <span aria-hidden="true">→</span>';
  } else if (stage === "appraise") {
    const mode = appraiseTasks[appState.selectedDepth];
    const appraisal = appState.readingSession.appraise;
    document.querySelector("#workspace-title").textContent = appState.selectedDepth === "surf" ? "What does the paper rely on?" : appState.selectedDepth === "swim" ? "What would this approach need to support?" : "What can this approach establish?";
    context.hidden = false;
    context.textContent = mode.context;
    document.querySelector("#workspace-prompt").textContent = mode.task;
    document.querySelector("#standard-stage").hidden = true;
    document.querySelector("#reconstruct-stage").hidden = true;
    document.querySelector("#appraise-stage").hidden = false;
    document.querySelector("#appraise-attempt").value = appraisal.attempt;
    document.querySelector("#appraise-revision-text").value = appraisal.revision;
    document.querySelector("#appraise-revision").hidden = !appraisal.inspected;
    const hint = document.querySelector("#appraise-hint");
    hint.hidden = appraisal.hintLevel === 0;
    hint.textContent = appraisal.hintLevel ? mode.hints[appraisal.hintLevel - 1] : "";
    previousButton.hidden = false;
    continueButton.hidden = true;
  } else {
    document.querySelector("#workspace-title").textContent = activity.title;
    context.hidden = !activity.context;
    context.textContent = activity.context || "";
    document.querySelector("#workspace-prompt").textContent = activity.prompt;
    responseField.value = appState.readingSession.responses[stage];
    document.querySelector("#standard-stage").hidden = false;
    document.querySelector("#reconstruct-stage").hidden = true;
    document.querySelector("#appraise-stage").hidden = true;
    previousButton.hidden = stage === "orient";
    continueButton.hidden = false;
    continueButton.innerHTML = 'Continue <span aria-hidden="true">→</span>';
  }
}

function enterWorkspace(depth) {
  appState.decision = depth;
  appState.selectedDepth = depth;
  appState.readingSession.stage = "orient";
  renderWorkspace();
  showScreen("workspace", `${depth === "dive-deep" ? "Dive Deep" : depth[0].toUpperCase() + depth.slice(1)} reading is ready.`);
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
document.querySelector('[data-action="resume"]').addEventListener("click", () => { renderWorkspace(); showScreen("workspace", "Reading resumed."); document.querySelector("#workspace-title").focus(); });
document.querySelector('[data-action="back-to-opening"]').addEventListener("click", () => showScreen("opening", "Paper Compass opening screen."));
document.querySelector('[data-action="back-to-paper"]').addEventListener("click", () => { saveTriageResponses(); populatePaperForm(); showScreen("paper-entry", "Paper details."); });
document.querySelector('[data-action="review-triage"]').addEventListener("click", () => { showScreen("triage", "Review your triage."); document.querySelector("#reading-intention").focus(); });

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
  if (appState.readingSession.stage === "reconstruct") saveReconstructResponses();
  else if (appState.readingSession.stage === "appraise") saveAppraiseResponses();
  else saveStageResponse();
  document.querySelector('[data-action="resume"]').hidden = false;
  showScreen("opening", "Reading paused. Your notes remain available in this session.");
  document.querySelector('[data-action="resume"]').focus();
});
document.querySelector('[data-action="continue-stage"]').addEventListener("click", () => {
  const { stage } = appState.readingSession;
  if (stage === "reconstruct") saveReconstructResponses(); else saveStageResponse();
  if (stage === "orient") appState.readingSession.stage = "place";
  else if (stage === "place") appState.readingSession.stage = "reconstruct";
  else if (stage === "reconstruct") appState.readingSession.stage = "appraise";
  renderWorkspace();
  document.querySelector("#workspace-title").focus();
});
document.querySelector('[data-action="previous-stage"]').addEventListener("click", () => {
  if (appState.readingSession.stage === "reconstruct") saveReconstructResponses();
  else if (appState.readingSession.stage === "appraise") saveAppraiseResponses();
  else saveStageResponse();
  if (appState.readingSession.stage === "place") appState.readingSession.stage = "orient";
  else if (appState.readingSession.stage === "reconstruct") appState.readingSession.stage = "place";
  else if (appState.readingSession.stage === "appraise") appState.readingSession.stage = "reconstruct";
  renderWorkspace();
  document.querySelector("#workspace-title").focus();
});
document.querySelector('[data-action="show-hint"]').addEventListener("click", () => {
  const reconstruction = appState.readingSession.reconstruct;
  saveReconstructResponses();
  reconstruction.hintLevel = Math.min(reconstruction.hintLevel + 1, 3);
  renderWorkspace();
  document.querySelector("#reconstruct-hint").focus();
});
document.querySelector('[data-action="inspect-paper"]').addEventListener("click", () => {
  saveReconstructResponses();
  appState.readingSession.reconstruct.inspected = true;
  renderWorkspace();
  document.querySelector("#pdf-pages").focus();
});
document.querySelector('[data-action="show-appraise-hint"]').addEventListener("click", () => {
  const appraisal = appState.readingSession.appraise;
  saveAppraiseResponses();
  appraisal.hintLevel = Math.min(appraisal.hintLevel + 1, 3);
  renderWorkspace();
  document.querySelector("#appraise-hint").focus();
});
document.querySelector('[data-action="inspect-appraise-paper"]').addEventListener("click", () => {
  saveAppraiseResponses();
  appState.readingSession.appraise.inspected = true;
  renderWorkspace();
  document.querySelector("#pdf-pages").focus();
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
