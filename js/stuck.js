// The "I'm stuck" panel. The reader names what is getting in the way and gets one concrete next move.
// The responses are fixed text. Nothing here generates advice or inspects the reader's writing.
const responses = {
  "I don't understand the paper": "Go back to the abstract and conclusion. Write one plain sentence saying what the paper claims, even if you are unsure of it. A rough sentence is enough to keep going.",
  "I don't understand a concept or method": "Note the term here and read on for what it does in the argument, not what it is. Look it up later, once you know whether it matters to the result.",
  "I don't know what to look for": "Try the hint on this step. If you have used them all, look for the result or figure the authors keep returning to, and ask what it is meant to show.",
  "Something doesn't make sense": "Write down exactly what does not fit, as precisely as you can. A sharp confusion is a useful note, and it may point to a limit of the paper rather than a gap in your reading.",
};

export function initStuck({ getSession }) {
  const panel = document.querySelector("#stuck-panel");
  const openButton = document.querySelector('[data-action="open-stuck"]');
  const options = panel.querySelector(".stuck-options");
  const heading = panel.querySelector("#stuck-title");
  const response = panel.querySelector("#stuck-response");
  const closeButton = panel.querySelector('[data-action="close-stuck"]');

  function reset() {
    options.hidden = false;
    heading.hidden = false;
    response.hidden = true;
    response.textContent = "";
    closeButton.textContent = "Continue thinking";
  }

  function close({ returnFocus = true } = {}) {
    panel.hidden = true;
    reset();
    if (returnFocus) openButton.focus();
  }

  openButton.addEventListener("click", () => {
    reset();
    panel.hidden = false;
    heading.focus();
  });
  closeButton.addEventListener("click", () => close());
  panel.querySelectorAll("[data-stuck-reason]").forEach((button) => {
    button.addEventListener("click", () => {
      const reason = button.dataset.stuckReason;
      const session = getSession();
      session.stuck.push({ stage: session.stage, reason });
      options.hidden = true;
      heading.hidden = true;
      response.textContent = responses[reason];
      response.hidden = false;
      response.focus();
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) close();
  });

  return { close };
}
