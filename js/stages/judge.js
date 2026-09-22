// Judge: the reader's own conclusion, drawn from everything they have written.
// Nothing here scores, rates, or evaluates the reader. The judgement belongs to them.
// This stage owns its own copy, markup, state and behaviour. It shares nothing with the other stages.

const copy = {
  surf: {
    activity: "Take a view",
    title: "What are you taking from this paper?",
    context: "Keep this light. A sentence or two is enough.",
    prompt: "Say what the paper seems to establish, then what you make of it.",
    fields: ["establishes"],
    judgementPrompt: "In a sentence or two, what is your main takeaway from this paper?",
  },
  swim: {
    activity: "Reach a conclusion",
    title: "What do you conclude?",
    context: "Bring your reading together in your own words.",
    prompt: "Say what the paper establishes, what still feels uncertain, and what changed in your understanding. Then state your own judgement.",
    fields: ["establishes", "uncertain", "changed"],
    judgementPrompt: "In a few sentences, what is your overall judgement of this paper?",
  },
  "dive-deep": {
    activity: "Form your judgement",
    title: "Where do you land?",
    context: "Draw on everything you have worked out so far. This is your conclusion, not a summary of the authors'.",
    prompt: "Work through what the paper establishes, what remains uncertain, what changed, and what would change your mind. Then state your own judgement.",
    fields: ["establishes", "uncertain", "changed", "revise"],
    judgementPrompt: "In a few sentences, what is your overall judgement of this paper?",
  },
};

// Offered after a lighter reading, so a paper that earns more attention can carry its notes forward.
const further = {
  surf: {
    lead: "If this paper deserves more attention, carry your notes forward.",
    options: [
      { depth: "swim", name: "Swim", summary: "Understand and critically evaluate the paper." },
      { depth: "dive-deep", name: "Dive Deep", summary: "Interrogate it and place it in the literature." },
    ],
  },
  swim: {
    lead: "To place this paper among the work you know, take it further.",
    options: [{ depth: "dive-deep", name: "Dive Deep", summary: "Interrogate it and place it in the literature." }],
  },
};

const fieldKeys = ["establishes", "uncertain", "changed", "revise", "judgement"];

let view = null;

function mount(panel, ctx) {
  panel.innerHTML = `
    <p class="eyebrow">A small prompt</p>
    <h2 class="stage-title" data-stage-title tabindex="-1"></h2>
    <p class="workspace-context" data-context></p>
    <p class="workspace-prompt" data-prompt></p>
    <section class="judge-stage" aria-label="Reach your own conclusion">
      <div class="earlier-thinking">
        <h3>Your earlier thinking</h3>
        <div data-earlier="intention" hidden><p class="earlier-label">Why you began</p><p class="earlier-text" data-earlier-text></p></div>
        <div data-earlier="hunch"><p class="earlier-label">Your first hunch</p><p class="earlier-text" data-earlier-text></p></div>
        <div data-earlier="latest" hidden><p class="earlier-label">Your latest note</p><p class="earlier-text" data-earlier-text></p></div>
      </div>
      <div class="field-group" data-judge-field="establishes"><label for="judge-establishes">What do you think this paper has actually established?</label><textarea id="judge-establishes" rows="4" placeholder="In your own words, not the authors'."></textarea></div>
      <div class="field-group" data-judge-field="uncertain"><label for="judge-uncertain">What are you still not convinced about?</label><textarea id="judge-uncertain" rows="4" placeholder="Anything that still feels unsettled, unsupported, or out of reach."></textarea></div>
      <div class="field-group" data-judge-field="changed"><label for="judge-changed">What changed in your understanding while reading this paper?</label><textarea id="judge-changed" rows="4" placeholder="Compare where you started with where you are now. Nothing needs to have changed."></textarea></div>
      <div class="field-group" data-judge-field="revise"><label for="judge-revise">What evidence or finding would make you revise your conclusion?</label><textarea id="judge-revise" rows="4" placeholder="What would you need to see to think differently?"></textarea></div>
      <div class="field-group judge-verdict"><label for="judge-judgement">Your judgement</label><p class="field-note" data-judgement-prompt></p><textarea id="judge-judgement" rows="7" placeholder="Your conclusion, in your own words."></textarea></div>
      <div class="judge-further" hidden><p class="judge-further-lead"></p><div class="judge-further-options"></div></div>
    </section>
  `;
  view = {
    title: panel.querySelector("[data-stage-title]"),
    context: panel.querySelector("[data-context]"),
    prompt: panel.querySelector("[data-prompt]"),
    earlier: Object.fromEntries(["intention", "hunch", "latest"].map((key) => [key, panel.querySelector(`[data-earlier="${key}"]`)])),
    fieldWrappers: panel.querySelectorAll("[data-judge-field]"),
    fields: Object.fromEntries(fieldKeys.map((key) => [key, panel.querySelector(`#judge-${key}`)])),
    judgementPrompt: panel.querySelector("[data-judgement-prompt]"),
    further: panel.querySelector(".judge-further"),
    furtherLead: panel.querySelector(".judge-further-lead"),
    furtherOptions: panel.querySelector(".judge-further-options"),
  };
  view.furtherOptions.addEventListener("click", (event) => {
    const option = event.target.closest("[data-depth]");
    if (option) ctx.changeDepth(option.dataset.depth);
  });
}

function renderEarlierThinking(ctx) {
  const { readingIntention, initialInterpretation } = ctx.app;
  const latest = ctx.latestNote();
  const entries = { intention: readingIntention, hunch: initialInterpretation, latest };
  Object.entries(entries).forEach(([key, text]) => {
    const block = view.earlier[key];
    const textElement = block.querySelector("[data-earlier-text]");
    if (key === "hunch") {
      textElement.textContent = text || "No first hunch was recorded.";
      textElement.classList.toggle("is-empty", !text);
    } else {
      textElement.textContent = text;
      block.hidden = !text;
    }
  });
}

function renderFurther(ctx) {
  const offer = further[ctx.depth];
  view.further.hidden = !offer;
  if (!offer) return;
  view.furtherLead.textContent = offer.lead;
  view.furtherOptions.replaceChildren(
    ...offer.options.map((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "judge-further-option";
      button.dataset.depth = option.depth;
      const name = document.createElement("span");
      name.className = "judge-further-name";
      name.textContent = option.name;
      const summary = document.createElement("span");
      summary.className = "judge-further-summary";
      summary.textContent = option.summary;
      button.append(name, summary);
      return button;
    }),
  );
}

function render(ctx) {
  const mode = copy[ctx.depth];
  view.title.textContent = mode.title;
  view.context.textContent = mode.context;
  view.prompt.textContent = mode.prompt;
  fieldKeys.forEach((key) => { view.fields[key].value = ctx.state[key]; });
  view.fieldWrappers.forEach((wrapper) => { wrapper.hidden = !mode.fields.includes(wrapper.dataset.judgeField); });
  view.judgementPrompt.textContent = mode.judgementPrompt;
  renderEarlierThinking(ctx);
  renderFurther(ctx);
}

function save(ctx) {
  fieldKeys.forEach((key) => { ctx.state[key] = view.fields[key].value; });
}

export default {
  id: "judge",
  entryLabel: "Form your judgement",
  activity: (depth) => copy[depth].activity,
  initialState: () => ({ establishes: "", uncertain: "", changed: "", revise: "", judgement: "" }),
  mount,
  render,
  save,
  latestNote: (state) => state.judgement.trim(),
};
