// Appraise: the reader examines whether the paper's research strategy can support its conclusion.
// This stage owns its own copy, markup, state and behaviour. It shares nothing with the other stages.

const copy = {
  swim: {
    activity: "Question the approach",
    title: "What would this approach need to support?",
    context: "Follow the central research strategy, not every possible limitation.",
    task: "As you read, notice what would need to be true for this approach to support the conclusion, and one way the reasoning could go wrong.",
    hints: [
      "Stay with the main route from the approach to the conclusion.",
      "For the conclusion to follow, what must the comparison or measure be capturing rather than something else?",
      "Inspect the design and controls around the central result. Look for what the approach can and cannot separate.",
    ],
  },
  "dive-deep": {
    activity: "Probe the inference",
    title: "What can this approach establish?",
    context: "Interrogate the link from the central result to the conclusion. A limitation matters only if it changes that link.",
    task: "Read for the crucial link between result and conclusion. Notice the assumption doing the most work, another possible explanation, whether the design separates those possibilities, and where the inference should stop.",
    hints: [
      "Follow only the inferential link that carries the most weight.",
      "What assumption turns this result into the claimed conclusion? What other process could lead to the same pattern?",
      "Inspect the methods, controls, and discussion around the central result. Notice where the authors rule out alternatives and where they leave scope.",
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
    <section class="appraise-stage" aria-label="Examine the paper's approach">
      <div class="field-group"><label for="appraise-attempt">Your provisional note</label><textarea id="appraise-attempt" rows="7" placeholder="Write a provisional note about what the approach can support."></textarea></div>
      <div class="appraise-tools"><button class="button button-quiet" type="button" data-action="hint">Hint</button><button class="button button-quiet" type="button" data-action="inspect">Inspect the paper</button></div>
      <p class="appraise-hint" tabindex="-1" aria-live="polite" hidden><span class="appraise-hint-count"></span><span class="appraise-hint-text"></span></p>
      <div class="appraise-revision" hidden><label for="appraise-revision-text">Revise after inspection <span class="optional">Optional</span></label><textarea id="appraise-revision-text" rows="7" placeholder="What now seems supported, uncertain, or outside the approach's reach?"></textarea></div>
    </section>
  `;
  view = {
    title: panel.querySelector("[data-stage-title]"),
    context: panel.querySelector("[data-context]"),
    prompt: panel.querySelector("[data-prompt]"),
    attempt: panel.querySelector("#appraise-attempt"),
    hintButton: panel.querySelector('[data-action="hint"]'),
    inspectButton: panel.querySelector('[data-action="inspect"]'),
    hint: panel.querySelector(".appraise-hint"),
    hintCount: panel.querySelector(".appraise-hint-count"),
    hintText: panel.querySelector(".appraise-hint-text"),
    revision: panel.querySelector(".appraise-revision"),
    revisionText: panel.querySelector("#appraise-revision-text"),
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
  id: "appraise",
  entryLabel: "Look at the approach",
  activity: (depth) => copy[depth].activity,
  initialState: () => ({ attempt: "", revision: "", hintLevel: 0, inspected: false }),
  mount,
  render,
  save,
  latestNote: (state) => state.revision.trim() || state.attempt.trim(),
};
