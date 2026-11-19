# 词根、词缀与词族

当前收录 41 个条目（12 个前缀、10 个词根或完整基础词、19 个后缀），208 张词卡含人工拆分，5 张有拆词陷阱。20 道现有语法题的 80 个选项有人工词形提示，包括全部 `gram-word-form` 题。只给词源正确且有助于理解的词添加数据；没有数据的词正常显示完整词卡，不自动猜根。

## 学习界面与权限

答题前没有拆分节点、数据请求或提示。答后只给正确答案和用户选择的词显示拆分；中文或日文选项先对应回完整词卡。语法词形提示只在答后出现，全部现有选项与保存的提示逐项绑定。

词根家族本身有「报告词根问题」入口，保存形式、中日释义、例词、说明和来源；词卡详情也有拆分和「报告词卡问题」入口；图鉴浏览使用独立学习权限门，保存词卡 ID、义项、例句、搭配和拆分快照，不伪造作答记录。设置内的问题报告可逐条打开查看，仍沿用既有存档 issues 结构。点击有颜色的词根或词缀可以查看家族，再打开其中的词卡。图鉴的「词根图鉴」页按前缀、词根、后缀筛选；点亮由既有 `seen[id]`、`words[id].tries/right` 或快筛 `screening.marks[id]` 的有效已判状态（learn/unconfirmed/verified/studied）推导；仅进入快筛队列或尚未完成的抽查不会点亮，不添加存档字段。仅浏览不会增加 XP、改变 SRS、点亮更多词根或生成每日任务。

`reviewedAnswer` 仍是普通练习、诊断反馈、快筛和已交卷模考的统一权限门；进行中的模考不会展示或响应词根操作。`wordDetailsSlot` 与 `answerDetailsSlot` 是可供后续词族、例句等内容共用的挂点。扩展必须在现有权限检查后渲染，不能从未回答的选项反查内容。

## 数据格式

`data/morphemes.json` 为 `{version:1,sources,entries,grammarHints}`。

每个 `entries` 项：

- `id`：稳定标识，如 `pre-in-not`、`root-port`、`suf-ee`。
- `type`：`prefix`、`root` 或 `suffix`。
- `forms`：形式与真实变体数组。否定 `in-/im-/il-/ir-` 与“进入”的 `in-/im-` 分成不同条目。
- `zh`、`ja`：中文、日语意义；可选 `noteZh`、`noteJa` 必须成对。
- `pos`：后缀对应的词性数组，如 `['n.']`。它是学习线索，绝非机械判题规则。
- `kanji`：仅有自然对应时添加，如 `再`、`入・輸入`。
- `examples`：2–6 个真实词卡 ID，且这些词卡必须显式关联此条目。
- `sources`：来源表 ID。界面可以打开实际词典或机构的原始页面。

词卡可选字段：

```json
{
  "parts": [
    {"text": "trans", "morpheme": "pre-trans"},
    {"text": "port", "morpheme": "root-port"},
    {"text": "ation", "morpheme": "suf-ion"}
  ],
  "partsNote": {"zh": "必要时说明拼写或意义变化。", "ja": "必要な場合は綴りや意味の変化を説明します。"}
}
```

所有 `text` 按顺序拼接必须与 `word` 完全相同。未链接的片段只是词干或其余部分，不声称它是另一个拉丁词根。历史词干、完整现代基础词与复合词会在说明中区分；例如 `interview` 整体作为基础词，`copyright` 的 `right` 是完整名词，不是后缀。

`partsTrap` 为 `{zh,ja,sources}`。`portion` 不属于“搬运”的 `port` 家族；`invaluable` 不是 valuable 的反义词；`inflammable` 不是“不易燃”。另外明确 `quarterly`、`costly` 在词卡中的形容词用法，避免把所有 `-ly` 都当副词。

`grammarHints[questionId]` 是与四个现有选项逐项绑定的数组：`{text,ending,label,morpheme?}`。`ending` 仅供标记实际词尾，不把不规则形式或整个短语硬拆。提示明确区分派生后缀、动词屈折变化和比较级 `-er`；`-ee` 中的 attendee 也明确不是被动规则的无例外实例。

## 来源与人工审校

构词的一般规则参照 [Cambridge English Grammar Today](https://dictionary.cambridge.org/grammar/british-grammar/word-formation_2)、[British Council](https://africa.teachingenglish.org.uk/classroom/grammar/prefixes) 与 [Athabasca University](https://www.athabascau.ca/write-site/english-grammar-handbook/basic-grammar/word-forms.html)。历史根以 Merriam-Webster 的 Word History 为依据，如 [transport](https://www.merriam-webster.com/dictionary/transport)、[inspect](https://www.merriam-webster.com/dictionary/inspect)、[subscribe](https://www.merriam-webster.com/dictionary/subscribe)、[construct](https://www.merriam-webster.com/dictionary/construct)、[reject](https://www.merriam-webster.com/dictionary/reject)。所有学习解释由本项目重新撰写，例词引用本项目词卡，不复制词典例句。

新增拆分时需逐条检查：词源是否同族、当前义项是否适合、变体是否真实、英文能否逐片拼回、日语是否自然。不能用一个前缀/后缀匹配器批量声称词源正确。`copy/copyright`、`interview/interviewer/interviewee` 在此作为完整基础词家族学习；既有 confusables 字段与音频源索引保持原样，常规训练中的精选易混组由下一阶段单独处理。

## 翻译与音频

`morphemeSourceUnits(data)` 从形式生成稳定英文键 `morph-<id>/forms/<index>`；中日译文在 `data/i18n/{zh,ja}/morphemes.json`，必须与人工定义一致。新增变体只追加，不能通过调整数组顺序改变旧键含义。

`morphologyAudioUnits(data,vocab)` 导出给音频作者的英文与日语单位，音频 `bank` 使用 `vocab`：英文形式与日语义项共用形式键，日语另有 `morph-<id>/meaning`、`morph-<id>/note`、`<word-id>/parts-note` 和 `<word-id>/parts-trap`。当前共 211 单位。形式按钮明确为「听拼写」，按字母名称读，不把孤立词缀当作只有一种固定发音；旁边完整例词按钮示范实际词内发音。调用播放时保留 `text` 原形式供精确录音匹配，显式 `systemText` 仅让系统后备读同一串字母名；不修改显示或源键。日语按钮读完整解释，不拼读没有独立词义的拆分碎片。原词头、例词、语法选项继续使用其原音频键。

音频生成与真实识别由独立音频流程完成。仅有单位表、UI 测试或系统语音后备，不能代替录音/ASR 覆盖验收。

## 加载、离线与校验

`js/morphemes.js` 按需加载 `data/morphemes.json`，先验证结构再写入专用 CacheStorage；网络失败时回读有效包。新 JS/CSS 与包含中日释义的词根数据加入 SW 壳资源，并在实际发布时升级壳版本。`data/i18n/{zh,ja}/morphemes.json` 不在安装时预取，首次请求后按普通译文包规则缓存；词根卡离线显示直接使用词根数据内的释义。词根数据不增加首屏同步载荷。

```sh
node scripts/build-morpheme-packs.mjs
node scripts/validate-morphemes.mjs
node scripts/validate.mjs
node --test tests/morphemes.test.mjs
node tests/v6.cjs morphemes
PW_ENGINE=webkit node tests/v6.cjs morphemes
```

手机用例覆盖 375、390 深色、430 像素：答前保护、答后/词卡家族、日语与英文点击朗读、派生点亮、浏览不改变 SRS/XP、缓存包请求失败恢复、问题报告原因、词性后缀标记、portion 陷阱及无水平溢出。自动化并不替代实体 iPhone 对新增录音的实际试听。

词根包是对象格式，SW 使用 `validMorphemePack` 的专用结构门联网优先更新，拒绝空集合、重复 ID、缺失来源、错误词性等坏响应后回读最近有效包；首装缓存也检查同一结构。页面仍保留自身经过 `validMorphemes` 检查的缓存。用 `node tests/morphemes-sw.cjs` 验证真实更新、坏包回退和关服冷重开；可设置 `PW_ENGINE=webkit`，默认 Chrome，覆盖375/390深色/430。
