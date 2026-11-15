const assert = require('node:assert/strict');
const translations = Object.fromEntries(['part1','part2','listening','grammar','reading'].map(bank => [bank,
  Object.fromEntries(['zh','ja'].map(lang => [lang, require(`../../data/i18n/${lang}/${bank}.json`).entries]))]));

module.exports = async ({page, nav, act, state, store}) => {
  const requests = [];
  page.on('request', request => {
    if (request.url().includes('/data/i18n/')) requests.push(request.url());
  });
  const progress = await state();
  progress.settings.translationExpanded = true;
  progress.settings.translationLanguage = 'both';
  progress.exam = await page.evaluate(async () => {
    const {bank, catalog, loadBank} = await import('./js/bank.js');
    await loadBank(['part1','part2','grammar','listening','reading']);
    const {buildExam, examIds} = await import('./js/exam.js');
    const exam = buildExam(bank, {seen:{}}, 'half', 'translation-audit');
    exam.keys = Object.fromEntries(examIds(exam).map(id => [id, catalog.get(id).data.answer]));
    exam.phase = 'done';
    exam.finishedAt = Date.now();
    return exam;
  });
  await store(progress);
  await nav('learn');
  await act('exam-lobby');
  await act('exam-result');
  assert.equal(await page.locator('.translation-line').count(), 0,
    'closed result details do not eagerly expand translations');
  assert.equal(requests.length, 0, 'closed result details do not download translation packs');

  let collected = 0;
  for (const part of [1,2,3,4,5,6,7]) {
    const id = progress.exam.units.find(unit => unit.part === part).ids[0];
    // Result cards appear in both the full review and the mistakes section.
    // Use the visible mistakes card without opening the full-review container.
    const panel = page.locator(`.exam-item-review > .translations[data-translation-id="${id}"]`).last();
    const detail = panel.locator('xpath=ancestor::details[1]');
    await detail.locator(':scope > summary').click();
    await panel.locator('.translation-line [lang=ja]').first().waitFor();
    const rows = await panel.locator('.translation-line').evaluateAll(lines => lines.map(line => ({
      key:line.dataset.translationKey, bank:line.dataset.translationBank,
      en:line.querySelector('[lang=en]').textContent,
      zh:line.querySelector('[lang=zh-CN]').textContent,
      ja:line.querySelector('[lang=ja]').textContent
    })));
    assert(rows.length > 0, `Part ${part} has translated material`);
    for (const row of rows) {
      assert(row.en.trim());
      assert.equal(row.zh, translations[row.bank].zh[row.key]);
      assert.equal(row.ja, translations[row.bank].ja[row.key]);
    }

    let collect;
    if (part <= 4) {
      const replay = detail.locator('.sentence-panel');
      await replay.locator(':scope > summary').click();
      const singles = replay.locator('.translations');
      assert.equal(await singles.count(), await replay.locator('[data-act=sentence-play]').count(),
        `Part ${part} gives every replay sentence its own translation`);
      const first = singles.first();
      await first.locator('[data-act=translate]').click();
      await first.locator('.translation-line [lang=ja]').waitFor();
      assert.equal(await first.locator('.translation-line').count(), 1);
      assert.equal(await first.locator('.translation-line [lang=en]').textContent(),
        await replay.locator('[data-act=sentence-play] [lang=en]').first().textContent());
      collect = first.locator('[data-act=collect-expression]');
    } else {
      collect = panel.locator('[data-act=collect-expression]').first();
    }
    if (part === 6) {
      assert(await panel.locator('[data-translation-key*="/documents/"]').count() > 0,
        'the submitted exam unlocks the completed Part 6 passage');
      assert.equal(await panel.locator('.translation-wait').count(), 0);
    }
    const snapshot = await collect.evaluate(button => {
      const line = button.closest('.translation-line');
      return {key:button.dataset.key, bank:button.dataset.bank,
        en:line.querySelector('[lang=en]').textContent,
        zh:line.querySelector('[lang=zh-CN]').textContent,
        ja:line.querySelector('[lang=ja]').textContent};
    });
    await collect.click();
    collected++;
    await page.waitForFunction(count =>
      JSON.parse(localStorage.getItem('sprout-isle.save')).expressions.items.length === count, collected);
    const saved = (await state()).expressions.items.find(item => item.key === snapshot.key);
    for (const field of ['key','bank','en','zh','ja']) assert.equal(saved[field], snapshot[field]);
    assert.equal(await collect.textContent(), '已收藏');
    await detail.locator(':scope > summary').click();
  }
  const after = await state();
  assert.equal(after.xp, progress.xp, 'reviewing and collecting do not award a second question reward');
  assert.deepEqual(after.history, progress.history);
  assert.deepEqual(after.words, progress.words);
  assert.deepEqual(after.exam.keys, progress.exam.keys, 'translation review leaves the submitted answer snapshot intact');

  // The parallel full-review card remains usable and reflects the already collected line.
  const id = progress.exam.units[0].ids[0];
  const firstPanel = page.locator(`.exam-item-review > .translations[data-translation-id="${id}"]`).first();
  const card = firstPanel.locator('xpath=ancestor::details[1]');
  const container = card.locator('xpath=ancestor::details[1]');
  await container.locator(':scope > summary').click();
  await card.locator(':scope > summary').click();
  await firstPanel.locator('.translation-line [lang=ja]').first().waitFor();
  const same = firstPanel.locator(`[data-act=collect-expression][data-key="${after.expressions.items[0].key}"]`);
  assert.equal(await same.textContent(), '已收藏');
  assert.equal(await same.isDisabled(), true);
};
