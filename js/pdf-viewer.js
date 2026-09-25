// pdf-viewer.js — Paper Compass PDF viewer with text selection and annotation support.
// Step 10: adds PDF.js text layer, SVG annotation overlay, and hooks for selection menu.
//
// Architecture notes:
//   • Each page is wrapped in .pdf-page-wrapper (position:relative) containing:
//       <canvas class="pdf-page">          — rendered page bitmap
//       <div class="pdf-text-layer">       — PDF.js text layer (selectable text)
//       <svg class="pdf-annotation-layer"> — highlight/underline marks
//   • Annotation rects are stored as fractions of the canvas display size so they
//     survive zoom, rotate, and fit by simply being redrawn in renderAnnotationOverlay.
//   • The text layer is rebuilt whenever a page is (re-)painted, keeping it aligned.
//   • The viewer fires onSelectionChange(range, text, pageNumber) when the reader
//     finishes selecting text inside the PDF pane.

import { pdfjsLib } from "./pdfjs.js";
import { getAnnotationsForPage } from "./annotations.js";
import { HIGHLIGHT_COLORS, rectToViewport, selectionRectsForPage } from "./text-layer.js";

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const ZOOM_STEP = 0.2;
const DEFAULT_SCALE = 1.15;
const MAX_PIXEL_RATIO = 2;

export class PdfViewer {
  constructor(root) {
    this.root = root;
    this.pagesElement = root.querySelector("#pdf-pages");
    this.statusElement = root.querySelector("#pdf-status");
    this.emptyState = root.querySelector("#pdf-empty-state");
    this.pageInput = root.querySelector("#pdf-page-number");
    this.pageTotal = root.querySelector("#pdf-page-total");
    this.controls = root.querySelectorAll("[data-pdf-action]");
    this.loadingTask = null;
    this.document = null;
    this.pdfPages = [];
    this.pageCount = 0;
    this.currentPage = 1;
    this.scale = DEFAULT_SCALE;
    this.rotation = 0;
    this.autoFit = true;
    this.loadVersion = 0;
    this.layoutVersion = 0;
    this.observer = null;
    this.views = new Map();            // canvas → {page, viewport, ratio}
    this.wrappers = new Map();         // pageNumber → wrapper div
    this.renderTasks = new Set();
    this.textLayerTasks = new Set();
    this.scrollFrame = 0;
    this.resizeTimer = 0;
    // Callback set by app: (range, text, pageNumber) => void
    this.onSelectionChange = null;
    // Callback to refresh annotation overlays (set by app after session is ready)
    this.onAnnotationRemove = null;
    this.bindControls();
    this.bindSelection();
    this.setControlsEnabled(false);
    this.showEmptyState();
  }

  bindControls() {
    this.root.addEventListener("click", (event) => {
      const action = event.target.closest("[data-pdf-action]")?.dataset.pdfAction;
      if (!action) return;
      if (action === "previous") this.goToPage(this.currentPage - 1);
      if (action === "next") this.goToPage(this.currentPage + 1);
      if (action === "zoom-in") this.changeZoom(ZOOM_STEP);
      if (action === "zoom-out") this.changeZoom(-ZOOM_STEP);
      if (action === "fit") this.fitView();
      if (action === "rotate-left") this.changeRotation(-90);
      if (action === "rotate-right") this.changeRotation(90);
    });
    this.pageInput.addEventListener("change", () => this.goToPage(Number(this.pageInput.value)));
    this.pagesElement.addEventListener("scroll", () => {
      if (this.scrollFrame) return;
      this.scrollFrame = requestAnimationFrame(() => {
        this.scrollFrame = 0;
        this.updateCurrentPageFromScroll();
      });
    });
    window.addEventListener("resize", () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.refit(), 150);
    });
  }

  bindSelection() {
    // Listen for mouseup/pointerup inside the pages element and fire onSelectionChange
    this.pagesElement.addEventListener("pointerup", () => {
      // Small delay so the browser finalises the selection
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
        if (!this._selectionInPdfPages(sel)) return;
        const range = sel.getRangeAt(0);
        const text = sel.toString().trim();
        // Determine which page the selection starts on
        const pageNumber = this._pageNumberForNode(range.startContainer);
        if (this.onSelectionChange) this.onSelectionChange(range, text, pageNumber);
      }, 10);
    });
  }

  _selectionInPdfPages(sel) {
    if (!sel.rangeCount) return false;
    const range = sel.getRangeAt(0);
    return this.pagesElement.contains(range.commonAncestorContainer);
  }

  _pageNumberForNode(node) {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (el && el !== this.pagesElement) {
      if (el.dataset && el.dataset.pageNumber) return Number(el.dataset.pageNumber);
      el = el.parentElement;
    }
    return this.currentPage;
  }

  // Returns the wrapper and canvas for a given pageNumber
  wrapperForPage(pageNumber) {
    return this.wrappers.get(pageNumber) || null;
  }

  // Stored-form rects (fractions of the unrotated page) for a selection on the given page, or null.
  selectionRects(range, pageNumber) {
    const wrapper = this.wrappers.get(pageNumber);
    const canvas = wrapper?.querySelector(".pdf-page");
    const view = canvas && this.views.get(canvas);
    return view ? selectionRectsForPage(range, canvas, view.page, view.viewport) : null;
  }

  // Called by the annotation system after adding/removing an annotation to repaint the overlay.
  refreshAnnotations(pageNumber) {
    const wrapper = this.wrappers.get(pageNumber);
    if (!wrapper) return;
    const canvas = wrapper.querySelector(".pdf-page");
    const view = this.views.get(canvas);
    if (!view) return;
    renderAnnotationOverlay(wrapper, pageNumber, this.scale, view.viewport, view.page, this.onAnnotationRemove || (() => {}));
  }

  // Repaint all annotation overlays — used after zoom/rotate/fit.
  refreshAllAnnotations() {
    for (const [pageNumber, wrapper] of this.wrappers) {
      const canvas = wrapper.querySelector(".pdf-page");
      const view = this.views.get(canvas);
      if (view) {
        renderAnnotationOverlay(wrapper, pageNumber, this.scale, view.viewport, view.page, this.onAnnotationRemove || (() => {}));
      }
    }
  }

  async load(file) {
    const version = ++this.loadVersion;
    this.teardown();
    this.currentPage = 1;
    this.rotation = 0;
    this.scale = DEFAULT_SCALE;
    this.autoFit = true;

    if (!file) {
      this.showEmptyState();
      return;
    }

    this.setControlsEnabled(false);
    this.setStatus("Loading PDF.");
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const loadingTask = pdfjsLib.getDocument({ data });
      const pdf = await loadingTask.promise;
      if (version !== this.loadVersion) {
        loadingTask.destroy();
        return;
      }
      const pdfPages = await Promise.all(Array.from({ length: pdf.numPages }, (_, index) => pdf.getPage(index + 1)));
      if (version !== this.loadVersion) {
        loadingTask.destroy();
        return;
      }
      this.loadingTask = loadingTask;
      this.document = pdf;
      this.pdfPages = pdfPages;
      this.pageCount = pdf.numPages;
      this.pageInput.max = String(this.pageCount);
      this.pageTotal.textContent = `of ${this.pageCount}`;
      this.emptyState.hidden = true;
      this.setControlsEnabled(true);
      this.fitView(false);
      this.setStatus(`PDF loaded. ${this.pageCount} ${this.pageCount === 1 ? "page" : "pages"}.`);
    } catch (error) {
      if (version !== this.loadVersion) return;
      this.showEmptyState("This PDF could not be displayed.");
      this.setStatus("The PDF could not be loaded.");
      console.error("Paper Compass PDF viewer error:", error);
    }
  }

  teardown() {
    this.clearPages();
    this.loadingTask?.destroy();
    this.loadingTask = null;
    this.document = null;
    this.pdfPages = [];
    this.pageCount = 0;
  }

  showEmptyState(message = "No PDF added yet.") {
    this.clearPages();
    this.emptyState.hidden = false;
    this.emptyState.querySelector("p").textContent = message;
    this.pageInput.value = "1";
    this.pageInput.max = "1";
    this.pageTotal.textContent = "of 0";
    this.setControlsEnabled(false);
  }

  setControlsEnabled(enabled) {
    this.controls.forEach((control) => { control.disabled = !enabled; });
    this.pageInput.disabled = !enabled;
  }

  clearPages() {
    this.observer?.disconnect();
    this.observer = null;
    this.renderTasks.forEach((task) => task.cancel());
    this.renderTasks.clear();
    // Cancel any in-flight text layer tasks
    this.textLayerTasks.forEach((task) => { try { task.cancel?.(); } catch(_) {} });
    this.textLayerTasks.clear();
    this.views.clear();
    this.wrappers.clear();
    this.pagesElement.querySelectorAll(".pdf-page-wrapper").forEach((w) => w.remove());
    // Also remove any bare canvases from previous version without wrappers
    this.pagesElement.querySelectorAll(".pdf-page").forEach((c) => c.remove());
  }

  pageTop(page) {
    return page.offsetTop - parseFloat(getComputedStyle(this.pagesElement).paddingTop || "0");
  }

  captureAnchor() {
    // Look in wrappers first (step 10), fall back to canvas
    const wrapperEl = this.pagesElement.querySelector(`[data-page-number="${this.currentPage}"]`);
    if (!wrapperEl || !wrapperEl.offsetHeight) return { page: this.currentPage, fraction: 0 };
    return { page: this.currentPage, fraction: (this.pagesElement.scrollTop - this.pageTop(wrapperEl)) / wrapperEl.offsetHeight };
  }

  restoreAnchor({ page, fraction }) {
    const target = this.pagesElement.querySelector(`[data-page-number="${page}"]`);
    if (target) this.pagesElement.scrollTop = this.pageTop(target) + fraction * target.offsetHeight;
  }

  // Step 12: the reading position as {page, fraction}, or null while no PDF is loaded (so a session
  // resumed without its PDF keeps the position it was saved with). While the pane is hidden the scroll
  // metrics are meaningless, so the last known page is reported rather than re-derived from them.
  currentAnchor() {
    if (!this.document) return null;
    if (this.pagesElement.clientHeight) this.updateCurrentPageFromScroll();
    const { page, fraction } = this.captureAnchor();
    return { page, fraction: Number.isFinite(fraction) ? fraction : 0 };
  }

  // Step 12: scroll back to a saved position. The page is clamped to the document that is loaded now.
  restoreView({ page, fraction = 0 }) {
    if (!this.document) return;
    const target = Math.min(Math.max(Number.isInteger(page) ? page : 1, 1), this.pageCount);
    this.currentPage = target;
    this.pageInput.value = String(target);
    this.restoreAnchor({ page: target, fraction });
  }

  layoutPages() {
    if (!this.document) return;
    const version = ++this.layoutVersion;
    const anchor = this.captureAnchor();
    this.clearPages();
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const fragment = document.createDocumentFragment();
    const wrappers = this.pdfPages.map((page, index) => {
      const pageNumber = index + 1;
      const viewport = page.getViewport({ scale: this.scale, rotation: this.rotation });

      // Wrapper div — carries data-page-number for scroll tracking & anchor
      const wrapper = document.createElement("div");
      wrapper.className = "pdf-page-wrapper";
      wrapper.dataset.pageNumber = String(pageNumber);
      wrapper.style.width = `${Math.floor(viewport.width)}px`;
      wrapper.style.height = `${Math.floor(viewport.height)}px`;
      wrapper.style.margin = "0 auto 1rem";
      wrapper.style.position = "relative";

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.className = "pdf-page";
      canvas.setAttribute("aria-label", `PDF page ${pageNumber}`);

      wrapper.append(canvas);
      this.views.set(canvas, { page, viewport, ratio });
      this.wrappers.set(pageNumber, wrapper);
      fragment.append(wrapper);
      return wrapper;
    });
    this.pagesElement.append(fragment);

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const wrapper = entry.target;
          const canvas = wrapper.querySelector(".pdf-page");
          if (canvas) this.paintPage(canvas, version, wrapper);
        }
      });
    }, { root: this.pagesElement, rootMargin: "100% 0px" });
    wrappers.forEach((w) => this.observer.observe(w));
    this.restoreAnchor(anchor);
  }

  async paintPage(canvas, version, wrapper) {
    const view = this.views.get(canvas);
    if (!view || canvas.dataset.painted || version !== this.layoutVersion) return;
    canvas.dataset.painted = "true";
    const { page, viewport, ratio } = view;
    const pageNumber = Number(wrapper.dataset.pageNumber);

    const task = page.render({
      canvasContext: canvas.getContext("2d", { alpha: false }),
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    });
    this.renderTasks.add(task);
    try {
      await task.promise;
      if (version !== this.layoutVersion) return;
      // Build text layer after canvas renders
      await this._buildTextLayer(wrapper, page, viewport, version);
      if (version !== this.layoutVersion) return;
      // Draw annotation overlay
      const onRemove = this.onAnnotationRemove || (() => {});
      renderAnnotationOverlay(wrapper, pageNumber, this.scale, viewport, page, onRemove);
    } catch (error) {
      if (error?.name !== "RenderingCancelledException") console.error("Paper Compass PDF page error:", error);
    } finally {
      this.renderTasks.delete(task);
    }
  }

  async _buildTextLayer(wrapper, pdfPage, viewport, layoutVersion) {
    // Remove stale text layer
    wrapper.querySelector(".pdf-text-layer")?.remove();

    const div = document.createElement("div");
    div.className = "pdf-text-layer";
    // PDF.js 6 sizes and positions the layer from these CSS variables (the stylesheet in
    // annotations.css reads them too), so they must be set before the layer is built.
    div.style.setProperty("--total-scale-factor", String(viewport.scale));
    div.style.setProperty("--scale-round-x", "1px");
    div.style.setProperty("--scale-round-y", "1px");
    wrapper.append(div);

    try {
      const textContent = await pdfPage.getTextContent();
      if (layoutVersion !== this.layoutVersion) return;
      // renderTextLayer was removed from PDF.js; the TextLayer class replaces it.
      const textLayer = new pdfjsLib.TextLayer({ textContentSource: textContent, container: div, viewport });
      this.textLayerTasks.add(textLayer);
      await textLayer.render();
      this.textLayerTasks.delete(textLayer);
    } catch (err) {
      if (err?.name !== "RenderingCancelledException") {
        console.warn("Paper Compass text layer:", err);
      }
    }
  }

  goToPage(pageNumber, announce = true) {
    const nextPage = Math.min(Math.max(Number.isFinite(pageNumber) ? pageNumber : 1, 1), this.pageCount);
    const target = this.pagesElement.querySelector(`[data-page-number="${nextPage}"]`);
    if (!nextPage || !this.document || !target) return;
    this.currentPage = nextPage;
    this.pageInput.value = String(nextPage);
    this.pagesElement.scrollTop = this.pageTop(target);
    if (announce) this.setStatus(`Page ${nextPage} of ${this.pageCount}.`);
  }

  updateCurrentPageFromScroll() {
    if (!this.document) return;
    const marker = this.pagesElement.scrollTop + this.pagesElement.clientHeight * 0.3;
    let current = 1;
    for (const wrapper of this.pagesElement.querySelectorAll(".pdf-page-wrapper")) {
      if (this.pageTop(wrapper) > marker) break;
      current = Number(wrapper.dataset.pageNumber);
    }
    this.currentPage = current;
    this.pageInput.value = String(current);
  }

  changeZoom(change) {
    if (!this.document) return;
    this.autoFit = false;
    this.scale = Math.min(Math.max(this.scale + change, MIN_SCALE), MAX_SCALE);
    this.layoutPages();
    this.setStatus(`Zoom ${Math.round(this.scale * 100)} percent.`);
  }

  fitView(announce = true) {
    if (!this.document) return;
    this.autoFit = true;
    const width = this.pagesElement.clientWidth;
    if (width) {
      const style = getComputedStyle(this.pagesElement);
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const natural = this.pdfPages[0].getViewport({ scale: 1, rotation: this.rotation }).width;
      this.scale = Math.min(Math.max((width - padding) / natural, MIN_SCALE), MAX_SCALE);
    } else {
      this.scale = DEFAULT_SCALE;
    }
    this.layoutPages();
    if (announce) this.setStatus("Fit view applied.");
  }

  refit() {
    if (this.document && this.autoFit && this.pagesElement.clientWidth) this.fitView(false);
  }

  changeRotation(change) {
    if (!this.document) return;
    this.rotation = (this.rotation + change + 360) % 360;
    if (this.autoFit) this.fitView(false);
    else this.layoutPages();
    this.setStatus(`Rotation ${this.rotation} degrees.`);
  }

  setStatus(message) { this.statusElement.textContent = message; }
}

// ---- Annotation overlay renderer (local to this module) ----
// Draws an SVG overlay on top of the page wrapper showing all annotations for that page.

function renderAnnotationOverlay(wrapper, pageNumber, scale, viewport, pdfPage, onRemove) {
  let svg = wrapper.querySelector(".pdf-annotation-layer");
  if (!svg) {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("pdf-annotation-layer");
    svg.setAttribute("aria-hidden", "true");
    // Insert before text layer so clicks pass through to text
    const textLayer = wrapper.querySelector(".pdf-text-layer");
    if (textLayer) wrapper.insertBefore(svg, textLayer);
    else wrapper.append(svg);
  }

  const displayW = Math.floor(viewport.width);
  const displayH = Math.floor(viewport.height);
  svg.style.width = `${displayW}px`;
  svg.style.height = `${displayH}px`;
  svg.setAttribute("viewBox", `0 0 ${displayW} ${displayH}`);
  svg.innerHTML = "";

  const anns = getAnnotationsForPage(pageNumber);
  for (const ann of anns) {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.dataset.annotationId = ann.id;
    group.setAttribute("aria-label", `${ann.type === "highlight" ? "Highlight" : "Underline"}: ${ann.text.slice(0, 60)}`);

    for (const rect of ann.rects) {
      // Rects are stored as fractions of the unrotated page; rectToViewport maps them onto the
      // viewport currently on screen, whatever its zoom or rotation.
      const { x: px, y: py, w: pw, h: ph } = rectToViewport(rect, pdfPage, viewport);

      if (ann.type === "highlight") {
        const color = HIGHLIGHT_COLORS[ann.color] || HIGHLIGHT_COLORS.yellow;
        const el = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        el.setAttribute("x", px);
        el.setAttribute("y", py);
        el.setAttribute("width", pw);
        el.setAttribute("height", ph);
        el.setAttribute("fill", color.fill);
        el.setAttribute("stroke", color.stroke);
        el.setAttribute("stroke-width", "0.5");
        group.append(el);
      } else if (ann.type === "underline") {
        // The underline runs along the bottom edge of the text in the page's own frame, so it is
        // mapped from the stored rect's bottom edge (a zero-height rect) and follows any rotation.
        const edge = rectToViewport({ x: rect.x, y: rect.y + rect.h, w: rect.w, h: 0 }, pdfPage, viewport);
        const el = document.createElementNS("http://www.w3.org/2000/svg", "line");
        el.setAttribute("x1", edge.x);
        el.setAttribute("y1", edge.y);
        el.setAttribute("x2", edge.x + edge.w);
        el.setAttribute("y2", edge.y + edge.h);
        el.setAttribute("stroke", "var(--accent-dark)");
        el.setAttribute("stroke-width", "1.5");
        group.append(el);
      }
    }

    // Remove button using foreignObject
    if (ann.rects.length) {
      const first = rectToViewport(ann.rects[0], pdfPage, viewport);
      const bx = first.x + first.w - 16;
      const by = first.y - 14;
      const fo = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
      fo.setAttribute("x", Math.max(0, bx));
      fo.setAttribute("y", Math.max(0, by));
      fo.setAttribute("width", "16");
      fo.setAttribute("height", "16");
      fo.style.overflow = "visible";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "annotation-remove";
      btn.setAttribute("aria-label", `Remove ${ann.type === "highlight" ? "highlight" : "underline"}: ${ann.text.slice(0, 40)}`);
      btn.title = `Remove ${ann.type}`;
      btn.textContent = "×";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onRemove(ann.id, pageNumber);
      });
      fo.append(btn);
      group.append(fo);
    }

    svg.append(group);
  }
}
