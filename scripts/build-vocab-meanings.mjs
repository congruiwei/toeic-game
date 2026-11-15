import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const vocab = JSON.parse(await fs.readFile(new URL('data/vocab.json', root), 'utf8'));
const full = JSON.parse(await fs.readFile(new URL('data/i18n/ja/vocab.json', root), 'utf8'));
if (full.version !== 1 || !full.entries) throw Error('日文词汇译包格式有误');
const entries = {};
for (const word of vocab) {
  const key = `${word.id}/meaning`, text = full.entries[key];
  if (typeof text !== 'string' || !text.trim()) throw Error(`缺少日语词义：${key}`);
  if (Object.hasOwn(entries, key)) throw Error(`重复词汇 ID：${word.id}`);
  entries[key] = text;
}
const path = new URL('data/i18n/ja/vocab-meanings.json', root);
const text = JSON.stringify({version:1, entries}, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (await fs.readFile(path, 'utf8') !== text) throw Error('日语词义小包已过期，请运行 node scripts/build-vocab-meanings.mjs');
  console.log(`日语词义小包：${vocab.length} 条，与完整译包一致`);
} else {
  await fs.writeFile(path, text);
  console.log(`${fileURLToPath(path)}：${vocab.length} 条，不含例句`);
}
