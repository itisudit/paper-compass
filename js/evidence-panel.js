// evidence-panel.js
// Renders the evidence list in the thinking pane.
// Each evidence item shows its text, page, and connections to stages.
// The reader can connect to / disconnect from stages, and remove evidence items.

import { getAllEvidence, addConnection, removeConnection, removeEvidence } from "./annotations.js";
import { pathFor } from "./depths.js";
import { appState } from "./state.js";

// Human-readable stage labels
const STAGE_LABELS = {
  orient:      "Orient",
  place:       "Place",
  reconstruct: "Reconstruct",
  appraise:    "Appraise",
  test:        "Test",
  connect:     "Connect",
  judge:       "Judge",
};

let _container = null;
let _onChanged = null; // called after any mutation so caller can re-render if needed

export function initEvidencePanel(container, { onChanged } = {}) {
  _container = container;
  _onChanged = onChanged || (() => {});
  render();
}

export function renderEvidencePanel() {
  if (_container) render();
}

function render() {
  const items = getAllEvidence();
  const depth = appState.selectedDepth;
  const path = depth ? pathFor(depth) : [];

  if (!items.length) {
    _container.innerHTML = `
      <p class="evidence-empty">No evidence yet. Select text in the PDF and choose <em>Evidence</em> to begin.</p>
    `;
    return;
  }

  _container.innerHTML = "";

  items.forEach((ev) => {
    const card = document.createElement("div");
    card.className = "evidence-card";
    card.dataset.evidenceId = ev.id;

    // Quoted passage
    const quote = document.createElement("blockquote");
    quote.className = "evidence-quote";
    quote.textContent = ev.text.length > 200 ? ev.text.slice(0, 200) + "…" : ev.text;

    const meta = document.createElement("p");
    meta.className = "evidence-meta";
    meta.textContent = `Page ${ev.pageNumber}`;

    // Connections
    const connSection = document.createElement("div");
    connSection.className = "evidence-connections";

    if (path.length) {
      const connLabel = document.createElement("p");
      connLabel.className = "evidence-connect-label";
      connLabel.textContent = "Connect to:";
      connSection.append(connLabel);

      const chips = document.createElement("div");
      chips.className = "evidence-chips";

      path.forEach((stageId) => {
        const connected = ev.connections.includes(stageId);
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = `evidence-chip${connected ? " is-connected" : ""}`;
        chip.textContent = STAGE_LABELS[stageId] || stageId;
        chip.setAttribute("aria-pressed", connected ? "true" : "false");
        chip.setAttribute("aria-label", `${connected ? "Disconnect from" : "Connect to"} ${STAGE_LABELS[stageId] || stageId}`);
        chip.addEventListener("click", () => {
          if (connected) {
            removeConnection(ev.id, stageId);
          } else {
            addConnection(ev.id, stageId);
          }
          _onChanged();
          render();
        });
        chips.append(chip);
      });
      connSection.append(chips);
    }

    // Remove evidence button
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "evidence-remove";
    removeBtn.textContent = "Remove evidence";
    removeBtn.setAttribute("aria-label", `Remove evidence: ${ev.text.slice(0, 40)}`);
    removeBtn.addEventListener("click", () => {
      removeEvidence(ev.id);
      _onChanged();
      render();
    });

    card.append(quote, meta, connSection, removeBtn);
    _container.append(card);
  });
}
