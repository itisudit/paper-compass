// Test: the reader forms an expectation of the evidence, inspects the result, and revises what it actually shows.
// This stage owns its own copy, markup, state and behaviour. It shares nothing with the other stages.

const copy = {
  swim: {
    activity: "Read the evidence",
    title: "What does the result actually show?",
    context: "Make a simple expectation, inspect the result, then revise your reading of it.",
    task: "What do you expect the evidence to show if the paper's explanation is right? Then inspect the result. Does it actually show that?",
    hints: [
      "Start by stating the pattern you would expect to see.",
      "Would you expect a difference in direction, size, or comparison? How certain would it need to look?",
      "Inspect the result itself. Notice its magnitude, direction, comparison, uncertainty, and any subgroup or variation that matters.",
    ],
  },
  "dive-deep": {
    activity: "Test the evidence",
    title: "What does the evidence establish?",
    context: "Read the result before accepting the explanation placed around it. These are lenses, not boxes to complete.",
    task: "Follow one central result. What exactly do the authors claim it shows, what does the result itself tell you, what else could it fit, and what can you not conclude from it?",
    hints: [
      "Begin by separating the result on the page from the conclusion drawn from it.",
      "What does the displayed result show in its own terms? What other explanation could still fit that pattern?",
      "Inspect the central figure, table, or estimate with its caption and nearby results text. Notice the comparison, uncertainty, variation, and where the evidence stops.",
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
    <section class="test-stage" aria-label="Read the paper's evidence">
      <div class="field-group"><label for="test-attempt">Your reading of the evidence</label><textarea id="test-attempt" rows="7" placeholder="Write a provisional note about what the evidence itself establishes."></textarea></div>
      <div class="test-tools"><button class="button button-quiet" type="button" data-action="hint">Hint</button><button class="button button-quiet" type="button" data-action="inspect">Inspect the paper</button></div>
      <p class="test-hint" tabindex="-1" aria-live="polite" hidden><span class="test-hint-count"></span><span class="test-hint-text"></span></p>
      <div class="test-revision" hidden><label for="test-revision-text">Revise after inspection <span class="optional">Optional</span></label><textarea id="test-revision-text" rows="7" placeholder="What does the result show now, and what remains outside it?"></textarea></div>
    </section>
  `;
  view = {
    title: panel.querySelector("[data-stage-title]"),
    context: panel.querySelector("[data-context]"),
    prompt: panel.querySelector("[data-prompt]"),
    attempt: panel.querySelector("#test-attempt"),
    hintButton: panel.querySelector('[data-action="hint"]'),
    inspectButton: panel.querySelector('[data-action="inspect"]'),
    hint: panel.querySelector(".test-hint"),
    hintCount: panel.querySelector(".test-hint-count"),
    hintText: panel.querySelector(".test-hint-text"),
    revision: panel.querySelector(".test-revision"),
    revisionText: panel.querySelector("#test-revision-text"),
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
  id: "test",
  entryLabel: "Look at the evidence",
  activity: (depth) => copy[depth].activity,
  initialState: () => ({ attempt: "", revision: "", hintLevel: 0, inspected: false }),
  mount,
  render,
  save,
  latestNote: (state) => state.revision.trim() || state.attempt.trim(),
};
