// Reconstruct: the reader states how the paper gets from question to conclusion, inspects the paper, then revises.
// This stage owns its own copy, markup, state and behaviour. It shares nothing with the other stages.

const copy = {
  swim: {
    activity: "Trace the argument",
    title: "How does the paper get to its answer?",
    context: "Form an expectation, inspect the paper, then revise your account.",
    task: "Sketch how the authors appear to move from their question to an answer. Include the research strategy and the evidence you think carries the argument.",
    hints: [
      "Begin with a tentative path, even if you are unsure of the details.",
      "What did the authors need to observe or compare in order to answer their question?",
      "Inspect the methods and results sections. Look for the result the conclusion seems to rely on.",
    ],
  },
  "dive-deep": {
    activity: "Rebuild the reasoning",
    title: "Rebuild the paper's reasoning.",
    context: "Trace the links from claim, through evidence and interpretation, to conclusion.",
    task: "Rebuild the paper's chain of reasoning. How do the question, research strategy, key evidence, interpretation, and conclusion connect in the authors' account?",
    hints: [
      "Start by naming the claim and the pieces that would need to connect for it to follow.",
      "Where does the research strategy turn the question into evidence, and where does interpretation turn evidence into a conclusion?",
      "Inspect the methods, the central result, and the discussion together. Notice what each contributes to the chain.",
    ],
  },
};

let view = null;

function mount(panel, ctx) {
  panel.innerHTML = `
    <p class="eyebrow">A small prompt</p>
    <h2 class="stage-title" data-stage-title tabindex="-1"></h2>
    <p class="workspace-context" data-context></p>
    <p class="workspace-prompt" data-prompt></p>
    <section class="reconstruct-stage" aria-label="Build your model of the paper">
      <div class="field-group"><label for="reconstruct-attempt">Your first sketch</label><textarea id="reconstruct-attempt" rows="7" placeholder="Sketch the path you think the paper takes. This can be incomplete."></textarea></div>
      <div class="reconstruct-tools"><button class="button button-quiet" type="button" data-action="hint">Hint</button><button class="button button-quiet" type="button" data-action="inspect">Inspect the paper</button></div>
      <p class="reconstruct-hint" tabindex="-1" aria-live="polite" hidden><span class="reconstruct-hint-count"></span><span class="reconstruct-hint-text"></span></p>
      <div class="reconstruct-revision" hidden><label for="reconstruct-revision-text">Revise after inspection <span class="optional">Optional</span></label><textarea id="reconstruct-revision-text" rows="7" placeholder="What would you now add, change, or connect in your sketch?"></textarea></div>
    </section>
  `;
  view = {
    title: panel.querySelector("[data-stage-title]"),
    context: panel.querySelector("[data-context]"),
    prompt: panel.querySelector("[data-prompt]"),
    attempt: panel.querySelector("#reconstruct-attempt"),
    hintButton: panel.querySelector('[data-action="hint"]'),
    inspectButton: panel.querySelector('[data-action="inspect"]'),
    hint: panel.querySelector(".reconstruct-hint"),
    hintCount: panel.querySelector(".reconstruct-hint-count"),
    hintText: panel.querySelector(".reconstruct-hint-text"),
    revision: panel.querySelector(".reconstruct-revision"),
    revisionText: panel.querySelector("#reconstruct-revision-text"),
  };
  view.hintButton.addEventListener("click", () => {
    save(ctx);
    ctx.state.hintLevel = Math.min(ctx.state.hintLevel + 1, copy[ctx.depth].hints.length);
    render(ctx);
    view.hint.focus();
  });
  view.inspectButton.addEventListener("click", () => {
    save(ctx);
    ctx.state.inspected = true;
    render(ctx);
    ctx.focusPaper();
  });
}

function render(ctx) {
  const mode = copy[ctx.depth];
  const { state } = ctx;
  const total = mode.hints.length;
  view.title.textContent = mode.title;
  view.context.textContent = mode.context;
  view.prompt.textContent = mode.task;
  view.attempt.value = state.attempt;
  view.revisionText.value = state.revision;
  view.revision.hidden = !state.inspected;
  view.inspectButton.textContent = state.inspected ? "Back to the paper" : "Inspect the paper";
  view.hint.hidden = state.hintLevel === 0;
  view.hintCount.textContent = state.hintLevel ? `Hint ${state.hintLevel} of ${total}` : "";
  view.hintText.textContent = state.hintLevel ? mode.hints[state.hintLevel - 1] : "";
  view.hintButton.disabled = state.hintLevel >= total;
  view.hintButton.textContent = state.hintLevel === 0 ? "Hint" : state.hintLevel >= total ? "No more hints" : "Another hint";
}

function save(ctx) {
  ctx.state.attempt = view.attempt.value;
  ctx.state.revision = view.revisionText.value;
}

export default {
  id: "reconstruct",
  entryLabel: "Continue",
  activity: (depth) => copy[depth].activity,
  initialState: () => ({ attempt: "", revision: "", hintLevel: 0, inspected: false }),
  mount,
  render,
  save,
  latestNote: (state) => state.revision.trim() || state.attempt.trim(),
};
