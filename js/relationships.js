// relationships.js
// Step 14: the reader-created links between two papers in the library — "Paper B challenges Paper A",
// with an optional note on why. This module is pure domain logic only: given a relationships array
// and the library's records, it validates, creates, dedupes and describes relationships. It never
// touches localStorage — library.js owns reading and writing the one file both records and
// relationships live in, the same way persistence.js's sanitizeSnapshot validates a reading's data
// without knowing where that data is stored.

import { newId } from "./persistence.js";

export const RELATIONSHIP_TYPES = ["supports", "challenges", "extends", "contrasts", "related"];

// How a relationship reads from the side that created it ("forward") and from the other paper's side
// ("reverse") — e.g. Paper B → Challenges → Paper A reads as "Challenged by Paper B" from Paper A.
// Contrasts and Related read the same both ways, since neither direction changes what is being said.
export const RELATIONSHIP_LABELS = {
  supports:   { forward: "Supports",       reverse: "Supported by" },
  challenges: { forward: "Challenges",     reverse: "Challenged by" },
  extends:    { forward: "Extends",        reverse: "Extended by" },
  contrasts:  { forward: "Contrasts with", reverse: "Contrasts with" },
  related:    { forward: "Related to",     reverse: "Related to" },
};

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

// Two relationships are the same claim if they join the same two papers, in either direction, with
// the same type. "A supports B" and "B supports A" are the same underlying link stated from opposite
// ends, and for a type that reads the same both ways (Contrasts, Related) they are literally the
// same sentence — so the pair is normalised regardless of which side is "from".
function pairKey(fromId, toId, type) {
  const [a, b] = [fromId, toId].sort();
  return `${a}\u0000${b}\u0000${type}`;
}

// Returns a clean relationship, or null when it does not validate: not an object, no id, either end
// missing or equal to the other (a paper cannot relate to itself), an unrecognised type, or an end
// that no longer names a record in the library — a link whose paper was deleted. Cascade deletion in
// library.js is what should prevent that last case; this is the defensive backstop for a saved file
// that was hand-edited or came from an older, buggier build.
export function sanitizeRelationship(raw, validRecordIds) {
  if (!isObject(raw) || typeof raw.id !== "string" || !raw.id) return null;
  if (typeof raw.fromRecordId !== "string" || typeof raw.toRecordId !== "string") return null;
  if (!raw.fromRecordId || !raw.toRecordId || raw.fromRecordId === raw.toRecordId) return null;
  if (!RELATIONSHIP_TYPES.includes(raw.type)) return null;
  if (!validRecordIds.has(raw.fromRecordId) || !validRecordIds.has(raw.toRecordId)) return null;
  const createdAt = isFiniteNumber(raw.createdAt) ? raw.createdAt : Date.now();
  return {
    id: raw.id,
    fromRecordId: raw.fromRecordId,
    toRecordId: raw.toRecordId,
    type: raw.type,
    note: typeof raw.note === "string" ? raw.note : "",
    createdAt,
    updatedAt: isFiniteNumber(raw.updatedAt) ? raw.updatedAt : createdAt,
  };
}

// Validates a whole stored array: each entry through sanitizeRelationship, then drops anything
// sharing an id, or a (pair, type), with an entry already kept — so a corrupted or hand-edited file
// cannot resurrect a duplicate the app itself would never have created.
export function sanitizeRelationships(raw, validRecordIds) {
  const seenIds = new Set();
  const seenPairs = new Set();
  const out = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const clean = sanitizeRelationship(item, validRecordIds);
    if (!clean || seenIds.has(clean.id)) continue;
    const key = pairKey(clean.fromRecordId, clean.toRecordId, clean.type);
    if (seenPairs.has(key)) continue;
    seenIds.add(clean.id);
    seenPairs.add(key);
    out.push(clean);
  }
  return out;
}

// Attempts to add one relationship to an already-sanitized array. Pure: takes the library's current
// relationships and records, and returns either the new array to save or the reason the request was
// refused. Never mutates its inputs, and never touches storage — library.js is the only caller that
// writes the result. reason is one of: "missing" (an end was not supplied), "self" (both ends are the
// same paper), "invalid-type", "invalid-record" (an end does not name a paper in this library), or
// "duplicate" (the same two papers already carry this type of link).
export function addRelationship(relationships, records, { fromRecordId, toRecordId, type, note }) {
  if (!fromRecordId || !toRecordId) return { ok: false, reason: "missing" };
  if (fromRecordId === toRecordId) return { ok: false, reason: "self" };
  if (!RELATIONSHIP_TYPES.includes(type)) return { ok: false, reason: "invalid-type" };
  const validIds = new Set(records.map((r) => r.id));
  if (!validIds.has(fromRecordId) || !validIds.has(toRecordId)) return { ok: false, reason: "invalid-record" };
  const key = pairKey(fromRecordId, toRecordId, type);
  if (relationships.some((r) => pairKey(r.fromRecordId, r.toRecordId, r.type) === key)) {
    return { ok: false, reason: "duplicate" };
  }
  const now = Date.now();
  const relationship = {
    id: newId("rel"), fromRecordId, toRecordId, type,
    note: typeof note === "string" ? note.trim() : "",
    createdAt: now, updatedAt: now,
  };
  return { ok: true, relationship, relationships: [...relationships, relationship] };
}

// Removes one relationship from an already-sanitized array by id. Returns the same array (by
// reference) when the id was not found, so a caller can tell "nothing changed" from "it shrank" with
// a simple length or reference check.
export function removeRelationship(relationships, id) {
  const next = relationships.filter((r) => r.id !== id);
  return next.length === relationships.length ? relationships : next;
}

// Drops every relationship touching a deleted record. Used by library.js's deleteRecord so no
// relationship can ever point at a paper that no longer exists.
export function removeRelationshipsForRecord(relationships, recordId) {
  return relationships.filter((r) => r.fromRecordId !== recordId && r.toRecordId !== recordId);
}

// Every relationship touching one record, described for display from that record's own point of
// view: which other paper it names, in words ("Challenged by", "Supports", ...), and its note.
// Ordered oldest-first. otherTitle falls back to a plain label if the other paper's record is
// somehow missing (defensive only — see the comment on sanitizeRelationship above).
export function describeRelationshipsForRecord(recordId, relationships, records) {
  const byId = new Map(records.map((r) => [r.id, r]));
  return relationships
    .filter((r) => r.fromRecordId === recordId || r.toRecordId === recordId)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((r) => {
      const isForward = r.fromRecordId === recordId;
      const otherId = isForward ? r.toRecordId : r.fromRecordId;
      const other = byId.get(otherId);
      return {
        id: r.id,
        type: r.type,
        label: RELATIONSHIP_LABELS[r.type][isForward ? "forward" : "reverse"],
        otherId,
        otherTitle: other?.paper?.title || "A paper no longer in your library",
        note: r.note,
      };
    });
}
