import { pdfjsLib } from "./pdfjs.js";

// Metadata extraction pipeline, in priority order:
//   1. Embedded PDF metadata (info dictionary, then XMP), treated as candidates and sanity-checked.
//   2. The first two pages read as positioned lines (position, font size), not one text blob.
//   3. Candidate lines generated per field from those positioned lines.
//   4. Candidates scored; the best one is used only if its score clears a threshold.
//   5. Anything without a confident candidate is left blank for manual entry.
//
// Known limitation: pdf.js does not expose a font's bold/weight or real family through
// getTextContent for most embedded fonts (it reports internal aliases such as "g_d0_f2"
// rather than the PostScript name), so boldness is used only as a minor, best-effort signal.
// Font SIZE and position are the reliable signals this module relies on.

const PAGES_TO_READ = 2;
const FIRST_PAGE_WINDOW = 20;
const TITLE_MIN_SCORE = 5;
const AUTHOR_WINDOW = 6;
const MAX_TITLE_MERGE_LINES = 3;

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const DOI_ANYWHERE_RE = /\b10\.\d{4,9}\/[^\s"'<>]+/i;
const SECTION_LABEL_RE = /^(abstract|keywords?|index terms|introduction|1\.\s|i\.\s|contents|table of contents)\b/i;
const NON_TITLE_START_RE = /^(received|revised|accepted|submitted|published|copyright|\u00a9|doi\b|issn\b|isbn\b|corresponding author|available online|open access|article history|vol\.?\s*\d|volume\s*\d)/i;
const AFFILIATION_RE = /\b(university|department|institute|faculty|school of|laboratory|division of)\b/i;
const NAME_TOKEN = "[A-Z][A-Za-z\\u00C0-\\u017F'\u2019-]+"; // a capitalized word of 2+ letters, e.g. "Smith"
const INITIAL_TOKEN = "[A-Z]\\.(?:\\s?[A-Z]\\.)*"; // one or more initials, e.g. "J." or "J.R." or "J. R."
// A name unit is an initials-plus-surname pair in either order, or two capitalized words (a given
// and family name). This is what lets "C. Lee" and "D. Patel" count as names, not just "Jane Smith".
const NAME_UNIT_RE = `(?:${INITIAL_TOKEN}\\s*${NAME_TOKEN}|${NAME_TOKEN}\\s+${INITIAL_TOKEN}|${NAME_TOKEN}\\s+${NAME_TOKEN})`;
const AUTHOR_LINE_NAME_RE = new RegExp(NAME_UNIT_RE, "g");
const PROSE_CONNECTOR_RE = /\b(the|of|in|a|an|for|with|on|to|from|by|at|that|this|these|those|into|under|over|across|through|between|during|after|before|without|among|toward|towards|via|amid|versus|vs\.?)\b/i;
const SENTENCE_VERB_RE = /\b(is|are|was|were|shows?|found|presents?|proposes?|examines?|analyz\w*|studies|suggests?)\b/i;
const GENERIC_EMBEDDED_RE = /^(untitled.*|unknown.*|none|n\/a|n\.a\.?|anonymous|administrator|author|owner|user|test|sample|draft|document\s*\d*|microsoft word.*|\s*)$/i;
const FILENAME_LIKE_RE = /\.(docx?|tex|indd|pdf|rtf)$/i;
const JOURNAL_WORD_RE = /\b(journal|proceedings|transactions|review|letters|bulletin|annals|reports?|quarterly|magazine)\b/i;

// ---------- text and line utilities ----------

function normalizeWhitespace(text) {
  return text
    .replace(/\u00AD/g, "") // soft hyphen
    .replace(/[\u00A0\u2007\u202F]/g, " ") // non-breaking spaces
    .replace(/\s+/g, " ")
    .trim();
}

async function readPageLines(page, pageNumber) {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items = content.items
    .filter((item) => item.str && item.str.trim())
    .map((item) => ({
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
      size: Math.hypot(item.transform[0], item.transform[1]),
      bold: /bold/i.test(item.fontName || ""),
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const lines = [];
  items.forEach((item) => {
    const previous = lines.at(-1);
    if (previous && Math.abs(previous.y - item.y) < Math.max(2, previous.size * 0.4)) {
      const needsSpace = !/\s$/.test(previous.text) && !/^\s/.test(item.text);
      previous.text += (needsSpace ? " " : "") + item.text;
      previous.size = Math.max(previous.size, item.size);
      previous.maxX = Math.max(previous.maxX, item.x);
      previous.bold = previous.bold || item.bold;
    } else {
      lines.push({ text: item.text, y: item.y, size: item.size, minX: item.x, maxX: item.x, bold: item.bold, page: pageNumber });
    }
  });

  return lines
    .map((line, index) => ({ ...line, text: normalizeWhitespace(line.text), index, width: viewport.width }))
    .filter((line) => line.text);
}

// Lines whose normalized text repeats verbatim across pages are running headers or footers,
// not part of the paper's own title or author block.
function findRepeatedLineTexts(pages) {
  if (pages.length < 2) return new Set();
  const normalize = (text) => text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
  const pageSets = pages.map((page) => new Set(page.lines.map((line) => normalize(line.text))));
  const repeated = new Set();
  pageSets[0].forEach((text) => {
    if (text.length > 3 && pageSets.slice(1).every((set) => set.has(text))) repeated.add(text);
  });
  return repeated;
}

// ---------- shared line classifiers ----------

const NAME_SEGMENT_RE = new RegExp(`^${NAME_UNIT_RE}$`);

// A person-name list ("Jane Doe, John Smith") looks very different from a title or a sentence:
// splitting it on its separators (",", "and", "&") leaves segments that are each, in full, a single
// name (an initials-plus-surname pair, in either order, or two capitalized words). A title made of
// title-case nouns joined by "and" fails this: at least one segment has a leftover word a name
// pattern cannot absorb, e.g. "Farm Household Resilience" is not a two-word name. Requiring every
// segment to match end-to-end, rather than just contain a name-shaped substring, is what tells the
// two apart; a token-ratio check alone was fooled by exactly this kind of title.
function looksLikeAuthorLine(text) {
  if (EMAIL_RE.test(text) || DOI_ANYWHERE_RE.test(text)) return false;
  if (SENTENCE_VERB_RE.test(text)) return false;
  if (PROSE_CONNECTOR_RE.test(text)) return false;
  if (text.length >= 220) return false;
  const segments = text
    .split(/\s*(?:,|;|\band\b|&)\s*/i)
    .map((segment) => segment.replace(/[\d*\u2020\u2021\u00a7\u00b6#]{1,3}$/, "").trim())
    .filter(Boolean);
  if (!segments.length || segments.length > 12) return false;
  return segments.every((segment) => NAME_SEGMENT_RE.test(segment));
}

function looksLikeCitationLine(text) {
  if (!/\b(19|20)\d{2}\b/.test(text) && !/\(\d{1,3}\)/.test(text)) {
    if (!(/\bvol(ume)?\.?\s*\d/i.test(text) && /\bpp?\.?\s*\d/i.test(text))) return false;
  }
  return (
    /\bvol(ume)?\.?\s*\d/i.test(text) ||
    /\bno\.?\s*\d/i.test(text) ||
    /\bpp?\.?\s*\d/i.test(text) ||
    /\(\d{1,3}\)/.test(text) ||
    /\d+\s*[-\u2013]\s*\d+/.test(text) ||
    /\bissn\b/i.test(text) ||
    /\barticle\b/i.test(text)
  );
}

function repeatsText(candidate, other) {
  if (!candidate || !other) return false;
  const a = candidate.toLowerCase();
  const b = other.toLowerCase();
  return a === b || a.includes(b) || b.includes(a);
}

// ---------- embedded metadata ----------

function cleanEmbeddedValue(value) {
  const cleaned = value?.trim();
  if (!cleaned || cleaned.length >= 300) return "";
  if (GENERIC_EMBEDDED_RE.test(cleaned)) return "";
  if (FILENAME_LIKE_RE.test(cleaned)) return "";
  return cleaned;
}

async function readEmbeddedFields(pdf) {
  const result = { title: "", authors: "" };
  try {
    const { info, metadata } = await pdf.getMetadata();
    result.title = cleanEmbeddedValue(info?.Title);
    result.authors = cleanEmbeddedValue(info?.Author);
    if (metadata) {
      if (!result.title) {
        const xmpTitle = metadata.get?.("dc:title");
        const flat = typeof xmpTitle === "string" ? xmpTitle : xmpTitle?.[Object.keys(xmpTitle || {})[0]];
        result.title = cleanEmbeddedValue(flat);
      }
      if (!result.authors) {
        const xmpCreator = metadata.get?.("dc:creator");
        const creatorText = Array.isArray(xmpCreator) ? xmpCreator.join(", ") : xmpCreator;
        result.authors = cleanEmbeddedValue(creatorText);
      }
    }
  } catch {
    // Embedded metadata is best-effort; positional extraction below still runs.
  }
  return result;
}

// ---------- title ----------

function scoreTitleLine(line, maxSize, repeated) {
  const text = line.text;
  if (repeated.has(text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim())) return -Infinity;
  if (DOI_ANYWHERE_RE.test(text) || EMAIL_RE.test(text)) return -Infinity;
  if (NON_TITLE_START_RE.test(text) || SECTION_LABEL_RE.test(text)) return -Infinity;
  if (text.length < 12 || text.length > 260) return -Infinity;
  if (!/[a-z]{3}/.test(text)) return -Infinity; // excludes running heads that are short and all-caps

  let score = (line.size / maxSize) * 50;
  if (line.bold) score += 8;
  const wordCount = text.split(/\s+/).length;
  score += wordCount >= 4 && wordCount <= 32 ? 14 : -6;
  if (looksLikeAuthorLine(text)) score -= 45;
  if (looksLikeCitationLine(text)) score -= 45;
  if (AFFILIATION_RE.test(text)) score -= 35;
  if (JOURNAL_WORD_RE.test(text) && wordCount <= 8) score -= 20;
  score -= line.index * 1.5;
  return score;
}

function mergeForwardTitle(lines, anchorPos) {
  const parts = [lines[anchorPos].text];
  let end = anchorPos;
  for (let step = 1; step < MAX_TITLE_MERGE_LINES; step += 1) {
    const next = lines[anchorPos + step];
    if (!next) break;
    const anchor = lines[anchorPos];
    const sizeClose = Math.abs(next.size - anchor.size) <= anchor.size * 0.2;
    const combinedLength = parts.join(" ").length + next.text.length;
    if (!sizeClose || combinedLength > 260) break;
    if (NON_TITLE_START_RE.test(next.text) || SECTION_LABEL_RE.test(next.text)) break;
    if (looksLikeAuthorLine(next.text) || looksLikeCitationLine(next.text)) break;
    if (DOI_ANYWHERE_RE.test(next.text) || EMAIL_RE.test(next.text)) break;
    parts.push(next.text);
    end = anchorPos + step;
  }
  return { text: parts.join(" "), endIndex: end };
}

function extractTitle(pages, repeated) {
  const first = pages[0];
  if (!first) return { text: "", endIndex: -1 };
  const windowLines = first.lines.slice(0, FIRST_PAGE_WINDOW);
  if (!windowLines.length) return { text: "", endIndex: -1 };
  const maxSize = Math.max(...windowLines.map((line) => line.size), 1);
  let best = null;
  windowLines.forEach((line, position) => {
    const score = scoreTitleLine(line, maxSize, repeated);
    if (score > TITLE_MIN_SCORE && (!best || score > best.score)) best = { position, score };
  });
  if (!best) return { text: "", endIndex: -1 };
  const merged = mergeForwardTitle(windowLines, best.position);
  return { text: normalizeWhitespace(merged.text), endIndex: merged.endIndex };
}

// ---------- authors ----------

function stripAffiliationMarkers(text) {
  return text
    .replace(/([A-Za-z\u00C0-\u017F])[\d*\u2020\u2021\u00a7\u00b6#]{1,3}(?=[\s,;.]|$)/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
}

function extractAuthors(pages, title, titleEndIndex) {
  const first = pages[0];
  if (!first || titleEndIndex < 0) return "";
  const window = first.lines.slice(titleEndIndex + 1, titleEndIndex + 1 + AUTHOR_WINDOW);
  const collected = [];
  for (const line of window) {
    if (repeatsText(line.text, title)) continue;
    if (/^(abstract|keywords?|corresponding author)\b/i.test(line.text) || EMAIL_RE.test(line.text)) break;
    if (AFFILIATION_RE.test(line.text) && !looksLikeAuthorLine(line.text)) break;
    if (looksLikeAuthorLine(line.text)) {
      collected.push(line.text);
      continue;
    }
    if (collected.length && /,\s*$/.test(collected.at(-1))) {
      collected.push(line.text);
      continue;
    }
    if (collected.length) break;
  }
  if (!collected.length) return "";
  return stripAffiliationMarkers(collected.join(" "));
}

// ---------- journal, year, volume, issue, pages, DOI ----------

// A year that ended up as its own trailing comma-segment of a matched journal name is not part of
// the name; it is the pattern's non-greedy journal group having backtracked through it to reach a
// later part of the regex (see the large comment above CITATION_PATTERNS). Requiring the year to be
// its own comma-delimited segment - not just any four digits - is what keeps this from misreading a
// journal name that legitimately contains a number (e.g. a journal literally called "Nature 2000").
const TRAILING_YEAR_SEGMENT_RE = /,\s*((?:19|20)\d{2})\s*$/;
const LEADING_YEAR_SEGMENT_RE = /^((?:19|20)\d{2})\s*,\s*/;

function splitEmbeddedYear(rawJournal) {
  const text = (rawJournal || "").trim();
  const trailing = text.match(TRAILING_YEAR_SEGMENT_RE);
  if (trailing) return { journal: text.slice(0, trailing.index), year: trailing[1] };
  const leading = text.match(LEADING_YEAR_SEGMENT_RE);
  if (leading) return { journal: text.slice(leading[0].length), year: leading[1] };
  return { journal: text, year: "" };
}

function cleanJournalName(raw, title, authors) {
  if (!raw) return "";
  let text = raw.replace(/^[,;:\s]+|[,;:\s]+$/g, "").trim();
  text = text.replace(/\s*\b(vol(ume)?\.?|no\.?|issue|iss\.?|pp?\.?)\b.*$/i, "").trim();
  if (text.length < 4 || text.length > 120) return "";
  if (!/[a-z]{3}/i.test(text)) return "";
  if (repeatsText(text, title) || repeatsText(text, authors)) return "";
  return text;
}

const CITATION_PATTERNS = [
  {
    // Journal Name, Vol. 12, No. 3, pp. 100-120, 2024
    re: /^(.*?),?\s*vol(?:ume)?\.?\s*(\d+)(?:\s*,?\s*(?:no\.?|issue|iss\.?)\s*(\d+))?\s*,?\s*(?:pp?\.?\s*)?(\d+\s*[-\u2013]\s*\d+)?\s*,?\s*\(?((?:19|20)\d{2})\)?/i,
    map: (m) => ({ journal: m[1], volume: m[2] || "", issue: m[3] || "", pages: m[4] || "", year: m[5] || "" }),
  },
  {
    // Journal Name 12, 145-162 (2024)
    re: /^(.*?),?\s+(\d{1,4})\s*,\s*(\d+\s*[-\u2013]\s*\d+)\s*\(((?:19|20)\d{2})\)/,
    map: (m) => ({ journal: m[1], volume: m[2], issue: "", pages: m[3], year: m[4] }),
  },
  {
    // Journal Name, 2026, 12(3), 145-162 (year stated before the volume/issue)
    re: /^(.*?),\s*((?:19|20)\d{2})\s*,\s*(\d{1,4})\s*\((\d{1,3})\)\s*,?\s*(\d+\s*[-\u2013]\s*\d+)?/,
    map: (m) => ({ journal: m[1], year: m[2], volume: m[3], issue: m[4], pages: m[5] || "" }),
  },
  {
    // Journal Name, 12(3), 145-162, 2024 (year, if present at all, comes after the pages)
    re: /^(.*?),\s*(\d{1,4})\s*\((\d{1,3})\)\s*,?\s*(\d+\s*[-\u2013]\s*\d+)?.*?(?:\(?((?:19|20)\d{2})\)?)?$/,
    map: (m) => ({ journal: m[1], volume: m[2], issue: m[3], pages: m[4] || "", year: m[5] || "" }),
  },
  {
    // Journal Name, Article e12345 (2024) / Art. No. 12345
    re: /^(.*?),?\s*(?:article|art\.)\s*(?:no\.?|number)?\s*[:#]?\s*([a-z]?\d{3,8})\s*(?:\(((?:19|20)\d{2})\))?/i,
    map: (m) => ({ journal: m[1], volume: "", issue: "", pages: `Article ${m[2]}`, year: m[3] || "" }),
  },
];

function normalizePageRange(pages) {
  if (!pages) return "";
  if (/^article/i.test(pages)) return pages.trim();
  return pages.replace(/\s/g, "").replace(/\u2013/g, "-");
}

function extractCitation(citationLines, title, authors) {
  for (const line of citationLines) {
    for (const pattern of CITATION_PATTERNS) {
      const match = line.text.match(pattern.re);
      if (!match) continue;
      const mapped = pattern.map(match);
      // Defense in depth: even a pattern whose own year group came up empty may have absorbed a
      // year into the journal capture through backtracking (see splitEmbeddedYear above). Recover
      // it here rather than trusting any single pattern's own year group to always be the one that
      // matched.
      const { journal: journalText, year: embeddedYear } = splitEmbeddedYear(mapped.journal);
      const journal = cleanJournalName(journalText, title, authors);
      if (!journal) continue;
      return {
        journal,
        volume: mapped.volume || "",
        issue: mapped.issue || "",
        pages: normalizePageRange(mapped.pages || ""),
        year: mapped.year || embeddedYear || "",
      };
    }
  }
  return null;
}

const TRAILING_BARE_YEAR_RE = /[\s,]+((?:19|20)\d{2})\s*$/;

// A softer fallback when no full structured citation matched: a line that names a journal.
function fallbackJournal(pages, title, authors) {
  for (const page of pages) {
    for (const line of page.lines) {
      if (!JOURNAL_WORD_RE.test(line.text)) continue;
      if (looksLikeAuthorLine(line.text)) continue;
      let firstSegment = line.text.split(",")[0];
      let year = "";
      // A year with no volume/issue pattern after it (e.g. "Land Economics 2024", no comma at all)
      // has nothing for a citation pattern to backtrack past, so it lands directly in this first
      // segment rather than being caught by splitEmbeddedYear above; strip it the same way.
      const trailingYear = firstSegment.match(TRAILING_BARE_YEAR_RE);
      if (trailingYear) {
        year = trailingYear[1];
        firstSegment = firstSegment.slice(0, trailingYear.index);
      } else {
        // Still on this same journal-naming line, so a year found elsewhere in it is reasonably
        // attributable to this citation, unlike scanning the whole document for the first year.
        year = line.text.match(/\b((?:19|20)\d{2})\b/)?.[1] || "";
      }
      const candidate = cleanJournalName(firstSegment, title, authors);
      if (candidate) return { journal: candidate, year };
    }
  }
  return null;
}

function fallbackYear(pages) {
  for (const page of pages) {
    for (const line of page.lines) {
      if (/\b(received|revised|accepted|submitted)\b/i.test(line.text)) continue;
      if (!/\b(published|copyright|\u00a9|journal|proceedings|vol\.|volume|issue|doi)\b/i.test(line.text)) continue;
      const match = line.text.match(/\b((?:19|20)\d{2})\b/);
      if (match) return match[1];
    }
  }
  return "";
}

function extractDoi(joinedText) {
  const patterns = [/doi\.org\/(10\.\d{4,9}\/[^\s"'<>]+)/i, /\bdoi\s*:\s*(10\.\d{4,9}\/[^\s"'<>]+)/i, /(10\.\d{4,9}\/[^\s"'<>]+)/i];
  for (const pattern of patterns) {
    const match = joinedText.match(pattern);
    if (match) return match[1].replace(/[.,;:)\]}>'"]+$/, "").trim();
  }
  return "";
}

// ---------- assembly ----------

function buildCitationLines(pages) {
  return pages.flatMap((page) => page.lines).filter((line) => looksLikeCitationLine(line.text));
}

export async function extractPdfMetadata(file) {
  if (!file) return { fields: {}, hasText: false, uncertainFields: [] };

  const data = new Uint8Array(await file.arrayBuffer());
  // Standard (non-embedded) fonts need their metrics supplied, or pdf.js cannot reliably lay out
  // and can truncate the text of lines set in an unembedded base font. pdfjs.js points the worker
  // at the matching pdfjs-dist build on the CDN, so the standard font data lives alongside it.
  const standardFontDataUrl = new URL("pdfjs-dist@6.3.289/standard_fonts/", "https://cdn.jsdelivr.net/npm/").href;
  const loadingTask = pdfjsLib.getDocument({ data, standardFontDataUrl });
  const pdf = await loadingTask.promise;
  try {
    const embedded = await readEmbeddedFields(pdf);
    const pageCount = Math.min(pdf.numPages, PAGES_TO_READ);
    const pages = [];
    for (let number = 1; number <= pageCount; number += 1) {
      try {
        const page = await pdf.getPage(number);
        const lines = await readPageLines(page, number);
        pages.push({ number, lines });
      } catch (error) {
        console.error(`Paper Compass metadata extraction: page ${number} could not be read.`, error);
      }
    }

    const joinedText = pages.flatMap((page) => page.lines).map((line) => line.text).join("\n");
    const hasText = Boolean(joinedText.trim() || embedded.title || embedded.authors);
    if (!hasText) return { fields: {}, hasText: false, uncertainFields: [] };

    const repeated = findRepeatedLineTexts(pages);
    const positional = extractTitle(pages, repeated);
    const title = embedded.title || positional.text;
    const authors = embedded.authors || (positional.text ? extractAuthors(pages, title, positional.endIndex) : "");

    const citationLines = buildCitationLines(pages);
    const citation = extractCitation(citationLines, title, authors);
    const fallback = citation ? null : fallbackJournal(pages, title, authors);
    const year = citation?.year || fallback?.year || fallbackYear(pages);
    const doi = extractDoi(joinedText);

    const fields = {
      title,
      authors,
      journal: citation?.journal || fallback?.journal || "",
      year,
      doi,
      volume: citation?.volume || "",
      issue: citation?.issue || "",
      pages: citation?.pages || "",
    };
    // Flag whichever fields actually came up blank, not just "no citation matched" - a partial
    // citation match (say, a journal and year but no page range) should only flag pages, not
    // volume and issue too.
    const uncertainFields = Object.keys(fields).filter((key) => key !== "doi" && !fields[key]);

    return { hasText: true, uncertainFields, fields };
  } finally {
    loadingTask.destroy();
  }
}
