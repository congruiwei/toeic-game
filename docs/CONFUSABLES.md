# 易混词：策展数据与对决

`data/confusables.json` 是唯一策展源：47 组，形近 30、音近 10、义近 7；98 个精确义项，其中 91 个引用完整词卡、7 个是独立轻量义项。94 道原创对决只使用本组的 2–4 个词。ensure、alternatively、receipt、shareholder 仍保留对比，但不强迫为存在合法用法重叠的方向设置单选题。carrier / courier 在具体运输场景可能重叠，相应两题从选项中排除了另一运输词。

## 数据字段

- `groups`: `id/type/members/difference.{en,zh,ja}`；每组 2–4 个 sense ID。
- `words`: 按 ID 索引，含 `wordId/word/pos/ipa/zh/ja/example/exampleZh/exampleJa`。引用原卡时 `id===wordId`，这些字段须与原卡精确一致；轻量项为 `lex-conf-*` 且 `wordId:null`。
- `questions`: `id/groupId/wordId/level/sentence/prompt/options/answer/en/zh/sentenceZh/sentenceJa`。`sentence` 是完整自然句，`prompt` 只替换目标词一次。使用 `wordId` 绑定目标义项，绝不按拼写找最后一个同名词。
- `part2Traps`: 5 条人工标注，绑定原题 ID 和精确错误选项；可有 `groupId/sourceWordId/distractorWordId`，也可只解释该题音近陷阱。project/projector、counter/counted 不因此成为对决组。
- `retiredPairs`: 340 个退出常规出题候选优先级的旧配对；`removedPairs` 另列其中 51 个透明词族关系，转交词根词缀教学。这不是删除历史媒体。

`vocab.json` 中旧 `confusables` 数组完全保留，只维持已发布音频键的位置及历史内容。**出题器不再读取它们**。`data/confusable-candidates.json` 是策展组派生的英文候选投影，只含卡 ID、英文词头、`semanticAvoid` 中显式重叠的词对和 `part2TrapIds` 中的原题 ID，正常词题在答前仅加载这个小包。陷阱 ID 由 `part2Traps` 派生并逐字校验，不包含正确答案或解释；旧包缺此字段时对 Part 2 保守加载完整数据。正常四选题仍执行释义重复、同词多义、`avoidWith` 与同音排除，并经过原长度/位置校验。对决题专门比较同一组 2–4 个词，不用无关选项凑四个；二选题长度天然不能满足四选题的最长率阈值，因此该模式检查完整选择集、唯一目标和人工语义审核，不声称沿用了四选长度分布。

## 界面与学习记录

有人工标注的 Part 2 错误选项会在答后逐项释义的选项旁直接标出「音近陷阱」。答后选项释义完成后按正确/所选义项显示相关组；图鉴只在展开卡片后加载对比。先用小索引排除无关词卡和题目，有关项才读取大包。`confusable-ui.js` 和 `confusables.css` 首次实际展示对比时加载；普通首页、首题以及不含相关组的答后内容都不会请求这两个资源。可选对比下载失败会独立显示重试按钮，已成功显示的选项释义、收藏和朗读保留；重试不会重评答案。答案提交前和未交卷模考没有对比按钮或解释。组内任意两词都可连听，英文使用 `vocab` 音频 bank 的精确成员 ID `/meaning`，日语朗读对应释义；成员例句提供英文、日文独立朗读，使用同一成员的 `/example/0` 键。不会因同拼写借用另一个词性录音。

`confusable` 作为普通练习模式保存在现有 session 中，能力为 vocabulary，但不进入 TOEIC 分数证据。一次客观作答只记一次 XP、报告和错题；原卡使用确切 `wordId` 更新同一 FSRS。错误自动把目标义项加入「我的单词本」，轻量项保留三语、原例句及本题来源句快照。答对超过 8 秒为 Hard，其他正确为 Good，错误/不知道为 Again。对决错题使用现有非词卡到期机制，连续两次正确才退出；个人翻卡自评不增加客观正确率。

存档无新增独立状态容器；旧档仍按原逻辑迁移。导入/刷新含 `mode:confusable` 的档案会先加载对决 catalog 再做退役 ID 核查。原有试卷冻结材料/选项不由此重写。词根模块对对决题使用相同的 `wordId` 与 `optionWordIds`，不会将同拼写的另一词性也标为正确答案；词卡与答后各自保留词根、易混词两个独立内容区。

## 翻译与音频

`sourceUnits('confusables', data)` 导出独立翻译 bank：

- 每组 `<group-id>/difference/0`。
- 每道对决 `<question-id>/sentence/0`，仅答后完整句。
- 每个轻量词 `<lex-conf-id>/meaning`、`/example/0`。

共 155 个英文单位，在 `data/i18n/{zh,ja}/confusables.json` 一一对应；91 个原卡的词头、例句及译文直接复用现有词卡键。实际音频由构建器映射到 `vocab` bank；翻译 UI 的读取 bank 仍是 `confusables`，播放时显式映射到 `vocab`。新增词句必须经过既有实际合成、ASR、版本/SHA 校验流程。

## 验证

```
node scripts/validate.mjs
node scripts/validate-confusables.mjs
node --test tests/confusables.test.mjs tests/japanese-vocab.test.mjs tests/option-details.test.mjs
node tests/v6.cjs confusables
PW_ENGINE=webkit node tests/v6.cjs confusables
node tests/confusables-offline.cjs
PW_ENGINE=webkit node tests/confusables-offline.cjs
```

Node 覆盖词性/义项漂移、候选投影、全部 94 题的选项释义、音近排除、精确 FSRS、轻量存档、双对退出及陷阱绑定。浏览器覆盖 375/390/430px、答前保护、错词提示、任意两词连听、日语朗读、报告原因、刷新、单词本翻卡和双引擎布局。service worker 验证两个对象数据包的结构后缓存，坏 HTML 或不完整对象不会覆盖已有缓存；对比解释和译文按需缓存，两个展示资源也只在首次请求时存入当前版本缓存，不随安装预取。未曾打开的可选对比没有离线保证，已打开的对比可离线使用。两种易混对象包无网络且无合法缓存时返回不可缓存的 503，由界面显示独立重试；这避免 WebKit 将 SW 的 `Response.error()` 另报为页面异常。离线测试使用真实 service worker，覆盖网络中断后冷重开对决、单词本与错题复习，以及可选大包缺失时保留已有选项释义和收藏。
