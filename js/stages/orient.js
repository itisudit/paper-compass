// Orient: a first pass over the paper. The reader looks for what the paper is about and jots one rough note.
// This stage owns its own copy, markup, state and behaviour. It shares nothing with the other stages.

const copy = {
  surf: {
    activity: "Get the shape",
    title: "Take a quick first pass.",
    context: "You do not need to understand the whole paper yet.",
    prompt: "Read the title, abstract, figures or tables, and conclusion. Let the paper show you its shape before you try to explain it.",
    placeholder: "What is this paper about, in a line?",
  },
  swim: {
    activity: "Find the question",
    title: "Read for the question.",
    context: "Start with the abstract and introduction. Stay with the paper before you try to state its answer.",
    prompt: "Notice what the authors are trying to find out and why it matters. You are only locating the question for now.",
    placeholder: "The question, in your own words.",
  },
  "dive-deep": {
    activity: "Find the claim",
    title: "Read for the claim and its stakes.",
    context: "Begin with the abstract, introduction, and conclusion. Let the paper state its own ambition first.",
    prompt: "Notice what the authors say is at stake and what they want the evidence to establish. Do not judge it yet.",
    placeholder: "The claim, and what is at stake.",
  },
};

let view = null;

function mount(panel) {
  panel.innerHTML = `
    <p class="eyebrow">A small prompt</p>
    <h2 class="stage-title" data-stage-title tabindex="-1"></h2>
    <p class="workspace-context" data-context></p>
    <p class="workspace-prompt" data-prompt></p>
    <div class="field-group"><label for="orient-note">A note, if you want one <span class="optional">Optional</span></label><textarea class="orient-note" id="orient-note" rows="7"></textarea></div>
  `;
  view = {
    title: panel.querySelector("[data-stage-title]"),
    context: panel.querySelector("[data-context]"),
    prompt: panel.querySelector("[data-prompt]"),
    note: panel.querySelector("#orient-note"),
  };
}

function render(ctx) {
  const mode = copy[ctx.depth];
  view.title.textContent = mode.title;
  view.context.textContent = mode.context;
  view.prompt.textContent = mode.prompt;
  view.note.placeholder = mode.placeholder;
  view.note.value = ctx.state.note;
}

function save(ctx) {
  ctx.state.note = view.note.value;
}

export default {
  id: "orient",
  entryLabel: "Continue",
  activity: (depth) => copy[depth].activity,
  initialState: () => ({ note: "" }),
  mount,
  render,
  save,
  latestNote: (state) => state.note,
};
