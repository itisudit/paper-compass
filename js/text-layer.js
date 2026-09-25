// text-layer.js
// Shared constants and coordinate helpers for the annotation layer.
//
// Each rendered PDF page (canvas) sits in a .pdf-page-wrapper div (see pdf-viewer.js) together with
//   <div class="pdf-text-layer">        PDF.js text layer, so text can be selected
//   <svg class="pdf-annotation-layer">  highlight and underline marks
//
// Coordinates. An annotation rect {x, y, w, h} is stored as fractions (0 to 1) of the UNROTATED page
// at scale 1, measured from the top left. That frame does not change when the reader zooms, fits or
// rotates, so marks stay on their text. The two helpers below convert between that frame and the
// pixels of whichever viewport (scale and rotation) is currently on screen, using PDF.js's own
// viewport maths so rotation is handled by PDF.js rather than re-derived here.

// Color palette: subtle washes that keep the PDF legible
export const HIGHLIGHT_COLORS = {
  yellow: { label: "Yellow", fill: "rgba(255,220,0,0.35)", stroke: "rgba(200,170,0,0.5)" },
  blue:   { label: "Blue",   fill: "rgba(100,160,255,0.30)", stroke: "rgba(60,120,220,0.45)" },
  green:  { label: "Green",  fill: "rgba(80,190,130,0.30)", stroke: "rgba(40,150,90,0.45)" },
  pink:   { label: "Pink",   fill: "rgba(255,130,160,0.30)", stroke: "rgba(220,80,120,0.45)" },
};

export const DEFAULT_HIGHLIGHT_COLOR = "yellow";

function baseViewport(pdfPage) {
  return pdfPage.getViewport({ scale: 1, rotation: 0 });
}

// Pixel position on the displayed page (viewport space) -> fraction of the unrotated page.
function toPageFraction(viewport, base, x, y) {
  const [pdfX, pdfY] = viewport.convertToPdfPoint(x, y);
  const [bx, by] = base.convertToViewportPoint(pdfX, pdfY);
  return [bx / base.width, by / base.height];
}

// Fraction of the unrotated page -> pixel position on the displayed page (viewport space).
function toViewportPoint(viewport, base, fx, fy) {
  const [pdfX, pdfY] = base.convertToPdfPoint(fx * base.width, fy * base.height);
  return viewport.convertToViewportPoint(pdfX, pdfY);
}

function boxFromCorners([ax, ay], [bx, by]) {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

// Convert a DOM Range's client rects into stored page-fraction rects for one page canvas.
// `viewport` is the viewport the canvas was painted with. Returns null if nothing usable is on this page.
export function selectionRectsForPage(range, canvas, pdfPage, viewport) {
  if (!canvas || !pdfPage || !viewport) return null;
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  const base = baseViewport(pdfPage);
  const toCss = { x: viewport.width / bounds.width, y: viewport.height / bounds.height };
  const seen = new Set();
  const rects = [];
  for (const cr of Array.from(range.getClientRects())) {
    if (cr.width < 1 || cr.height < 1) continue;
    // Range.getClientRects also reports the boxes of whole elements the selection passes through.
    // A text line is short; anything taller than a tenth of the page is a container, not text.
    if (cr.height > bounds.height * 0.1) continue;
    if (cr.right < bounds.left || cr.left > bounds.right || cr.bottom < bounds.top || cr.top > bounds.bottom) continue;
    const x0 = (cr.left - bounds.left) * toCss.x, y0 = (cr.top - bounds.top) * toCss.y;
    const x1 = (cr.right - bounds.left) * toCss.x, y1 = (cr.bottom - bounds.top) * toCss.y;
    const box = boxFromCorners(toPageFraction(viewport, base, x0, y0), toPageFraction(viewport, base, x1, y1));
    // An element and its text node report the same box; keep it once so the highlight is not doubled.
    const key = [box.x, box.y, box.w, box.h].map((n) => n.toFixed(4)).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    rects.push(box);
  }
  return rects.length ? rects : null;
}

// A stored rect as a box in the pixels of the given viewport.
export function rectToViewport(rect, pdfPage, viewport) {
  const base = baseViewport(pdfPage);
  return boxFromCorners(
    toViewportPoint(viewport, base, rect.x, rect.y),
    toViewportPoint(viewport, base, rect.x + rect.w, rect.y + rect.h),
  );
}
