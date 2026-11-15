const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, '../../data', name), 'utf8'));
const terms = read('i18n/ja/terms.json').entries;
const grammar = read('grammar.json');
const methods = read('methods.json');

module.exports = async ({ page, act, nav }) => {
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.reload();
  await page.locator('.habitat').waitFor();
  assert(!requests.some(url => /japanese-terms\.js|i18n\/ja\/terms\.json/.test(url)), 'home does not load term code or data');
  const fit = async label => {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label + ': page overflow');
    const clipped = await page.locator('.japanese-term:visible').evaluateAll(nodes => nodes.some(node => {
      const parent = node.parentElement;
      return parent.scrollWidth > parent.clientWidth + 1;
    }));
    assert(!clipped, label + ': Japanese title overflow');
  };
  async function configureGrammar() {
    await nav('learn');
    await page.locator('[data-act=configure][data-mode=grammar]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('#mode-filter option')]
      .length === 17 && [...document.querySelectorAll('#mode-filter option')].every(option => option.dataset.termReady));
  }
  await configureGrammar();
  const options = await page.locator('#mode-filter option').evaluateAll(nodes => nodes.map(node => ({
    value: node.value, text: node.textContent, children: node.children.length,
  })));
  assert.equal(options.length, 17);
  for (const topic of grammar) {
    const option = options.find(item => item.value === topic.id);
    assert(option.text.includes(topic.title) && option.text.endsWith(`（${terms[topic.id]}）`), topic.id);
    assert.equal(option.children, 0, 'native picker labels must be text');
  }
  await fit('grammar picker');
  for (let index = 0; index < grammar.length; index++) {
    const topic = grammar[index];
    if (index) await configureGrammar();
    await page.locator('#mode-filter').selectOption(topic.id);
    await act('configured');
    if (await page.locator('[data-act=replace]:visible').count()) await act('replace');
    const heading = page.locator(`.lesson-brief h2[data-ja-term="${topic.id}"]`);
    await heading.locator('.japanese-term[lang=ja]').waitFor();
    assert((await heading.textContent()).includes(topic.title));
    assert.equal(await heading.locator('.japanese-term').textContent(), `（${terms[topic.id]}）`);
    await fit(topic.id);
  }
  await nav('learn');
  await act('method-list');
  await page.waitForFunction(() => document.querySelectorAll('.method-list [data-term-ready]').length === 22);
  for (const method of methods) {
    const button = page.locator(`[data-act=method-open][data-method="${method.id}"]`);
    assert.equal(await button.locator('.japanese-term[lang=ja]').textContent(), `（${terms[method.id]}）`);
    await button.click();
    const card = page.locator(`dialog[open] [data-method-card="${method.id}"]`);
    await card.locator('h2 .japanese-term[lang=ja]').waitFor();
    assert.equal(await card.locator('h2 .japanese-term').textContent(), `（${terms[method.id]}）`);
    assert.deepEqual(await card.locator('.method-diagram [lang=en]').allTextContents(), method.steps.map(step => step.text));
    const panel = card.locator('[data-translation-method]');
    await panel.locator('[data-act=translate]').click();
    await panel.locator('.translation-line [lang=ja]').first().waitFor();
    assert.equal(await panel.locator('.translation-line').count(), 2, method.id + ': translated examples');
    assert((await panel.locator('.translation-line [lang=zh-CN]').allTextContents()).every(text => text.trim()), method.id);
    assert((await panel.locator('.translation-line [lang=ja]').allTextContents()).every(text => text.trim()), method.id);
    await fit(method.id);
    await act('close');
  }
  await page.evaluate(async () => {
    const { mountTerms } = await import('./js/japanese-terms.js');
    await Promise.all([mountTerms(document), mountTerms(document)]);
  });
  assert.equal(await page.locator('.method-list .japanese-term').count(), 22, 'parallel repeat mounts do not duplicate labels');
  assert.equal(requests.filter(url => /i18n\/ja\/terms\.json/.test(url)).length, 1, 'all titles share one small term download');

  // A fresh page must recover the previously downloaded terms without the JSON network response.
  await page.route('**/data/i18n/ja/terms.json', route => route.abort());
  await page.reload();
  await page.locator('.habitat').waitFor();
  await nav('learn');
  await act('method-list');
  await page.waitForFunction(() => document.querySelectorAll('.method-list .japanese-term').length === 22);
  assert.equal(await page.locator('[data-method=keywords] .japanese-term').textContent(), `（${terms.keywords}）`);
  await fit('cached terms after reload');
};
