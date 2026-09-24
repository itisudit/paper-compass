// text-layer.js
// Manages the PDF.js text layer and the SVG annotation overlay for a single page wrapper.
//
// Each rendered PDF page (canvas) is wrapped in a .pdf-page-wrapper div. Inside that wrapper:
//   <canvas class="pdf-page">           — existing rendered page
//   <div class="pdf-text-layer">        — PDF.js text layer for text selection
//   <svg class="pdf-annotation-layer">  — SVG overlay for highlight/underline marks
//
// Rects stored in annotation state use PDF user-space fractions (0–1 of the natural
// viewport at scale=1, unrotated). When drawing on screen we transform by current scale
// and rotation so marks stay aligned through zoom/rotate/fit.

import { pdfjsLib } from "./pdfjs.js";
import { getAnnotationsForPage, removeAnnotation } from "./annotations.js";

// Color palette: subtle washes that keep the PDF legible
export const HIGHLIGHT_COLORS = {
  yellow: { label: "Yellow", fill: "rgba(255,220,0,0.35)", stroke: "rgba(200,170,0,0.5)" },
  blue:   { label: "Blue",   fill: "rgba(100,160,255,0.30)", stroke: "rgba(60,120,220,0.45)" },
  green:  { label: "Green",  fill: "rgba(80,190,130,0.30)", stroke: "rgba(40,150,90,0.45)" },
  pink:   { label: "Pink",   fill: "rgba(255,130,160,0.30)", stroke: "rgba(220,80,120,0.45)" },
};

export const DEFAULT_HIGHLIGHT_COLOR = "yellow";

// Convert a DOM Range's client rects to PDF user-space fractional rects for a given page canvas.
// Returns null if the selection has no usable rects within this page.
export function selectionRectsForPage(range, canvas, pdfPage, scale, rotation) {
  if (!canvas || !pdfPage) return null;
  const canvasBounds = canvas.getBoundingClientRect();
  if (!canvasBounds.width || !canvasBounds.height) return null;

  // Natural (scale=1, rotation=0) viewport dimensions
  const naturalVp = pdfPage.getViewport({ scale: 1, rotation: 0 });
  const displayVp = pdfPage.getViewport({ scale, rotation });

  const clientRects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
  const rects = [];

  for (const cr of clientRects) {
    // Is this rect within our canvas bounds (with a little slack)?
    const SLACK = 8;
    if (
      cr.right < canvasBounds.left - SLACK ||
      cr.left > canvasBounds.right + SLACK ||
      cr.bottom < canvasBounds.top - SLACK ||
      cr.top > canvasBounds.bottom + SLACK
    ) continue;

    // Convert from client coords → canvas-local display coords
    const lx = cr.left - canvasBounds.left;
    const ly = cr.top - canvasBounds.top;
    const lw = cr.width;
    const lh = cr.height;

    // Convert display pixels → fraction of displayed page dimensions
    // Then scale into PDF user-space fractions using natural viewport
    const fx = lx / canvasBounds.width;
    const fy = ly / canvasBounds.height;
    const fw = lw / canvasBounds.width;
    const fh = lh / canvasBounds.height;

    // We store in terms of the natural (scale=1) viewport so marks survive zoom/rotate
    // Map fraction of displayed → fraction of natural via scale ratio
    const scaleRatio = (displayVp.width / naturalVp.width);
    const nx = fx / scaleRatio;
    const ny = fy / scaleRatio;
    const nw = fw / scaleRatio;
    const nh = fh / scaleRatio;

    rects.push({ x: nx, y: ny, w: nw, h: nh });
  }

  return rects.length ? rects : null;
}

// Build or update the SVG annotation overlay for a page given current scale/rotation.
export function renderAnnotationOverlay(wrapper, pageNumber, scale, rotation, pdfPage, onRemove) {
  let svg = wrapper.querySelector(".pdf-annotation-layer");
  if (!svg) {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("pdf-annotation-layer");
    svg.setAttribute("aria-hidden", "true");
    wrapper.append(svg);
  }

  const canvas = wrapper.querySelector(".pdf-page");
  const displayW = parseFloat(canvas.style.width) || canvas.offsetWidth;
  const displayH = canvas.offsetHeight || canvas.height;
  svg.style.width = `${displayW}px`;
  svg.style.height = `${displayH}px`;
  svg.setAttribute("viewBox", `0 0 ${displayW} ${displayH}`);

  // Clear existing marks
  svg.innerHTML = "";

  const naturalVp = pdfPage.getViewport({ scale: 1, rotation: 0 });
  const scaleRatio = scale * (displayW / (naturalVp.width * scale)) || scale / 1;

  // Use canvas display dimensions as reference
  const W = displayW;
  const H = displayH;

  const anns = getAnnotationsForPage(pageNumber);
  for (const ann of anns) {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.dataset.annotationId = ann.id;
    group.setAttribute("role", "img");
    group.setAttribute("aria-label", `${ann.type === "highlight" ? "Highlight" : "Underline"}: ${ann.text.slice(0, 60)}`);

    for (const rect of ann.rects) {
      // rect coords are fractions of natural viewport (scale=1)
      // Convert to display pixel positions
      const px = rect.x * W;
      const py = rect.y * H;
      const pw = rect.w * W;
      const ph = rect.h * H;

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
        const el = document.createElementNS("http://www.w3.org/2000/svg", "line");
        el.setAttribute("x1", px);
        el.setAttribute("y1", py + ph);
        el.setAttribute("x2", px + pw);
        el.setAttribute("y2", py + ph);
        el.setAttribute("stroke", "var(--accent-dark)");
        el.setAttribute("stroke-width", "1.5");
        group.append(el);
      }
    }

    // Remove button (small ×)
    const btn = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
    const firstRect = ann.rects[0];
    const bx = firstRect.x * W;
    const by = firstRect.y * H;
    btn.setAttribute("x", bx + firstRect.w * W - 14);
    btn.setAttribute("y", by - 12);
    btn.setAttribute("width", "14");
    btn.setAttribute("height", "14");
    btn.style.overflow = "visible";
    const btnEl = document.createElement("button");
    btnEl.className = "annotation-remove";
    btnEl.type = "button";
    btnEl.title = `Remove ${ann.type}`;
    btnEl.setAttribute("aria-label", `Remove ${ann.type}: ${ann.text.slice(0, 40)}`);
    btnEl.textContent = "×";
    btnEl.addEventListener("click", (e) => {
      e.stopPropagation();
      onRemove(ann.id);
    });
    btn.append(btnEl);
    group.append(btn);

    svg.append(group);
  }
}

// Build the PDF.js text layer div and render text into it.
// Returns the div (already appended to wrapper).
export async function buildTextLayer(wrapper, pdfPage, viewport) {
  // Remove any previous text layer
  wrapper.querySelector(".pdf-text-layer")?.remove();

  const div = document.createElement("div");
  div.className = "pdf-text-layer";
  div.style.width = `${Math.floor(viewport.width)}px`;
  div.style.height = `${Math.floor(viewport.height)}px`;
  wrapper.append(div);

  try {
    const textContent = await pdfPage.getTextContent();
    const renderParams = {
      textContentSource: textContent,
      container: div,
      viewport,
    };
    const renderTask = pdfjsLib.renderTextLayer(renderParams);
    await renderTask.promise;
  } catch (err) {
    if (err?.name !== "RenderingCancelledException") {
      console.warn("Paper Compass text layer error:", err);
    }
  }

  return div;
}
