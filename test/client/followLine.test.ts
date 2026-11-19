import { parsePatchFiles } from '@pierre/diffs';
import { describe, expect, it } from 'vitest';
import { followLine } from '@/client/followLine.js';

/** The one file of a unified diff given as its hunks. */
function diff(...hunks: string[]) {
  const patch = ['diff --git a/f.py b/f.py', '--- a/f.py', '+++ b/f.py', ...hunks, ''].join('\n');
  return parsePatchFiles(patch, { cacheKeyPrefix: 't' })[0]!.files[0]!;
}

// The old side: lines o1..o30. The reader saw `before`; the agent then edited the new side into `after`.
const before = diff('@@ -10,3 +10,4 @@', ' o10', '+n1', ' o11', ' o12');

describe('followLine', () => {
  it('keeps an unchanged line on its code when lines are added above it', () => {
    // Five lines inserted after o2: o20 was new line 21, and is 26 now.
    const after = diff(
      '@@ -2,0 +3,5 @@',
      '+a',
      '+b',
      '+c',
      '+d',
      '+e',
      '@@ -10,3 +15,4 @@',
      ' o10',
      '+n1',
      ' o11',
      ' o12',
    );
    expect(followLine(before, after, 21)).toBe(26);
    // Lines above the insertion stay where they were.
    expect(followLine(before, after, 2)).toBe(2);
    // A line inside a hunk above follows too: o11 was 12 and is 17.
    expect(followLine(before, after, 12)).toBe(17);
  });

  it('keeps an added line below the unchanged line above it', () => {
    const after = diff('@@ -2,0 +3,2 @@', '+a', '+b', '@@ -10,3 +12,4 @@', ' o10', '+n1', ' o11', ' o12');
    // n1 is line 11, right under o10 (10); after the edit o10 is 12, so n1 is 13.
    expect(followLine(before, after, 11)).toBe(13);
  });

  it('follows lines removed above, and lands a removed line where its replacement starts', () => {
    // Git names the line before an empty side: removing o3-o4 is `+2,0`.
    const after = diff('@@ -3,2 +2,0 @@', '-o3', '-o4', '@@ -10,3 +8,4 @@', ' o10', '+n1', ' o11', ' o12');
    expect(followLine(before, after, 21)).toBe(19);
    // o4 itself is gone: it lands on the line that now follows the removal.
    expect(followLine(before, after, 4)).toBe(3);
  });

  it('keeps every line where it was when nothing moved', () => {
    for (const line of [1, 10, 11, 13, 30]) expect(followLine(before, before, line)).toBe(line);
  });
});
