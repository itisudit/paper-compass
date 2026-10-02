// synthesis.js
// Step 15: a cross-paper synthesis — a reader's own attempt to answer one question across several
// papers already in the library. For each paper the reader records what it contributes to the
// question (a claim, the evidence items they picked from that paper, and how confident they are),
// then writes what converges, what is in tension, what is still missing, and their current judgement.
//
// This module is pure domain logic, like relationships.js: given the synthesis collection and the
// library's records it validates, creates, updates and describes syntheses, and never touches
// storage. library.js owns the one file everything lives in and calls these. Nothing here writes,
// suggests, scores or infers anything — every word in a synthesis is the reader's.
//
// A synthesis:
//   {
//     id, question, paperIds: [recordId, ...],            // at least two, all existing library papers
//     contributions: [{ paperId, claim, evidenceIds, confidence }],   // exactly one per paper, in paperIds order
//     convergence, tensions, gaps,                        // free text; empty is a legitimate answer
//     judgement, confidence, whatWouldChangeMyMind,
//     createdAt, updatedAt
//   }
// Evidence is never stored here, only referenced: evidenceIds name items in a paper's own reading
// session (record.session.evidence), so there is still exactly one evidence system.

import { newId } from "./persistence.js";

export const CONFIDENCE_LEVELS = ["low", "medium", "high"];
export const CONFIDENCE_LABELS = { low: "Low", medium: "Medium", high: "High" };
export const MIN_PAPERS = 2;

// Free-text fields a reader can fill in. Empty is always allowed.
export const SYNTHESIS_TEXT_FIELDS = ["convergence", "tensions", "gaps", "judgement", "whatWouldChangeMyMind"];

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const text = (value) => (typeof value === "string" ? value : "");
// "" means the reader has not chosen a confidence yet; that is a real state, not a default of "medium".
const confidenceOrEmpty = (value) => (CONFIDENCE_LEVELS.includes(value) ? value : "");
const validConfidence = (value) => value === "" || CONFIDENCE_LEVELS.includes(value);

const refuse = (reason) => ({ ok: false, reason });

// recordId -> Set of that paper's evidence ids, built from the library's records.
function evidenceIndex(records) {
  return new Map(records.map((record) => [record.id, new Set((record.session?.evidence ?? []).map((item) => item.id))]));
}

// ---------- validation of stored data ----------

function sanitizeContribution(rawList, paperId, allowedEvidence) {
  const raw = (Array.isArray(rawList) ? rawList : []).find((c) => isObject(c) && c.paperId === paperId) ?? {};
  const evidenceIds = Array.isArray(raw.evidenceIds)
    ? [...new Set(raw.evidenceIds.filter((id) => typeof id === "string" && allowedEvidence.has(id)))]
    : [];
  return { paperId, claim: text(raw.claim), evidenceIds, confidence: confidenceOrEmpty(raw.confidence) };
}

// Returns a clean synthesis, or null when it cannot meaningfully exist: no id, no question, or fewer
// than two papers that are still in the library. Evidence ids that no longer name an item in their
// paper are dropped quietly (the reader removed that evidence); the rest of the contribution stays.
export function sanitizeSynthesis(raw, index) {
  if (!isObject(raw) || typeof raw.id !== "string" || !raw.id) return null;
  const question = text(raw.question).trim();
  if (!question) return null;
  const paperIds = [...new Set((Array.isArray(raw.paperIds) ? raw.paperIds : []).filter((id) => typeof id === "string" && index.has(id)))];
  if (paperIds.length < MIN_PAPERS) return null;
  const createdAt = isFiniteNumber(raw.createdAt) ? raw.createdAt : Date.now();
  return {
    id: raw.id,
    question,
    paperIds,
    contributions: paperIds.map((paperId) => sanitizeContribution(raw.contributions, paperId, index.get(paperId))),
    convergence: text(raw.convergence),
    tensions: text(raw.tensions),
    gaps: text(raw.gaps),
    judgement: text(raw.judgement),
    confidence: confidenceOrEmpty(raw.confidence),
    whatWouldChangeMyMind: text(raw.whatWouldChangeMyMind),
    createdAt,
    updatedAt: isFiniteNumber(raw.updatedAt) ? raw.updatedAt : createdAt,
  };
}

export function sanitizeSyntheses(raw, records) {
  const index = evidenceIndex(records);
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const clean = sanitizeSynthesis(item, index);
    if (!clean || seen.has(clean.id)) continue;
    seen.add(clean.id);
    out.push(clean);
  }
  return out;
}

// ---------- operations ----------
// Each returns { ok: true, synthesis, syntheses } with the new array to save, or { ok: false, reason }.
// reason is one of: "question", "too-few-papers", "duplicate-papers", "invalid-record", "not-found",
// "invalid-patch", "invalid-text", "invalid-confidence", "paper-not-in-synthesis", "invalid-evidence".
// Inputs are never mutated.

export function createSynthesis(syntheses, records, { question, paperIds } = {}) {
  const trimmed = typeof question === "string" ? question.trim() : "";
  if (!trimmed) return refuse("question");
  if (!Array.isArray(paperIds) || paperIds.length < MIN_PAPERS) return refuse("too-few-papers");
  if (new Set(paperIds).size !== paperIds.length) return refuse("duplicate-papers");
  const index = evidenceIndex(records);
  if (paperIds.some((id) => typeof id !== "string" || !index.has(id))) return refuse("invalid-record");
  const now = Date.now();
  const synthesis = {
    id: newId("syn"),
    question: trimmed,
    paperIds: [...paperIds],
    contributions: paperIds.map((paperId) => ({ paperId, claim: "", evidenceIds: [], confidence: "" })),
    convergence: "", tensions: "", gaps: "",
    judgement: "", confidence: "", whatWouldChangeMyMind: "",
    createdAt: now, updatedAt: now,
  };
  return { ok: true, synthesis, syntheses: [...syntheses, synthesis] };
}

function replaceOne(syntheses, updated) {
  return syntheses.map((s) => (s.id === updated.id ? updated : s));
}

// Updates the synthesis-level fields: question, the three interpretation texts, and the judgement
// fields. Only keys present in `patch` change. The paper set is fixed once a synthesis exists.
export function updateSynthesis(syntheses, _records, id, patch) {
  const current = syntheses.find((s) => s.id === id);
  if (!current) return refuse("not-found");
  if (!isObject(patch)) return refuse("invalid-patch");
  const next = { ...current };
  if ("question" in patch) {
    const trimmed = typeof patch.question === "string" ? patch.question.trim() : "";
    if (!trimmed) return refuse("question");
    next.question = trimmed;
  }
  for (const field of SYNTHESIS_TEXT_FIELDS) {
    if (!(field in patch)) continue;
    if (typeof patch[field] !== "string") return refuse("invalid-text");
    next[field] = patch[field];
  }
  if ("confidence" in patch) {
    if (!validConfidence(patch.confidence)) return refuse("invalid-confidence");
    next.confidence = patch.confidence;
  }
  next.updatedAt = Date.now();
  return { ok: true, synthesis: next, syntheses: replaceOne(syntheses, next) };
}

// Adds or edits one paper's contribution. Only keys present in `patch` (besides paperId) change.
// Evidence must belong to that same paper: an id from another paper, or one that does not exist, is
// refused, so a contribution can only ever point at passages the reader picked from that paper.
export function setContribution(syntheses, records, id, patch) {
  const current = syntheses.find((s) => s.id === id);
  if (!current) return refuse("not-found");
  if (!isObject(patch) || !current.paperIds.includes(patch.paperId)) return refuse("paper-not-in-synthesis");
  const existing = current.contributions.find((c) => c.paperId === patch.paperId);
  const next = { ...existing };
  if ("claim" in patch) {
    if (typeof patch.claim !== "string") return refuse("invalid-text");
    next.claim = patch.claim;
  }
  if ("confidence" in patch) {
    if (!validConfidence(patch.confidence)) return refuse("invalid-confidence");
    next.confidence = patch.confidence;
  }
  if ("evidenceIds" in patch) {
    if (!Array.isArray(patch.evidenceIds)) return refuse("invalid-evidence");
    const allowed = evidenceIndex(records).get(patch.paperId) ?? new Set();
    if (patch.evidenceIds.some((evidenceId) => typeof evidenceId !== "string" || !allowed.has(evidenceId))) {
      return refuse("invalid-evidence");
    }
    next.evidenceIds = [...new Set(patch.evidenceIds)];
  }
  const updated = {
    ...current,
    contributions: current.contributions.map((c) => (c.paperId === patch.paperId ? next : c)),
    updatedAt: Date.now(),
  };
  return { ok: true, synthesis: updated, syntheses: replaceOne(syntheses, updated) };
}

// Removes one synthesis by id. Returns the same array (by reference) when nothing had that id.
export function removeSynthesis(syntheses, id) {
  const next = syntheses.filter((s) => s.id !== id);
  return next.length === syntheses.length ? syntheses : next;
}

// A paper has been deleted from the library. Every synthesis that used it loses that paper and its
// contribution. One left with fewer than two papers can no longer be a comparison, so it is removed
// rather than kept with a dangling or lone paper. Returns the new array.
export function removePaperFromSyntheses(syntheses, recordId) {
  const out = [];
  for (const synthesis of syntheses) {
    if (!synthesis.paperIds.includes(recordId)) { out.push(synthesis); continue; }
    const paperIds = synthesis.paperIds.filter((id) => id !== recordId);
    if (paperIds.length < MIN_PAPERS) continue;
    out.push({
      ...synthesis,
      paperIds,
      contributions: synthesis.contributions.filter((c) => c.paperId !== recordId),
      updatedAt: Date.now(),
    });
  }
  return out;
}

// What deleting a paper would do to syntheses, so the app can say so before it happens:
// how many lose a paper, and how many would be removed entirely.
export function describePaperRemoval(syntheses, recordId) {
  const involved = syntheses.filter((s) => s.paperIds.includes(recordId));
  const removed = involved.filter((s) => s.paperIds.length - 1 < MIN_PAPERS).length;
  return { involved: involved.length, removed, shrunk: involved.length - removed };
}
