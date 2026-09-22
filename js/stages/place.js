// Place: a second pass that follows how the paper tries to answer its question.
// This stage owns its own copy, markup, state and behaviour. It shares nothing with the other stages.

const copy = {
  surf: {
    activity: "Notice what matters",
    title: "Choose one thing to carry forward.",
    prompt: "After your skim, notice one question, finding, figure, or tension worth keeping in view. A rough note is enough.",
    placeholder: "The one thing you want to carry forward.",
  },
  swim: {
    activity: "Follow the approach",
    title: "See how they try to answer it.",
    prompt: "Read the methods and the first results that seem important. Notice what the authors chose to compare, measure, or test.",
    placeholder: "What they compared, measured, or tested.",
  },
  "dive-deep": {
    activity: "Trace the strategy",
    title: "See how the paper builds its case.",
    prompt: "Read across methods and results. Notice where the paper moves from question, to evidence, to interpretation. Keep an eye on what would change your mind.",
    placeholder: "Where the case moves from question, to evidence, to interpretation.",
  },
};

let view = null;

function mount(panel) {
  panel.innerHTML = `
    <p class="eyebrow">A small prompt</p>
    <h2 class="stage-title" data-stage-title tabindex="-1"></h2>
    <p class="workspace-prompt" data-prompt></p>
    <div class="field-group"><label for="place-note">A note, if you want one <span class="optional">Optional</span></label><textarea class="place-note" id="place-note" rows="7"></textarea></div>
  `;
  view = {
    title: panel.querySelector("[data-stage-title]"),
    prompt: panel.querySelector("[data-prompt]"),
    note: panel.querySelector("#place-note"),
  };
}

function render(ctx) {
  const mode = copy[ctx.depth];
  view.title.textContent = mode.title;
  view.prompt.textContent = mode.prompt;
  view.note.placeholder = mode.placeholder;
  view.note.value = ctx.state.note;
}

function save(ctx) {
  ctx.state.note = view.note.value;
}

export default {
  id: "place",
  entryLabel: "Continue",
  activity: (depth) => copy[depth].activity,
  initialState: () => ({ note: "" }),
  mount,
  render,
  save,
  latestNote: (state) => state.note,
};
