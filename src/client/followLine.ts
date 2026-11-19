import type { CodeViewLineSelection, FileDiffMetadata, SelectionSide } from '@pierre/diffs';
import type { Loaded } from './store.js';

type Hunk = FileDiffMetadata['hunks'][number];

/**
 * Where new-side `line` of `before` sits in `after`, two diffs of one file against the same old
 * side (the new side moved, as when the worktree changes). An unchanged line maps exactly; an added
 * one keeps its distance below the unchanged line above it; a removed one lands where its
 * replacement starts.
 */
// ponytail: hunk headers alone, so in an added file (no old side) lines keep their numbers; match
// line text when that matters.
export function followLine(before: FileDiffMetadata, after: FileDiffMetadata, line: number): number {
  const { old, past } = toOld(before, line);
  return Math.max(1, toNew(after, old) + past);
}

/** Git names the line before an empty side (`+4,0`); the hunk's first line is the one after. */
const first = (start: number, count: number) => (count === 0 ? start + 1 : start);
const starts = (h: Hunk) => ({
  add: first(h.additionStart, h.additionCount),
  del: first(h.deletionStart, h.deletionCount),
});

/** The old line `line` shows, or for an added line the unchanged one above it and the distance. */
function toOld(diff: FileDiffMetadata, line: number): { old: number; past: number } {
  let delta = 0;
  for (const h of diff.hunks) {
    const { add, del } = starts(h);
    if (line < add) break;
    if (line < add + h.additionCount) {
      let next = add;
      let prev = del;
      for (const c of h.hunkContent) {
        if (c.type === 'context') {
          if (line < next + c.lines) return { old: prev + line - next, past: 0 };
          next += c.lines;
          prev += c.lines;
        } else {
          if (line < next + c.additions) return { old: prev - 1, past: line - next + 1 };
          next += c.additions;
          prev += c.deletions;
        }
      }
    }
    delta = add + h.additionCount - (del + h.deletionCount);
  }
  return { old: line - delta, past: 0 };
}

/** The new line showing old `line`, or where its replacement starts when it was removed. */
function toNew(diff: FileDiffMetadata, line: number): number {
  let delta = 0;
  for (const h of diff.hunks) {
    const { add, del } = starts(h);
    if (line < del) break;
    if (line < del + h.deletionCount) {
      let next = add;
      let prev = del;
      for (const c of h.hunkContent) {
        if (c.type === 'context') {
          if (line < prev + c.lines) return next + line - prev;
          next += c.lines;
          prev += c.lines;
        } else {
          if (line < prev + c.deletions) return next;
          next += c.additions;
          prev += c.deletions;
        }
      }
    }
    delta = add + h.additionCount - (del + h.deletionCount);
  }
  return line + delta;
}

/**
 * The two diffs a line can follow between: `after` a reload of `before` that moved only the new side,
 * the old blob the same. Null otherwise, when every line may mean something else.
 */
export function followable(
  before: Loaded | undefined,
  after: Loaded | undefined,
): [FileDiffMetadata, FileDiffMetadata] | null {
  if (before?.kind !== 'diff' || after?.kind !== 'diff' || before.fileDiff === after.fileDiff) return null;
  if (before.fileDiff.prevObjectId !== after.fileDiff.prevObjectId) return null;
  return [before.fileDiff, after.fileDiff];
}

/** `sel` on the same code once its file's diff moved from `before` to `after`; old-side lines did not move. */
export function followSelection(
  sel: CodeViewLineSelection,
  before: Loaded | undefined,
  after: Loaded | undefined,
): CodeViewLineSelection {
  const pair = followable(before, after);
  if (!pair) return sel;
  const follow = (line: number, side: SelectionSide | undefined) =>
    side === 'deletions' ? line : followLine(...pair, line);
  const { range } = sel;
  const end = follow(range.end, range.endSide ?? range.side);
  return { ...sel, range: { ...range, start: follow(range.start, range.side), end } };
}
