import { diffLines } from "diff";
import type { ProposalSnapshot, ProposalNotes } from "./input";

export const ChangeKind = { Body: "body", Metadata: "metadata" } as const;
export const METADATA_FIELDS = [
  "title",
  "slug",
  "categoryId",
  "tags",
  "thumbnailUrl",
  "bannerUrl",
  "videoUrl",
] as const;
export type MetadataField = (typeof METADATA_FIELDS)[number];
export type BodyChange = {
  id: string;
  kind: typeof ChangeKind.Body;
  start: number;
  end: number;
  before: string;
  after: string;
};
export type MetadataChange = {
  id: string;
  kind: typeof ChangeKind.Metadata;
  field: MetadataField;
  before: ProposalSnapshot[MetadataField];
  after: ProposalSnapshot[MetadataField];
};
export type ProposalChange = BodyChange | MetadataChange;
export type ProposalDiff = {
  version: 1;
  wholeBodyReplacement: boolean;
  changes: ProposalChange[];
};

export function createProposalDiff(
  base: ProposalSnapshot,
  candidate: ProposalSnapshot,
): ProposalDiff {
  const parts = diffLines(base.bodyMd, candidate.bodyMd, {
    maxEditLength: 1000,
    timeout: 50,
  });
  const body: BodyChange[] = [];
  let offset = 0;
  let pending: BodyChange | undefined;
  const flush = () => {
    if (pending) body.push(pending);
    pending = undefined;
  };
  for (const part of parts ?? []) {
    if (!part.added && !part.removed) {
      flush();
      offset += part.value.length;
      continue;
    }
    pending ??= {
      id: `body:${body.length}`,
      kind: ChangeKind.Body,
      start: offset,
      end: offset,
      before: "",
      after: "",
    };
    if (part.removed) {
      pending.before += part.value;
      offset += part.value.length;
      pending.end = offset;
    } else pending.after += part.value;
  }
  flush();
  const wholeBodyReplacement = parts === undefined || body.length > 990;
  const changes: ProposalChange[] = wholeBodyReplacement
    ? [
        {
          id: "body:0",
          kind: ChangeKind.Body,
          start: 0,
          end: base.bodyMd.length,
          before: base.bodyMd,
          after: candidate.bodyMd,
        },
      ]
    : body;
  for (const field of METADATA_FIELDS) {
    if (JSON.stringify(base[field]) !== JSON.stringify(candidate[field])) {
      changes.push({
        id: `field:${field}`,
        kind: ChangeKind.Metadata,
        field,
        before: base[field],
        after: candidate[field],
      });
    }
  }
  const diff: ProposalDiff = { version: 1, wholeBodyReplacement, changes };
  // Complete comparison is an invariant, even for CRLF, blank lines and EOF.
  const reconstructed = applyProposalSelection(
    base,
    candidate,
    diff,
    changes.map((c) => c.id),
  );
  if (
    !(Object.keys(candidate) as (keyof ProposalSnapshot)[]).every(
      (key) =>
        JSON.stringify(reconstructed[key]) === JSON.stringify(candidate[key]),
    )
  ) {
    throw new Error("Proposal diff does not reconstruct its candidate.");
  }
  return diff;
}

export function applyProposalSelection(
  base: ProposalSnapshot,
  candidate: ProposalSnapshot,
  diff: ProposalDiff,
  selectedIds: string[],
): ProposalSnapshot {
  if (diff.version !== 1) throw new Error("Unsupported proposal diff version.");
  const selected = new Set(selectedIds);
  const available = new Set(diff.changes.map((change) => change.id));
  if (
    selected.size !== selectedIds.length ||
    selectedIds.some((id) => !available.has(id))
  )
    throw new Error("Unknown or duplicate change IDs.");
  const result = { ...base, tags: [...base.tags] };
  let cursor = 0;
  let body = "";
  for (const change of diff.changes) {
    if (change.kind === ChangeKind.Metadata) {
      if (selected.has(change.id))
        Object.assign(result, { [change.field]: candidate[change.field] });
      continue;
    }
    if (
      change.start < cursor ||
      base.bodyMd.slice(change.start, change.end) !== change.before
    )
      throw new Error("Invalid proposal body range.");
    body += base.bodyMd.slice(cursor, change.start);
    body += selected.has(change.id) ? change.after : change.before;
    cursor = change.end;
  }
  result.bodyMd = body + base.bodyMd.slice(cursor);
  return result;
}

// Exact text guards against a client/server diff boundary or fallback changing.
export function explanationTarget(change: ProposalChange) {
  return {
    changeId: change.id,
    before:
      change.kind === ChangeKind.Body
        ? change.before
        : JSON.stringify(change.before),
    after:
      change.kind === ChangeKind.Body
        ? change.after
        : JSON.stringify(change.after),
  };
}

export function explanationsMatch(
  diff: ProposalDiff,
  notes: ProposalNotes,
): boolean {
  if (!notes.changes) return true; // Retained reviews and older API clients.
  if (notes.changes.length !== diff.changes.length) return false;
  const byId = new Map(notes.changes.map((note) => [note.changeId, note]));
  if (byId.size !== notes.changes.length) return false;
  return diff.changes.every((change) => {
    const note = byId.get(change.id);
    const target = explanationTarget(change);
    return note?.before === target.before && note?.after === target.after;
  });
}

// Human reviews (ADR-0038): each reviewer suggestion is exactly one change,
// so explanations and selective apply bind to what the reviewer selected
// rather than to a line diff that could merge or split suggestions. Detail
// (metadata) suggestions become one change per field, as in AI reviews.
export function createRangeDiff(
  base: ProposalSnapshot,
  ranges: { start: number; end: number; after: string }[],
  details: {
    field: MetadataField;
    after: ProposalSnapshot[MetadataField];
  }[] = [],
): { diff: ProposalDiff; candidate: ProposalSnapshot } {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const changes: ProposalChange[] = [];
  let body = "";
  let cursor = 0;
  for (const range of sorted) {
    if (range.start < cursor || range.end <= range.start)
      throw new Error("Overlapping or empty suggestion range.");
    if (range.end > base.bodyMd.length)
      throw new Error("Suggestion range outside the reviewed text.");
    body += base.bodyMd.slice(cursor, range.start) + range.after;
    changes.push({
      id: `body:${changes.length}`,
      kind: ChangeKind.Body,
      start: range.start,
      end: range.end,
      before: base.bodyMd.slice(range.start, range.end),
      after: range.after,
    });
    cursor = range.end;
  }
  const candidate: ProposalSnapshot = {
    ...base,
    tags: [...base.tags],
    bodyMd: body + base.bodyMd.slice(cursor),
  };
  const byField = new Map(details.map((d) => [d.field, d.after]));
  if (byField.size !== details.length)
    throw new Error("Duplicate detail suggestion.");
  for (const field of METADATA_FIELDS) {
    if (!byField.has(field)) continue;
    const after = byField.get(field)!;
    if (JSON.stringify(after) === JSON.stringify(base[field]))
      throw new Error("Detail suggestion matches the current value.");
    Object.assign(candidate, { [field]: after });
    changes.push({
      id: `field:${field}`,
      kind: ChangeKind.Metadata,
      field,
      before: base[field],
      after,
    });
  }
  const diff: ProposalDiff = {
    version: 1,
    wholeBodyReplacement: false,
    changes,
  };
  const reconstructed = applyProposalSelection(
    base,
    candidate,
    diff,
    changes.map((change) => change.id),
  );
  if (JSON.stringify(reconstructed) !== JSON.stringify(candidate))
    throw new Error("Suggestion diff does not reconstruct its candidate.");
  return { diff, candidate };
}
