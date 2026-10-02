// synthesis-view.js
// Step 15: the screen where a reader builds one cross-paper synthesis, one meaningful step at a time:
//   Question and papers -> Contributions -> Compare -> Interpret -> Judge.
// This module owns that screen's markup and behaviour only. It reads and writes syntheses through
// library.js (which validates and stores them) and never keeps its own copy of a synthesis: every
// stage is drawn from what is saved, so what the reader sees is always what would survive a refresh.
// It writes nothing on the reader's behalf — no claim, no evidence, no interpretation is suggested.
//
// The static shell (title, progress, notice, stage container, buttons) is in index.html under
// data-screen="synthesis"; app.js decides when that screen is shown and supplies two callbacks:
//   onExit(message?)               leave to the Library
//   onOpenPaper(paperId, page?)    open a paper's reading (optionally at an evidence item's page)

import {
  createSynthesis, describeRecord, getRecord, getRelationshipsForRecord, getSynthesis, listRecords,
  setSynthesisContribution, updateSynthesis,
} from "./library.js";
import { CONFIDENCE_LABELS, CONFIDENCE_LEVELS, MIN_PAPERS } from "./synthesis.js";

const STAGES = [
  {
    id: "question", short: "Question", title: "What do you want to understand?",
    context: "Name your question, then choose the papers you will read against it.", next: "Continue",
  },
  {
    id: "contributions", short: "Contributions", title: "What does each paper contribute?",
    context: "For each paper, say what it establishes that matters to your question, and link the passages you saved from it.", next: "Compare",
  },
  {
    id: "compare", short: "Compare", title: "Read the contributions side by side.",
    context: "This only lays out what you wrote. Nothing here is compared for you.", next: "Interpret",
  },
  {
    id: "interpret", short: "Interpret", title: "Where do they meet, and where do they part?",
    context: "Any of these can stay empty. An empty section is a legitimate outcome.", next: "Form your judgement",
  },
  {
    id: "judge", short: "Judge", title: "Where do you currently land?",
    context: "This is your view for now, and it can change.", next: "Finish",
  },
];

const SAVE_DELAY_MS = 400;
const EVIDENCE_PREVIEW_LENGTH = 220;

const refusalMessages = {
  question: "Write the question you are trying to answer.",
  "too-few-papers": `Choose at least ${MIN_PAPERS} papers to compare.`,
  "duplicate-papers": "Each paper can only be chosen once.",
  "invalid-record": "One of those papers is no longer in your library.",
  "not-found": "This comparison is no longer in your library.",
  "invalid-evidence": "That evidence does not belong to this paper.",
  storage: "This could not be saved. Local saving may be unavailable or full.",
};
const refusalMessage = (reason) => refusalMessages[reason] || "This could not be saved.";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function preview(text) {
  return text.length > EVIDENCE_PREVIEW_LENGTH ? `${text.slice(0, EVIDENCE_PREVIEW_LENGTH)}…` : text;
}

export function initSynthesisView({ onExit, onOpenPaper }) {
  const root = document.querySelector('[data-screen="synthesis"]');
  const titleEl = root.querySelector("#synthesis-title");
  const contextEl = root.querySelector("#synthesis-context");
  const questionEl = root.querySelector("#synthesis-question");
  const stepsEl = root.querySelector("#synthesis-steps");
  const positionEl = root.querySelector("#synthesis-position");
  const noticeEl = root.querySelector("#synthesis-notice");
  const stageEl = root.querySelector("#synthesis-stage");
  const backButton = root.querySelector('[data-action="synthesis-back"]');
  const nextButton = root.querySelector('[data-action="synthesis-next"]');
  const leaveButton = root.querySelector('[data-action="leave-synthesis"]');

  // What the screen is showing. id is null while a new comparison is still being defined (nothing is
  // saved until it has a question and two papers); draft holds that unsaved first stage.
  let state = { id: null, stage: 0, paperTab: 0, draft: { question: "", selected: new Set() } };

  // ---------- saving ----------
  // Edits are queued by key (a later edit of the same field replaces an earlier one) and written
  // shortly after typing stops. Every navigation, exit and page-hide flushes first, so nothing typed
  // is ever lost to the delay.
  const pending = new Map();
  let timer = 0;

  function showNotice(message) {
    noticeEl.textContent = message;
    noticeEl.hidden = !message;
  }

  function flush() {
    clearTimeout(timer);
    timer = 0;
    const runs = [...pending.values()];
    pending.clear();
    let failure = "";
    for (const run of runs) {
      const result = run();
      if (!result.ok) failure = refusalMessage(result.reason);
    }
    if (runs.length) showNotice(failure);
  }

  function queue(key, run) {
    pending.set(key, run);
    clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DELAY_MS);
  }

  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });

  // ---------- shell ----------

  function renderSteps() {
    const canJump = Boolean(state.id);
    stepsEl.replaceChildren(...STAGES.map((stage, index) => {
      const item = el("li", "synthesis-step");
      const button = el("button", "synthesis-step-button", String(index + 1));
      button.type = "button";
      button.dataset.stage = String(index);
      button.setAttribute("aria-label", `Step ${index + 1} of ${STAGES.length}: ${stage.short}`);
      button.disabled = !canJump && index !== state.stage;
      if (index === state.stage) {
        button.setAttribute("aria-current", "step");
        button.classList.add("is-current");
      } else if (index < state.stage) {
        button.classList.add("is-done");
      }
      item.append(button);
      return item;
    }));
    positionEl.textContent = `Step ${state.stage + 1} of ${STAGES.length} · ${STAGES[state.stage].short}`;
  }

  function render({ focus = true } = {}) {
    const synthesis = state.id ? getSynthesis(state.id) : null;
    if (state.id && !synthesis) { pending.clear(); onExit("That comparison is no longer in your library."); return; }
    const stage = STAGES[state.stage];
    titleEl.textContent = stage.title;
    contextEl.textContent = stage.context;
    // The question stays in view once it exists, so the reader never loses what they are answering.
    questionEl.hidden = !synthesis || state.stage === 0;
    questionEl.textContent = synthesis ? synthesis.question : "";
    renderSteps();
    const builders = [buildQuestionStage, buildContributionsStage, buildCompareStage, buildInterpretStage, buildJudgeStage];
    stageEl.replaceChildren(...builders[state.stage](synthesis));
    backButton.hidden = state.stage === 0;
    nextButton.textContent = stage.next;
    if (focus) titleEl.focus();
  }

  function goTo(index) {
    flush();
    state.stage = Math.min(Math.max(index, 0), STAGES.length - 1);
    render();
  }

  // ---------- shared field builders ----------

  let fieldCounter = 0;

  function textField({ label, hint, value, rows = 4, onInput, wide = true }) {
    const id = `synthesis-field-${(fieldCounter += 1)}`;
    const group = el("div", `field-group${wide ? " field-group-wide" : ""}`);
    const labelEl = el("label", null, label);
    labelEl.htmlFor = id;
    group.append(labelEl);
    if (hint) {
      const hintEl = el("p", "field-note", hint);
      hintEl.id = `${id}-hint`;
      group.append(hintEl);
    }
    const area = el("textarea");
    area.id = id;
    area.rows = rows;
    area.value = value;
    if (hint) area.setAttribute("aria-describedby", `${id}-hint`);
    area.addEventListener("input", () => onInput(area.value));
    group.append(area);
    return { group, area };
  }

  function confidenceField({ label, value, onChange }) {
    const id = `synthesis-field-${(fieldCounter += 1)}`;
    const group = el("div", "field-group");
    const labelEl = el("label", null, label);
    labelEl.htmlFor = id;
    const select = el("select", "synthesis-select");
    select.id = id;
    const unset = el("option", null, "Not chosen yet");
    unset.value = "";
    select.append(unset);
    for (const level of CONFIDENCE_LEVELS) {
      const option = el("option", null, CONFIDENCE_LABELS[level]);
      option.value = level;
      select.append(option);
    }
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
    group.append(labelEl, select);
    return group;
  }

  function paperHeading(record) {
    const info = describeRecord(record);
    const wrap = el("div", "synthesis-paper-heading");
    wrap.append(el("p", "synthesis-paper-title", info.title));
    if (info.byline) wrap.append(el("p", "synthesis-paper-byline", info.byline));
    return wrap;
  }

  // ---------- stage 1: question and papers ----------

  function buildQuestionStage(synthesis) {
    const nodes = [];
    const error = el("p", "synthesis-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    state.errorEl = error;

    const { group, area } = textField({
      label: "What are you trying to understand across these papers?",
      value: synthesis ? synthesis.question : state.draft.question,
      rows: 3,
      onInput: (value) => {
        if (!synthesis) { state.draft.question = value; return; }
        // An existing question can be reworded but never emptied; an empty box simply is not saved.
        if (value.trim()) queue("question", () => updateSynthesis(synthesis.id, { question: value }));
      },
    });
    area.id = "synthesis-question-input";
    state.questionInput = area;
    nodes.push(group);

    const papers = el("fieldset", "synthesis-papers");
    papers.append(el("legend", null, "Papers"));

    if (synthesis) {
      papers.append(el("p", "field-note", "The papers in a comparison are fixed once it is created. To compare a different set, start a new comparison."));
      const list = el("ul", "synthesis-paper-list");
      for (const paperId of synthesis.paperIds) {
        const record = getRecord(paperId);
        if (!record) continue;
        const item = el("li", "synthesis-paper-item");
        item.append(paperHeading(record));
        list.append(item);
      }
      papers.append(list);
    } else {
      const records = listRecords();
      if (records.length < MIN_PAPERS) {
        papers.append(el("p", "field-note", `A comparison needs at least ${MIN_PAPERS} papers in your library. Start another paper first, then come back.`));
      } else {
        papers.append(el("p", "field-note", `Choose at least ${MIN_PAPERS} papers from your library.`));
        const list = el("ul", "synthesis-paper-list");
        const count = el("p", "synthesis-count");
        const updateCount = () => { count.textContent = `${state.draft.selected.size} selected`; };
        for (const record of records) {
          const item = el("li", "synthesis-paper-item");
          const label = el("label", "synthesis-paper-choice");
          const box = el("input");
          box.type = "checkbox";
          box.value = record.id;
          box.checked = state.draft.selected.has(record.id);
          box.addEventListener("change", () => {
            if (box.checked) state.draft.selected.add(record.id);
            else state.draft.selected.delete(record.id);
            updateCount();
          });
          label.append(box, paperHeading(record));
          item.append(label);
          list.append(item);
        }
        updateCount();
        papers.append(list, count);
      }
    }
    nodes.push(papers, error);
    return nodes;
  }

  // Runs when Continue is pressed on stage 1. Returns true if the reader can move on.
  function commitQuestionStage() {
    const value = state.questionInput ? state.questionInput.value : state.draft.question;
    const fail = (message) => { state.errorEl.textContent = message; state.errorEl.hidden = false; return false; };
    if (!value.trim()) return fail(refusalMessages.question);
    if (state.id) { flush(); return true; }
    const chosen = listRecords().map((r) => r.id).filter((id) => state.draft.selected.has(id));
    const result = createSynthesis({ question: value, paperIds: chosen });
    if (!result.ok) return fail(refusalMessage(result.reason));
    state.id = result.synthesis.id;
    state.paperTab = 0;
    return true;
  }

  // ---------- stage 2: contributions ----------

  function buildContributionsStage(synthesis) {
    const nodes = [];
    const tabs = el("div", "synthesis-tabs");
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "Papers in this comparison");
    synthesis.paperIds.forEach((paperId, index) => {
      const record = getRecord(paperId);
      const tab = el("button", "synthesis-tab", record ? describeRecord(record).title : "Paper");
      tab.type = "button";
      tab.dataset.paperTab = String(index);
      tab.setAttribute("aria-pressed", String(index === state.paperTab));
      tabs.append(tab);
    });
    nodes.push(tabs);

    const paperId = synthesis.paperIds[Math.min(state.paperTab, synthesis.paperIds.length - 1)];
    const record = getRecord(paperId);
    const contribution = synthesis.contributions.find((c) => c.paperId === paperId);
    const card = el("section", "synthesis-card");
    card.setAttribute("aria-label", record ? describeRecord(record).title : "Paper");
    if (!record) {
      card.append(el("p", "field-note", "This paper is no longer in your library."));
      nodes.push(card);
      return nodes;
    }

    const header = el("div", "synthesis-card-header");
    header.append(paperHeading(record));
    const open = el("button", "synthesis-link", "Open paper");
    open.type = "button";
    open.dataset.openPaper = paperId;
    header.append(open);
    card.append(header);

    card.append(textField({
      label: "What does this paper establish that matters to your question?",
      value: contribution.claim,
      rows: 5,
      onInput: (value) => queue(`claim:${paperId}`, () => setSynthesisContribution(synthesis.id, { paperId, claim: value })),
    }).group);

    const evidence = record.session.evidence;
    const fieldset = el("fieldset", "synthesis-evidence");
    fieldset.append(el("legend", null, "Evidence from this paper"));
    if (!evidence.length) {
      fieldset.append(el("p", "field-note", "You have not saved any evidence from this paper yet. Open the paper, select a passage, and choose Evidence; it will then be available here."));
      const inspect = el("button", "button button-quiet", "Open this paper to select evidence");
      inspect.type = "button";
      inspect.dataset.openPaper = paperId;
      fieldset.append(inspect);
    } else {
      fieldset.append(el("p", "field-note", "Tick the passages that support what you wrote above."));
      const list = el("ul", "synthesis-evidence-list");
      for (const item of evidence) {
        const row = el("li", "synthesis-evidence-item");
        const label = el("label", "synthesis-evidence-choice");
        const box = el("input");
        box.type = "checkbox";
        box.value = item.id;
        box.checked = contribution.evidenceIds.includes(item.id);
        box.addEventListener("change", () => {
          const ids = [...list.querySelectorAll("input:checked")].map((input) => input.value);
          queue(`evidence:${paperId}`, () => setSynthesisContribution(synthesis.id, { paperId, evidenceIds: ids }));
        });
        const quote = el("span", "synthesis-evidence-quote", `“${preview(item.text)}”`);
        const meta = el("span", "synthesis-evidence-meta", `p. ${item.pageNumber}`);
        label.append(box, quote, meta);
        row.append(label);
        list.append(row);
      }
      fieldset.append(list);
    }
    card.append(fieldset);

    card.append(confidenceField({
      label: "How confident are you in this contribution?",
      value: contribution.confidence,
      onChange: (value) => queue(`confidence:${paperId}`, () => setSynthesisContribution(synthesis.id, { paperId, confidence: value })),
    }));
    nodes.push(card);
    return nodes;
  }

  // ---------- stage 3: compare ----------

  function buildCompareStage(synthesis) {
    const nodes = [];
    const grid = el("div", "synthesis-compare");
    for (const contribution of synthesis.contributions) {
      const record = getRecord(contribution.paperId);
      const card = el("section", "synthesis-card");
      if (!record) { card.append(el("p", "field-note", "This paper is no longer in your library.")); grid.append(card); continue; }
      card.setAttribute("aria-label", describeRecord(record).title);

      const header = el("div", "synthesis-card-header");
      header.append(paperHeading(record));
      const open = el("button", "synthesis-link", "Open paper");
      open.type = "button";
      open.dataset.openPaper = contribution.paperId;
      header.append(open);
      card.append(header);

      card.append(el("p", "synthesis-label", "Contribution"));
      card.append(contribution.claim.trim()
        ? el("p", "synthesis-claim", contribution.claim)
        : el("p", "synthesis-empty", "No contribution written yet."));

      card.append(el("p", "synthesis-label", "Confidence"));
      card.append(contribution.confidence
        ? el("p", "synthesis-confidence", CONFIDENCE_LABELS[contribution.confidence])
        : el("p", "synthesis-empty", "Not chosen yet."));

      const linked = contribution.evidenceIds
        .map((id) => record.session.evidence.find((item) => item.id === id))
        .filter(Boolean);
      card.append(el("p", "synthesis-label", `Evidence (${linked.length})`));
      if (!linked.length) {
        card.append(el("p", "synthesis-empty", "No evidence linked."));
      } else {
        const list = el("ul", "synthesis-evidence-list");
        for (const item of linked) {
          const row = el("li", "synthesis-evidence-item");
          row.append(el("p", "synthesis-evidence-quote", `“${preview(item.text)}”`));
          const meta = el("p", "synthesis-evidence-meta", `p. ${item.pageNumber} `);
          const go = el("button", "synthesis-link", `Open at page ${item.pageNumber}`);
          go.type = "button";
          go.dataset.openPaper = contribution.paperId;
          go.dataset.openPage = String(item.pageNumber);
          meta.append(go);
          row.append(meta);
          list.append(row);
        }
        card.append(list);
      }
      grid.append(card);
    }
    nodes.push(grid);

    // Links the reader already recorded between these very papers. Shown for context only; a
    // synthesis neither needs them nor creates them.
    const inThis = new Set(synthesis.paperIds);
    const seen = new Set();
    const rows = [];
    for (const paperId of synthesis.paperIds) {
      const record = getRecord(paperId);
      for (const rel of getRelationshipsForRecord(paperId)) {
        if (!inThis.has(rel.otherId) || seen.has(rel.id)) continue;
        seen.add(rel.id);
        rows.push({ title: record ? describeRecord(record).title : "A paper", rel });
      }
    }
    if (rows.length) {
      const section = el("section", "synthesis-relationships");
      section.append(el("p", "synthesis-label", "Links you recorded between these papers"));
      const list = el("ul", "synthesis-relationship-list");
      for (const { title, rel } of rows) {
        const item = el("li", "synthesis-relationship");
        item.append(el("p", null, `${title}: ${rel.label} ${rel.otherTitle}`));
        if (rel.note) item.append(el("p", "synthesis-relationship-note", rel.note));
        list.append(item);
      }
      section.append(list);
      nodes.push(section);
    }
    return nodes;
  }

  // ---------- stage 4: interpret ----------

  function buildInterpretStage(synthesis) {
    const field = (key, label, hint) => textField({
      label, hint, value: synthesis[key], rows: 5,
      onInput: (value) => queue(`text:${key}`, () => updateSynthesis(synthesis.id, { [key]: value })),
    }).group;
    return [
      field("convergence", "Convergence", "Where do these papers point in the same direction?"),
      field("tensions", "Tension", "Where do they disagree, qualify one another, or produce different results?"),
      field("gaps", "Gap", "What important part of your question remains unanswered?"),
    ];
  }

  // ---------- stage 5: judge ----------

  function buildJudgeStage(synthesis) {
    return [
      textField({
        label: "My current understanding",
        hint: "Given these papers together, what do you currently think?",
        value: synthesis.judgement, rows: 6,
        onInput: (value) => queue("text:judgement", () => updateSynthesis(synthesis.id, { judgement: value })),
      }).group,
      confidenceField({
        label: "How confident are you in this understanding?",
        value: synthesis.confidence,
        onChange: (value) => queue("confidence", () => updateSynthesis(synthesis.id, { confidence: value })),
      }),
      textField({
        label: "What would change my mind?",
        value: synthesis.whatWouldChangeMyMind, rows: 4,
        onInput: (value) => queue("text:whatWouldChangeMyMind", () => updateSynthesis(synthesis.id, { whatWouldChangeMyMind: value })),
      }).group,
    ];
  }

  // ---------- events ----------

  stepsEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-stage]");
    if (!button || button.disabled || !state.id) return;
    goTo(Number(button.dataset.stage));
  });

  stageEl.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-paper-tab]");
    if (tab) {
      flush();
      state.paperTab = Number(tab.dataset.paperTab);
      render({ focus: false });
      return;
    }
    const open = event.target.closest("[data-open-paper]");
    if (open) {
      flush();
      onOpenPaper(open.dataset.openPaper, open.dataset.openPage ? Number(open.dataset.openPage) : undefined);
    }
  });

  backButton.addEventListener("click", () => goTo(state.stage - 1));

  nextButton.addEventListener("click", () => {
    if (state.stage === 0 && !commitQuestionStage()) return;
    if (state.stage === STAGES.length - 1) { flush(); onExit(); return; }
    goTo(state.stage + 1);
  });

  leaveButton.addEventListener("click", () => { flush(); onExit(); });

  // ---------- entry points ----------

  return {
    // Start defining a new comparison. Nothing is saved until Continue on the first stage succeeds.
    create() {
      state = { id: null, stage: 0, paperTab: 0, draft: { question: "", selected: new Set() } };
      showNotice("");
      render();
    },
    // Reopen a saved comparison. Lands on the contributions if none has been written yet (the
    // natural next thing to do), otherwise on the side-by-side view; the numbered steps go anywhere.
    open(id) {
      const synthesis = getSynthesis(id);
      if (!synthesis) return false;
      const started = synthesis.contributions.some((c) => c.claim.trim());
      state = { id, stage: started ? 2 : 1, paperTab: 0, draft: { question: "", selected: new Set() } };
      showNotice("");
      render();
      return true;
    },
    // Writes anything still waiting to be saved. app.js calls this before leaving the screen.
    flush,
  };
}
