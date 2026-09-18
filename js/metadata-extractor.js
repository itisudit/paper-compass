import { pdfjsLib } from "./pdfjs.js";

function textLines(content) {
  const items = content.items
    .filter((item) => item.str?.trim())
    .map((item) => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5] }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  items.forEach((item) => {
    const previous = lines.at(-1);
    if (previous && Math.abs(previous.y - item.y) < 3) previous.text += ` ${item.text}`;
    else lines.push({ text: item.text, y: item.y });
  });
  return lines.map((line) => line.text.replace(/\s+/g, " ").trim());
}

function findTitle(lines) {
  return lines.slice(0, 12).find((line) => (
    line.length > 18 && line.length < 240 &&
    !/^(abstract|keywords?|introduction|doi\b|received|accepted|copyright)/i.test(line) &&
    !/\b(?:university|department|institute|journal)\b/i.test(line) &&
    /[a-z]{3}/i.test(line)
  )) || "";
}

function findAuthors(lines, title) {
  const titleIndex = lines.indexOf(title);
  const candidates = lines.slice(Math.max(titleIndex + 1, 0), Math.max(titleIndex + 5, 5));
  return candidates.find((line) => (
    line.length < 180 && /[A-Z][a-z]+/.test(line) &&
    /(?:,|\band\b|\b[A-Z]\.)/.test(line) &&
    !/\b(?:abstract|department|university|doi)\b/i.test(line)
  )) || "";
}

function firstMatch(text, expression) {
  return text.match(expression)?.[1]?.trim() || "";
}

export async function extractPdfMetadata(file) {
  if (!file) return { fields: {}, hasText: false };
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjsLib.getDocument({ data }).promise;
  try {
    const pages = await Promise.all(
      Array.from({ length: Math.min(document.numPages, 2) }, (_, index) => document.getPage(index + 1)),
    );
    const lines = (await Promise.all(pages.map(async (page) => textLines(await page.getTextContent())))).flat();
    const text = lines.join("\n");
    if (!text.trim()) return { fields: {}, hasText: false };

    const title = findTitle(lines);
    const doi = firstMatch(text, /\b(10\.\d{4,9}\/[\w.()/:;-]+)\b/i).replace(/[.)\],;]+$/, "");
    const year = firstMatch(text, /\b((?:19|20)\d{2})\b/);
    const volumeIssuePages = text.match(/\b(?:vol(?:ume)?\.?\s*)(\d+)(?:\s*,?\s*(?:no\.?|issue)\s*(\d+))?(?:\s*,?\s*(?:pp?\.?\s*)?(\d+\s*[-\u2013]\s*\d+))?/i);
    const journalLine = lines.find((line) => /\b(?:journal|proceedings|transactions|review|letters)\b/i.test(line) && line.length < 180) || "";
    const journal = journalLine.replace(/\s*,?\s*\b(?:vol(?:ume)?\.?|no\.?|issue|pp?\.)\b.*$/i, "").trim();
    return {
      hasText: true,
      fields: {
        title,
        authors: findAuthors(lines, title),
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
