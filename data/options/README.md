# 选项释义与我的单词本数据

这些文件补充现有题库，不修改题目、答案、英文原文或翻译键。

运行 `node scripts/build-options.mjs` 生成运行时文件，再运行 `node scripts/validate-options.mjs` 和 `node --test tests/option-*.test.mjs`。生成器遇到未收录的实际选项会失败；`--inspect` 只把排查信息写入 `/private/tmp/isle-options/`，不生成缺项的运行时包。

- `part1.json`、`part2.json`、`grammar.json`、`listening.json`、`reading.json`：`{version:1,entries:{questionId:{signature,context,options}}}`。每项包含原样的 `text`、`kind` 和中文 `reasonZh`；词义用 `lexical` 指向字典，已有整句或短语翻译用 `translationKeys` 精确复用。短语另标 `pos`。插入位置标记为 `position`，不是可收藏单词。
- `vocab.json`：每个既有词卡 ID 有签名，以及原词和三个填空干扰项分别对应的 `reasons`。另外六种动态词卡题型以生成出的实际选项反查精确义项，运行时比较词头、中文、日文或 paraphrase，不依赖选项位置。
- `lexicon/a.json` 至 `z.json` 和 `other.json`：按规范化选项的首字母分片，每项包含 `pos`、`zh`、`ja` 和 `lexemes`。规范化为 NFKC、小写、合并空格；题面拼写保持不变。
- `lexemes` 中每个义项有 `id/word/pos/zh/ja`；已收录词卡另有准确的 `wordId`，并保留音标、原例句、义项标签。多词性原形可拆成多个独立词条，屈折形式的显示释义只使用对应词性的义项。非规范语法干扰项有形式说明且 `lexemes:[]`，不会保存成错误词汇。
- `authoring/*.json`：人工整理的词典源条目数组。词性不能从目标词或题目主题直接复制。多个词性的释义不同，应分条填写，避免将名词的“把手”套到动词形式 handling。
- `authoring/reasons-static.json` 和 `authoring/reasons-vocab.json`（需要时创建）：结构为 `{questionId:{exactOptionText:reasonZh}}`，用于保留逐项人工复审的具体修订。不要只改生成文件，否则重建会覆盖。

`signature` 将解析绑定原题内容和选项。修改原题后必须重新生成并检查理由；签名只是防止误配，不能代替语义复审。静态题的理由引用已有解析与原文证据，并逐项解释选项本身；词汇填空另引用已有中文例句来明确场景。

`js/option-details.js` 仅在答后面板打开时加载相应包、所需字母分片和现有翻译。单词释义仅需要日文小包，不需要整本词汇例句译包。浏览器 Cache API 保存已经访问的包供离线复查；`invalidateOptionDetails()` 或 `loadOptionDetails(...,{refresh:true})` 允许联网后替换合法但已过期的缓存。

个人本只保存收藏时的释义、原例句、来源上下文与 FSRS 快照。已有词卡共享该 `wordId` 的 FSRS；库外词保存为个人简卡。收藏及翻卡自评不增加客观题正确率、XP 或估分。移除收藏不删除原词卡学习记录。保存、导出以及删除退役题目 ID 之前需调用 `syncPersonalVocab`，避免快照落后；旧 ID 退役后已有收藏仍可离线复习。
