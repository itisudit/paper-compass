import { pdfjsLib } from "./pdfjs.js";

function textLines(content) {
  const items = content.items
    .filter((item) => item.str?.trim())
    .map((item) => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5], size: Math.hypot(item.transform[0], item.transform[1]) }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  items.forEach((item) => {
    const previous = lines.at(-1);
    if (previous && Math.abs(previous.y - item.y) < 3) { previous.text += ` ${item.text}`; previous.size = Math.max(previous.size, item.size); }
    else lines.push({ text: item.text, y: item.y, size: item.size });
  });
  return lines.map((line) => ({ ...line, text: line.text.replace(/\s+/g, " ").trim() }));
}

function findTitle(lines) {
  const candidates = lines.slice(0, 18).filter(({ text }) => text.length > 18 && text.length < 240 && /[a-z]{3}/i.test(text) && !/^(abstract|keywords?|introduction|doi\b|received|revised|accepted|copyright)/i.test(text) && !/\b(?:university|department|institute|journal|vol\.|volume|http|www\.)\b/i.test(text));
  const largest = Math.max(...lines.slice(0, 18).map((line) => line.size), 0);
  return candidates.filter((line) => line.size >= largest * 0.85).sort((a, b) => b.size - a.size || b.y - a.y)[0]?.text || "";
}

function findAuthors(lines, title) {
  const titleIndex = lines.findIndex((line) => line.text === title);
  const candidates = lines.slice(Math.max(titleIndex + 1, 0), Math.max(titleIndex + 5, 5));
  return candidates.find(({ text }) => text.length < 180 && /[A-Z][a-z]+/.test(text) && /(?:,|\band\b|\b[A-Z]\.)/.test(text) && !/\b(?:abstract|department|university|doi)\b/i.test(text))?.text || "";
}

function firstMatch(text, expression) {
  return text.match(expression)?.[1]?.trim() || "";
}

function cleanEmbeddedValue(value) {
  const cleaned = value?.trim();
  return cleaned && cleaned.length < 240 && !/^(?:untitled|unknown|none)$/i.test(cleaned) ? cleaned : "";
}

function findPublicationYear(lines) {
  const datedLines = lines.filter(({ text }) => /\b(?:19|20)\d{2}\b/.test(text) && !/\b(?:received|revised|accepted|submitted)\b/i.test(text));
  const publicationLine = datedLines.find(({ text }) => /\b(?:published|copyright|journal|proceedings|vol\.|volume|issue|doi)\b/i.test(text));
  return firstMatch((publicationLine || {}).text || "", /\b((?:19|20)\d{2})\b/) || "";
}

export async function extractPdfMetadata(file) {
  if (!file) return { fields: {}, hasText: false };
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjsLib.getDocument({ data }).promise;
  try {
    const metadata = await document.getMetadata().catch(() => ({ info: {} }));
    const pages = await Promise.all(
      Array.from({ length: Math.min(document.numPages, 2) }, (_, index) => document.getPage(index + 1)),
    );
    const lines = (await Promise.all(pages.map(async (page) => textLines(await page.getTextContent())))).flat();
    const text = lines.map((line) => line.text).join("\n");
    const info = metadata.info || {};
    if (!text.trim() && !info.Title && !info.Author) return { fields: {}, hasText: false };

    const title = cleanEmbeddedValue(info.Title) || findTitle(lines);
    const doi = firstMatch(text, /\b(10\.\d{4,9}\/[\w.()/:;-]+)\b/i).replace(/[.)\],;]+$/, "");
    const year = findPublicationYear(lines);
    const volumeIssuePages = text.match(/\b(?:vol(?:ume)?\.?\s*)(\d+)(?:\s*,?\s*(?:no\.?|issue)\s*(\d+))?(?:\s*,?\s*(?:pp?\.?\s*)?(\d+\s*[-\u2013]\s*\d+))?/i);
    const journalLine = lines.find(({ text: line }) => /\b(?:journal|proceedings|transactions|review|letters)\b/i.test(line) && line.length < 180)?.text || "";
    const journal = journalLine.replace(/\s*,?\s*\b(?:vol(?:ume)?\.?|no\.?|issue|pp?\.)\b.*$/i, "").trim();
    return {
      hasText: true,
      fields: {
        title,
        authors: cleanEmbeddedValue(info.Author) || findAuthors(lines, title),
        journal,
        year,
        doi,
        volume: volumeIssuePages?.[1] || "",
        issue: volumeIssuePages?.[2] || "",
        pages: volumeIssuePages?.[3]?.replace(/\s/g, "") || "",
      },
    };
  } finally {
    document.destroy?.();
  }
}
