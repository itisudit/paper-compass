// Connect: the reader relates the paper to specific work and ideas they already know.
// This stage owns its own copy, markup, state and behaviour. It shares nothing with the other stages.

const copy = {
  "dive-deep": {
    activity: "Place the paper",
    title: "How does this fit with what you know?",
    context: "Place the paper against specific work, ideas, or results you already know. These are lenses, not boxes to complete.",
    task: "Which work you already know does this paper agree with, extend, or contradict? Notice what it adds beyond that work, then name the next question it leaves you with.",
    hints: [
      "Begin with one specific study, idea, or result you already know that bears on this paper's question.",
      "Does the paper agree with it, extend it, or sit uneasily with it? What exactly does it add beyond it?",
      "Inspect the introduction and discussion, where the paper positions itself against earlier work. Notice how the authors relate it, and whether you would relate it differently.",
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
    <section class="connect-stage" aria-label="Relate the paper to what you know">
      <div class="field-group"><label for="connect-attempt">Your connection</label><textarea id="connect-attempt" rows="7" placeholder="Name the work or idea you are relating this paper to, and how."></textarea></div>
      <div class="connect-tools"><button class="button button-quiet" type="button" data-action="hint">Hint</button><button class="button button-quiet" type="button" data-action="inspect">Inspect the paper</button></div>
      <p class="connect-hint" tabindex="-1" aria-live="polite" hidden><span class="connect-hint-count"></span><span class="connect-hint-text"></span></p>
      <div class="connect-revision" hidden><label for="connect-revision-text">Revise after inspection <span class="optional">Optional</span></label><textarea id="connect-revision-text" rows="7" placeholder="What connection, tension, or question seems clearer now?"></textarea></div>
    </section>
  `;
  view = {
    title: panel.querySelector("[data-stage-title]"),
    context: panel.querySelector("[data-context]"),
    prompt: panel.querySelector("[data-prompt]"),
    attempt: panel.querySelector("#connect-attempt"),
    hintButton: panel.querySelector('[data-action="hint"]'),
    inspectButton: panel.querySelector('[data-action="inspect"]'),
    hint: panel.querySelector(".connect-hint"),
    hintCount: panel.querySelector(".connect-hint-count"),
    hintText: panel.querySelector(".connect-hint-text"),
    revision: panel.querySelector(".connect-revision"),
    revisionText: panel.querySelector("#connect-revision-text"),
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
  id: "connect",
  entryLabel: "Make a connection",
  activity: (depth) => copy[depth].activity,
  initialState: () => ({ attempt: "", revision: "", hintLevel: 0, inspected: false }),
  mount,
  render,
  save,
  latestNote: (state) => state.revision.trim() || state.attempt.trim(),
};
