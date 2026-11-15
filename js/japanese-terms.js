let terms, pending, languageModule, moduleRetry = 0;

function languageLoader() {
  languageModule ??= import('./translations.js' + (moduleRetry ? `?terms-retry=${moduleRetry}` : ''))
    .catch(error => { languageModule = undefined; moduleRetry++; throw error; });
  return languageModule;
}

// The module itself is safe to import without downloading a translation bank.
export async function loadTerms() {
  if (terms) return terms;
  pending ??= languageLoader()
    .then(({ loadLanguage }) => loadLanguage('terms', 'ja'))
    .then(entries => (terms = entries))
    .finally(() => { pending = undefined; });
  return pending;
}

export async function mountTerms(scope = document) {
  const targets = [
    ...(scope.matches?.('[data-ja-term]') ? [scope] : []),
    ...scope.querySelectorAll('[data-ja-term]'),
  ];
  if (!targets.length) return 0;
  const entries = await loadTerms();
  let mounted = 0;
  for (const target of targets) {
    // A render may replace the page while the small language pack is loading.
    if (!target.isConnected || !(scope === target || scope.contains(target))) continue;
    const id = target.dataset.jaTerm, text = entries[id];
    if (typeof text !== 'string' || !text.trim()) continue;
    const suffix = `（${text}）`;
    if (target.tagName === 'OPTION') {
      // Native iOS pickers use text or the optional label attribute, never spans.
      if (!target.textContent.endsWith(suffix)) target.textContent += suffix;
      if (target.hasAttribute('label') && !target.label.endsWith(suffix)) target.label += suffix;
    } else {
      let span = [...target.children].find(child => child.classList.contains('japanese-term'));
      if (!span) {
        span = target.ownerDocument.createElement('span');
        span.className = 'japanese-term';
        target.append(span);
      }
      span.lang = 'ja';
      span.textContent = suffix;
    }
    target.dataset.termReady = id;
    mounted++;
  }
  return mounted;
}
