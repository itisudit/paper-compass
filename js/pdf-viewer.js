import { pdfjsLib } from "./pdfjs.js";

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const ZOOM_STEP = 0.2;
const DEFAULT_SCALE = 1.15;
const MAX_PIXEL_RATIO = 2;

// Pages are laid out as sized canvases straight away and painted only when they come near the view,
// so a long paper opens quickly and zooming does not repaint pages the reader is not looking at.
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
    this.views = new Map();
    this.renderTasks = new Set();
    this.scrollFrame = 0;
    this.resizeTimer = 0;
    this.bindControls();
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
    // In pdf.js the loading task owns the document and its worker, so it is what gets destroyed.
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
    this.views.clear();
    this.pagesElement.querySelectorAll(".pdf-page").forEach((page) => page.remove());
  }

  // Distance from the top of the scroll area to the top of a page, measured inside the scroll area.
  pageTop(page) {
    return page.offsetTop - parseFloat(getComputedStyle(this.pagesElement).paddingTop || "0");
  }

  captureAnchor() {
    const page = this.pagesElement.querySelector(`[data-page-number="${this.currentPage}"]`);
    if (!page || !page.offsetHeight) return { page: this.currentPage, fraction: 0 };
    return { page: this.currentPage, fraction: (this.pagesElement.scrollTop - this.pageTop(page)) / page.offsetHeight };
  }

  restoreAnchor({ page, fraction }) {
    const target = this.pagesElement.querySelector(`[data-page-number="${page}"]`);
    if (target) this.pagesElement.scrollTop = this.pageTop(target) + fraction * target.offsetHeight;
  }

  layoutPages() {
    if (!this.document) return;
    const version = ++this.layoutVersion;
    const anchor = this.captureAnchor();
    this.clearPages();
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const fragment = document.createDocumentFragment();
    const canvases = this.pdfPages.map((page, index) => {
      const viewport = page.getViewport({ scale: this.scale, rotation: this.rotation });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.className = "pdf-page";
      canvas.dataset.pageNumber = String(index + 1);
      canvas.setAttribute("aria-label", `PDF page ${index + 1}`);
      this.views.set(canvas, { page, viewport, ratio });
      fragment.append(canvas);
      return canvas;
    });
    this.pagesElement.append(fragment);
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { if (entry.isIntersecting) this.paintPage(entry.target, version); });
    }, { root: this.pagesElement, rootMargin: "100% 0px" });
    canvases.forEach((canvas) => this.observer.observe(canvas));
    this.restoreAnchor(anchor);
  }

  async paintPage(canvas, version) {
    const view = this.views.get(canvas);
    if (!view || canvas.dataset.painted || version !== this.layoutVersion) return;
    canvas.dataset.painted = "true";
    const { page, viewport, ratio } = view;
    const task = page.render({
      canvasContext: canvas.getContext("2d", { alpha: false }),
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    });
    this.renderTasks.add(task);
    try {
      await task.promise;
    } catch (error) {
      if (error?.name !== "RenderingCancelledException") console.error("Paper Compass PDF page error:", error);
    } finally {
      this.renderTasks.delete(task);
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
    for (const page of this.pagesElement.querySelectorAll(".pdf-page")) {
      if (this.pageTop(page) > marker) break;
      current = Number(page.dataset.pageNumber);
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

  // Keeps the page filling the pane after a resize or after the workspace is shown again.
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
