const assert = require('node:assert/strict');
const zhReading = require('../../data/i18n/zh/reading.json').entries;
const jaReading = require('../../data/i18n/ja/reading.json').entries;

module.exports = async ({ page, act, state, store, reset, quiz }) => {
  const moduleRequests = [], styleRequests = [];
  let unavailable = true;
  const moduleRoute = /\/js\/translation-ui\.js(?:\?.*)?$/;
  const styleRoute = /\/translation\.css(?:\?.*)?$/;
  await page.route(moduleRoute, route => {
    moduleRequests.push(route.request().url());
    return unavailable ? route.abort('failed') : route.continue();
  });
  await page.route(styleRoute, route => {
    styleRequests.push(route.request().url());
    return unavailable ? route.abort('failed') : route.continue();
  });

  await quiz('part1');
  assert.equal(await page.locator('.translations').count(), 0);
  await act('unknown');
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('翻译界面暂时'));
  await page.waitForFunction(() => !document.querySelector('link[data-translation-style]'));
  const currentURL = page.url(), beforeRetry = await state();
  const panel = page.locator('.lesson-feedback > .translations');
  assert.equal(await panel.locator('[data-act=translate]').getAttribute('aria-expanded'), 'false');

  // Reconnect without a reload or a new question: both the JS and stylesheet must recover.
  unavailable = false;
  await panel.locator('[data-act=translate]').click();
  await panel.locator('.translation-line [lang=ja]').first().waitFor();
  assert.equal(page.url(), currentURL);
  assert.equal((await state()).session.items[(await state()).session.index].id,
    beforeRetry.session.items[beforeRetry.session.index].id);
  assert.equal(await panel.locator('.translation-line').count(), 4);
  assert(moduleRequests.length >= 2, 'a failed lazy module can be requested again');
  assert(styleRequests.length >= 2, 'a failed stylesheet can be requested again');
  await panel.locator('[data-language=ja]').click();
  await page.waitForFunction(() => {
    const content = document.querySelector('.lesson-feedback > .translations [lang=zh-CN]');
    return content && getComputedStyle(content).display === 'none';
  });
  assert.equal(await panel.locator('[lang=zh-CN]:visible').count(), 0);
  assert.equal(await panel.locator('[lang=ja]:visible').count(), 4);
  await page.unroute(moduleRoute);
  await page.unroute(styleRoute);

  await reset();
  const fixture = await page.evaluate(async () => {
    const { bank, loadBank } = await import('./js/bank.js');
    await loadBank(['reading']);
    const set = bank.reading.find(item => item.id === 'read-badge');
    return { setID: set.id, questions: set.questions };
  });
  const progress = await state();
  progress.settings.methodHints = false;
  progress.settings.translationLanguage = 'both';
  progress.settings.translationExpanded = true;
  progress.session = {
    mode: 'reading', title: '短文填空回归',
    items: fixture.questions.map(question => ({ id: question.id, mode: 'reading' })),
    index: 0, right: 0, gain: 0, selected: null, elapsed: 0, timed: false, intro: false
  };
  await store(progress);
  await act('resume');
  assert.equal(await page.locator('.translations').count(), 0,
    'default expansion does not expose a translation before answering');

  const passageKey = 'read-badge/documents/0/text/3';
  const filledSentence = 'Visitors arriving for a meeting can check in at reception.';
  await act('unknown');
  const readingPanel = page.locator('.lesson-feedback > .translations');
  await readingPanel.locator('.translation-wait').waitFor();
  await readingPanel.locator('.translation-line [lang=ja]').first().waitFor();
  assert.deepEqual(await readingPanel.locator('.translation-line [lang=en]').allTextContents(),
    fixture.questions[0].options, 'the answered insertion options remain available in their original order');
  assert.equal(await readingPanel.locator('[data-translation-key*="/documents/"]').count(), 0,
    'the passage, including its translated answers, is deferred');
  const deferredText = await readingPanel.textContent();
  for (const text of [filledSentence, zhReading[passageKey], jaReading[passageKey]]) {
    assert(text && !deferredText.includes(text), 'a pending blank is absent in English, Chinese and Japanese');
  }

  // Collapsing and reopening cannot bypass the passage gate.
  await readingPanel.locator('[data-act=translate]').click();
  await readingPanel.locator('[data-act=translate]').click();
  assert.equal(await readingPanel.locator('[data-translation-key*="/documents/"]').count(), 0);

  for (let i = 1; i < fixture.questions.length; i++) {
    await act('next');
    assert.equal(await page.locator('.translations').count(), 0, 'the next unanswered question stays untranslated');
    await act('unknown');
    if (i < fixture.questions.length - 1) {
      await readingPanel.locator('.translation-wait').waitFor();
      assert.equal(await readingPanel.locator('[data-translation-key*="/documents/"]').count(), 0);
    }
  }
  const completedLine = readingPanel.locator(`[data-translation-key="${passageKey}"]`);
  await completedLine.locator('[lang=ja]').waitFor();
  assert.equal(await readingPanel.locator('.translation-wait').count(), 0);
  assert.equal(await completedLine.locator('[lang=en]').textContent(), filledSentence);
  assert.equal(await completedLine.locator('[lang=zh-CN]').textContent(), zhReading[passageKey]);
  assert.equal(await completedLine.locator('[lang=ja]').textContent(), jaReading[passageKey]);
  assert((await readingPanel.locator('[data-translation-key*="/documents/"]').count()) > 1,
    'the final answer unlocks the whole completed passage');
};
