import { expect, test } from './fixtures.js';
import { clickLine, gotoFile, selectLines, settle } from './browser.js';
import { readPrompt, readThreads, seedThreads } from './server.js';
import type { CommentThread } from '@/shared/protocol.js';

test('comments on a line range and lists the thread in the panel', async ({ page, diffle }) => {
  await gotoFile(page, 'tally/ledger.py');
  await selectLines(page, 'tally/ledger.py', 3, 4);
  const composer = page.getByPlaceholder('Leave a comment…');
  await composer.fill('Say what counts as a refund here, not only in the parser.');
  await composer.press('Control+Enter');
  await expect(page.locator('aside').last()).toContainText('ledger.py');

  const threads = await readThreads(diffle.url);
  expect(threads).toHaveLength(1);
  expect(threads[0]?.anchor).toMatchObject({
    kind: 'line',
    path: 'tally/ledger.py',
    side: 'new',
    startLine: 3,
    endLine: 4,
  });
  await expect(page).toHaveScreenshot('comment.png');
  await expect(page.locator('aside').last()).toMatchAriaSnapshot({ name: 'threads-panel.aria.yml' });
});

test("regression: pressing the cursor's line number comments on that line", async ({ page, diffle }) => {
  await gotoFile(page, 'tally/ledger.py');
  await clickLine(page, 'tally/ledger.py', 5);
  // The viewer reads a press on the one selected line as unselecting it; it must open the composer.
  await selectLines(page, 'tally/ledger.py', 5, 5);
  const composer = page.getByPlaceholder('Leave a comment…');
  await expect(composer).toBeVisible();
  await composer.fill('Name the unit.');
  await composer.press('Control+Enter');
  await expect
    .poll(async () => (await readThreads(diffle.url))[0]?.anchor)
    .toMatchObject({
      kind: 'line',
      path: 'tally/ledger.py',
      startLine: 5,
      endLine: 5,
    });
});

test('comments on a whole file and exports both threads as a prompt', async ({ page, diffle }) => {
  await gotoFile(page, 'tally/refunds.py');
  await page.keyboard.press('C');
  const composer = page.getByPlaceholder('Leave a comment…');
  await composer.fill('Consider folding this into `ledger.py`; it only has two callers.');
  await composer.press('Control+Enter');
  await gotoFile(page, 'tally/currency.py');
  await selectLines(page, 'tally/currency.py', 7, 7);
  await page.getByPlaceholder('Leave a comment…').fill('`KWD` gets three decimals above but no symbol here.');
  await page.getByPlaceholder('Leave a comment…').press('Control+Enter');

  await expect(page.locator('aside').last()).toContainText('refunds.py');
  await expect(page.locator('aside').last()).toContainText('currency.py');
  const prompt = await readPrompt(diffle.url);
  expect(prompt).toContain('KWD');
  // The prompt an agent receives for this review, quoted lines included.
  expect(prompt).toMatchSnapshot('prompt.md');
  await expect(page).toHaveScreenshot('two-threads.png');
});

test('regression: deleting a thread needs a second click and confirmation expires', async ({ page, diffle }) => {
  await gotoFile(page, 'tally/ledger.py');
  await page.keyboard.press('C');
  await page.getByPlaceholder('Leave a comment…').fill('Keep this until deletion is confirmed.');
  await page.getByPlaceholder('Leave a comment…').press('Control+Enter');
  const remove = page.getByRole('button', { name: 'Delete this thread', exact: true });
  const confirm = page.getByRole('button', { name: 'Delete this thread? Click again to confirm', exact: true });
  await expect(remove).toBeVisible();
  await page.clock.install();
  await remove.click();
  await expect(confirm).toBeVisible();
  expect(await readThreads(diffle.url)).toHaveLength(1);
  await page.clock.fastForward(3100);
  await expect(remove).toBeVisible();
  await remove.click();
  await expect(confirm).toBeVisible();
  expect(await readThreads(diffle.url)).toHaveLength(1);
  await confirm.click();
  await expect.poll(() => readThreads(diffle.url)).toEqual([]);
  await expect(page.locator('aside').last()).toContainText('No comments yet.');
});

test('regression: closing a composer keeps its text until the comment is posted', async ({ page, diffle }) => {
  await gotoFile(page, 'tally/ledger.py');
  await selectLines(page, 'tally/ledger.py', 3, 4);
  const composer = page.getByPlaceholder('Leave a comment…');
  await composer.fill('A long thought, half written.');
  await composer.press('Escape');
  await expect(composer).toBeHidden();

  // Another target starts empty; the first comes back, across a reload too.
  await page.keyboard.press('C');
  await expect(composer).toHaveValue('');
  await composer.fill('About the whole file.');
  await composer.press('Escape');
  await page.reload();
  await settle(page);
  await gotoFile(page, 'tally/ledger.py');
  await selectLines(page, 'tally/ledger.py', 3, 4);
  await expect(composer).toHaveValue('A long thought, half written.');
  await composer.press('Control+Enter');
  await expect.poll(async () => (await readThreads(diffle.url)).length).toBe(1);

  const reply = page.getByPlaceholder('Reply…');
  await page.getByRole('button', { name: 'Reply', exact: true }).first().click();
  await reply.fill('And one more thing.');
  await reply.press('Escape');
  await page.getByRole('button', { name: 'Reply', exact: true }).first().click();
  await expect(reply).toHaveValue('And one more thing.');

  // Posting forgets the text: the same lines open an empty composer.
  await reply.press('Escape');
  await selectLines(page, 'tally/ledger.py', 3, 4);
  await expect(composer).toHaveValue('');
  await composer.press('Escape');
  await page.keyboard.press('C');
  await expect(composer).toHaveValue('About the whole file.');
});

test('an agent waiting on the review gets the new thread, and its reply shows live as the agent’s', async ({
  page,
  diffle,
}) => {
  const waiting = fetch(new URL('api/threads/wait?timeout=30', diffle.url)).then(
    (r) => r.json() as Promise<CommentThread[]>,
  );
  await gotoFile(page, 'tally/ledger.py');
  await selectLines(page, 'tally/ledger.py', 3, 3);
  const composer = page.getByPlaceholder('Leave a comment…');
  await composer.fill('Why parse refunds twice?');
  await composer.press('Control+Enter');

  const [thread] = await waiting;
  expect(thread?.messages.map((m) => m.body)).toEqual(['Why parse refunds twice?']);
  const reply = await fetch(new URL(`api/threads/${thread!.id}/replies`, diffle.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'The second pass only normalises the sign.', author: 'agent' }),
  });
  expect(reply.status).toBe(201);

  await expect(page.getByText('The second pass only normalises the sign.')).toBeVisible();
  await expect(page.getByTitle('Written by an agent through the API')).toBeVisible();
});

test('hides a thread to a marker on its line, and shows it again from the marker or with H', async ({
  page,
  diffle,
}) => {
  await seedThreads(diffle.url, [{ path: 'tally/ledger.py', startLine: 3, body: 'Name the unit.' }]);
  await gotoFile(page, 'tally/ledger.py');
  // The thread also sits in the panel; its card in the diff is the one with a Hide button.
  const card = page.getByTitle('Hide (H)');
  await expect(card).toBeVisible();

  await card.click();
  await expect(card).toBeHidden();
  const marker = page.getByRole('button', { name: /^Show the thread \(1 message/ });
  await expect(marker).toBeVisible();
  await marker.click();
  await expect(card).toBeVisible();

  await clickLine(page, 'tally/ledger.py', 3);
  await page.keyboard.press('H');
  await expect(card).toBeHidden();
  await expect(marker).toBeVisible();
  await page.keyboard.press('H');
  await expect(card).toBeVisible();

  // A jump from the threads panel shows a hidden thread's card.
  await page.keyboard.press('H');
  await expect(card).toBeHidden();
  await page.locator('aside').last().getByText('Name the unit.').click();
  await expect(card).toBeVisible();
});

test('two hidden threads on one line share one marker, which shows both', async ({ page, diffle }) => {
  await seedThreads(diffle.url, [
    { path: 'tally/ledger.py', startLine: 3, body: 'Name the unit.' },
    { path: 'tally/ledger.py', startLine: 3, body: 'And the sign.' },
  ]);
  await gotoFile(page, 'tally/ledger.py');
  const cards = page.getByTitle('Hide (H)');
  await expect(cards).toHaveCount(2);
  // The second card slides under the pointer, whose tooltip takes over the button's title; move off first.
  await cards.first().click();
  await page.mouse.move(0, 0);
  await cards.first().click();
  await expect(cards).toHaveCount(0);

  const marker = page.getByRole('button', { name: 'Show 2 threads (2 messages)' });
  await expect(marker).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Show the thread/ })).toHaveCount(0);
  await marker.click();
  await expect(cards).toHaveCount(2);

  // H works on the whole line too: both become the one marker, and back.
  await page.mouse.move(0, 0);
  await clickLine(page, 'tally/ledger.py', 3);
  await page.keyboard.press('H');
  await expect(cards).toHaveCount(0);
  await expect(marker).toHaveCount(1);
  await page.keyboard.press('H');
  await expect(cards).toHaveCount(2);
});

test('hidden and resolved threads on one line get separate markers, each showing its own', async ({ page, diffle }) => {
  const [, done] = await seedThreads(diffle.url, [
    { path: 'tally/ledger.py', startLine: 3, body: 'Name the unit.' },
    { path: 'tally/ledger.py', startLine: 3, body: 'Settled already.' },
  ]);
  await fetch(new URL(`api/threads/${done!.id}/resolved`, diffle.url), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ resolved: true }),
  });
  await gotoFile(page, 'tally/ledger.py');
  const cards = page.getByTitle('Hide (H)');
  await expect(cards).toHaveCount(1); // resolving hid the other one: a marker, not gone
  await cards.click();
  await page.mouse.move(0, 0);
  // Hidden is kept with the thread, so it survives a reload.
  await page.reload();
  await gotoFile(page, 'tally/ledger.py');

  const hidden = page.getByRole('button', { name: 'Show the thread (1 message, H)' });
  const resolved = page.getByRole('button', { name: 'Show the resolved thread (1 message)' });
  await expect(hidden).toHaveCount(1);
  await expect(resolved).toHaveCount(1);
  // Show the first thread: the second stays a marker, which still hangs on the code line, above
  // the card now shown on that line, not under it.
  await hidden.click();
  await expect(cards).toHaveCount(1);
  await expect(resolved).toHaveCount(1);
  const markerBox = (await resolved.boundingBox())!;
  const cardBox = (await cards.boundingBox())!;
  expect(markerBox.y + markerBox.height).toBeLessThanOrEqual(cardBox.y);
});
