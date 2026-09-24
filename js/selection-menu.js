// selection-menu.js
// A small contextual menu that appears when the reader selects PDF text.
// Offers: Highlight (with colour sub-menu), Underline, Evidence, Cancel.
// Calls back into the PdfViewer's annotation system via provided handlers.

import { HIGHLIGHT_COLORS, DEFAULT_HIGHLIGHT_COLOR } from "./text-layer.js";

export class SelectionMenu {
  constructor({ onHighlight, onUnderline, onEvidence }) {
    this.onHighlight = onHighlight;
    this.onUnderline = onUnderline;
    this.onEvidence = onEvidence;
    this._el = null;
    this._colorEl = null;
    this._selectedColor = DEFAULT_HIGHLIGHT_COLOR;
    this._pendingRange = null;
    this._pendingText = "";
    this._build();
  }

  _build() {
    const menu = document.createElement("div");
    menu.className = "selection-menu";
    menu.setAttribute("role", "toolbar");
    menu.setAttribute("aria-label", "Annotation actions");
    menu.hidden = true;

    // Main actions row
    const actions = document.createElement("div");
    actions.className = "selection-menu-actions";

    const highlightBtn = this._btn("Highlight", "selection-menu-btn", () => this._toggleColors());
    const underlineBtn = this._btn("Underline", "selection-menu-btn", () => this._doUnderline());
    const evidenceBtn  = this._btn("Evidence",  "selection-menu-btn selection-menu-btn--evidence", () => this._doEvidence());
    const cancelBtn    = this._btn("Cancel",     "selection-menu-btn selection-menu-btn--cancel", () => this.hide());

    actions.append(highlightBtn, underlineBtn, evidenceBtn, cancelBtn);

    // Colour picker row (hidden until Highlight clicked)
    const colorRow = document.createElement("div");
    colorRow.className = "selection-menu-colors";
    colorRow.hidden = true;
    colorRow.setAttribute("role", "radiogroup");
    colorRow.setAttribute("aria-label", "Highlight colour");

    Object.entries(HIGHLIGHT_COLORS).forEach(([key, def]) => {
      const radio = document.createElement("button");
      radio.type = "button";
      radio.className = "color-swatch";
      radio.dataset.color = key;
      radio.setAttribute("aria-label", def.label);
      radio.setAttribute("aria-pressed", key === this._selectedColor ? "true" : "false");
      radio.style.setProperty("--swatch-fill", def.fill);
      radio.style.setProperty("--swatch-stroke", def.stroke);
      radio.addEventListener("click", () => {
        this._selectedColor = key;
        this._updateColorSwatches();
        this._doHighlight(key);
      });
      colorRow.append(radio);
    });

    this._colorEl = colorRow;
    menu.append(actions, colorRow);
    document.body.append(menu);
    this._el = menu;

    // Close on outside click/key
    document.addEventListener("mousedown", (e) => {
      if (!menu.hidden && !menu.contains(e.target)) this.hide();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !menu.hidden) this.hide();
    });
  }

  _btn(label, cls, handler) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = label;
    b.addEventListener("click", handler);
    return b;
  }

  _toggleColors() {
    this._colorEl.hidden = !this._colorEl.hidden;
  }

  _updateColorSwatches() {
    this._colorEl.querySelectorAll(".color-swatch").forEach((sw) => {
      sw.setAttribute("aria-pressed", sw.dataset.color === this._selectedColor ? "true" : "false");
    });
  }

  _doHighlight(color) {
    if (!this._pendingRange) return;
    this.onHighlight({ range: this._pendingRange, text: this._pendingText, color });
    this.hide();
  }

  _doUnderline() {
    if (!this._pendingRange) return;
    this.onUnderline({ range: this._pendingRange, text: this._pendingText });
    this.hide();
  }

  _doEvidence() {
    if (!this._pendingRange) return;
    this.onEvidence({ range: this._pendingRange, text: this._pendingText });
    this.hide();
  }

  // Show near the end of the selection. range must be a live Range.
  show(range, text) {
    this._pendingRange = range;
    this._pendingText = text;
    this._colorEl.hidden = true;

    const rect = range.getBoundingClientRect();
    this._el.hidden = false;

    // Position above selection, clamped to viewport
    const menuW = this._el.offsetWidth || 260;
    const menuH = this._el.offsetHeight || 44;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = rect.left + rect.width / 2 - menuW / 2;
    let top = rect.top - menuH - 8 + window.scrollY;

    left = Math.max(8, Math.min(left, vw - menuW - 8));
    if (top < window.scrollY + 8) top = rect.bottom + 8 + window.scrollY;

    this._el.style.left = `${left}px`;
    this._el.style.top = `${top}px`;

    // Focus first button for keyboard accessibility
    this._el.querySelector("button")?.focus();
  }

  hide() {
    this._el.hidden = true;
    this._colorEl.hidden = true;
    this._pendingRange = null;
    this._pendingText = "";
    window.getSelection()?.removeAllRanges();
  }

  get visible() { return !this._el.hidden; }
}
