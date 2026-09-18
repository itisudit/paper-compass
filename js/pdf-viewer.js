import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.mjs";

export class PdfViewer {
  constructor(root) {
    this.root = root;
    this.pagesElement = root.querySelector("#pdf-pages");
    this.statusElement = root.querySelector("#pdf-status");
    this.emptyState = root.querySelector("#pdf-empty-state");
    this.pageInput = root.querySelector("#pdf-page-number");
    this.pageTotal = root.querySelector("#pdf-page-total");
    this.controls = root.querySelectorAll("[data-pdf-action]");
    this.document = null;
    this.pageCount = 0;
    this.currentPage = 1;
    this.scale = 1.15;
    this.rotation = 0;
    this.loadVersion = 0;
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
      if (action === "zoom-in") this.changeZoom(0.2);
      if (action === "zoom-out") this.changeZoom(-0.2);
      if (action === "fit") this.fitView();
      if (action === "rotate-left") this.changeRotation(-90);
      if (action === "rotate-right") this.changeRotation(90);
    });
    this.pageInput.addEventListener("change", () => this.goToPage(Number(this.pageInput.value)));
    this.pagesElement.addEventListener("scroll", () => this.updateCurrentPageFromScroll());
  }

  async load(file) {
    const version = ++this.loadVersion;
    this.clearPages();
    this.document?.destroy();
    this.document = null;
    this.pageCount = 0;
    this.currentPage = 1;
    this.rotation = 0;
    this.scale = 1.15;

    if (!file) {
      this.showEmptyState();
      return;
    }

    this.setControlsEnabled(false);
    this.setStatus("Loading PDF.");
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const loadingTask = pdfjsLib.getDocument({ data });
      const document = await loadingTask.promise;
      if (version !== this.loadVersion) {
        document.destroy();
        return;
      }
      this.document = document;
      this.pageCount = document.numPages;
      this.pageInput.max = String(this.pageCount);
      this.pageTotal.textContent = `of ${this.pageCount}`;
      this.emptyState.hidden = true;
      this.setControlsEnabled(true);
      await this.renderAllPages();
      this.setStatus(`PDF loaded. ${this.pageCount} ${this.pageCount === 1 ? "page" : "pages"}.`);
    } catch (error) {
      if (version !== this.loadVersion) return;
      this.showEmptyState("This PDF could not be displayed.");
      this.setStatus("The PDF could not be loaded.");
      console.error("Paper Compass PDF viewer error:", error);
    }
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
    this.pagesElement.querySelectorAll(".pdf-page").forEach((page) => page.remove());
  }

  async renderAllPages() {
    if (!this.document) return;
    this.clearPages();
    const version = this.loadVersion;
    for (let pageNumber = 1; pageNumber <= this.pageCount; pageNumber += 1) {
      const page = await this.document.getPage(pageNumber);
      if (version !== this.loadVersion) return;
      const viewport = page.getViewport({ scale: this.scale, rotation: this.rotation });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: false });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.className = "pdf-page";
      canvas.dataset.pageNumber = String(pageNumber);
      canvas.setAttribute("aria-label", `PDF page ${pageNumber}`);
      this.pagesElement.append(canvas);
      await page.render({ canvasContext: context, viewport }).promise;
    }
    this.goToPage(this.currentPage, false);
  }

  goToPage(pageNumber, announce = true) {
    const nextPage = Math.min(Math.max(Number.isFinite(pageNumber) ? pageNumber : 1, 1), this.pageCount);
    if (!nextPage || !this.document) return;
    this.currentPage = nextPage;
    this.pageInput.value = String(nextPage);
    this.pagesElement.querySelector(`[data-page-number="${nextPage}"]`)?.scrollIntoView({ block: "start" });
    if (announce) this.setStatus(`Page ${nextPage} of ${this.pageCount}.`);
  }

  updateCurrentPageFromScroll() {
    if (!this.document) return;
    const pages = [...this.pagesElement.querySelectorAll(".pdf-page")];
    const closestPage = pages.reduce((closest, page) => {
      const distance = Math.abs(page.offsetTop - this.pagesElement.scrollTop);
      return distance < closest.distance ? { page, distance } : closest;
    }, { page: null, distance: Infinity }).page;
    if (!closestPage) return;
    this.currentPage = Number(closestPage.dataset.pageNumber);
    this.pageInput.value = String(this.currentPage);
  }

  async changeZoom(change) {
    this.scale = Math.min(Math.max(this.scale + change, 0.5), 2.5);
    await this.renderAllPages();
    this.setStatus(`Zoom ${Math.round(this.scale * 100)} percent.`);
  }

  async fitView() {
    if (!this.document) return;
    const firstPage = await this.document.getPage(1);
    const viewport = firstPage.getViewport({ scale: 1, rotation: this.rotation });
    this.scale = Math.min(Math.max((this.pagesElement.clientWidth - 32) / viewport.width, 0.5), 2.5);
    await this.renderAllPages();
    this.setStatus("Fit view applied.");
  }

  async changeRotation(change) {
    this.rotation = (this.rotation + change + 360) % 360;
    await this.renderAllPages();
    this.setStatus(`Rotation ${this.rotation} degrees.`);
  }

  setStatus(message) { this.statusElement.textContent = message; }
}
