# 翻译数据

英文与题目 ID 以原题库为准。翻译独立保存为 `data/i18n/{zh,ja}/{bank}.json`，不把译文混进题干、选项或评分数据。

```json
{
  "version": 1,
  "entries": {
    "p2-015/audio/0": "备品电缆该放在哪个箱子里？",
    "p2-015/options/0/0": "贴有绿色标签的那个。"
  }
}
```

上面只是格式示例；运行时用 `js/translation-source.js` 从原题库取得对应英文。`sourceUnits(bank, records)` 是校验、逐句对照及收藏定位共同使用的源单位定义。

- 词卡：`{id}/meaning` 为释义，`{id}/example/{sentence}` 为例句。不同义项各用自己的词卡 ID。
- Part 1：`{id}/options/{option}/{sentence}`。
- Part 2：`{id}/audio/{sentence}` 与选项键。
- Part 3/4：`{groupId}/turns/{turn}/{sentence}`；每个题目用自己的 ID 保存 `prompt/{sentence}`、`options/{option}/{sentence}`。
- 听写：`{dictationId}/text/{sentence}`。
- Part 5：`{questionId}/sentence/{sentence}`，英文先填入正确答案再切句。
- Part 6/7：`{groupId}/documents/{document}/title` 和 `text/{sentence}`。Part 6 先按题干中的空位编号填入正确答案；句子插入的四个选项各自翻译。Part 7 的题干、选项也各自翻译。
- 表格：`graphic/headers`、`graphic/rows/{row}`；阅读表格在 `documents/{document}/table/` 下。每一行以 ` | ` 分隔单元格，列数必须与英文相同，数字、时间、型号保持原样。
- 方法卡示例：`{methodId}/steps/{step}/{sentence}`。

索引从 0 开始。英文句子的边界保留称谓、时间缩写、引号内缩写与后续小写续句。源文只有人名、产品名、数字或插入位置标记时，没有可翻译的文字；数字及标记由校验器识别，专名例外须在 `data/i18n/literals.json` 逐项写明原文和理由。

新增内容后，为两个语言文件补齐所有新键，运行 `node scripts/validate-i18n.mjs`。校验拒绝缺失、多余、空白、误用英文原文的译文及列数变化。不要根据译文重新生成源题 ID，也不要用翻译键代替错题本中的题目 ID。


日语释义另有 `ja/vocab-meanings.json` 小包，只包含1087个 `/meaning` 键，内容必须逐字等于完整日语vocab包。修改词义后运行 `node scripts/build-vocab-meanings.mjs`，提交生成结果。不要手工维护两份不同释义。`ja/terms.json` 用语法主题／方法卡ID直接对应日语标题术语。

`node scripts/validate.mjs` 已包含本页的翻译覆盖与术语检查，也会验证释义小包及标题包。结构检查使用原英文分句生成的稳定键，一条英文源单位对应一条译文记录，并拒绝引语外把一个源句拆成两句（包含第二句未写句末标点）；原文明确的邮件落款按精确同名署名处理，片段选项可无句末标点。表格逐行保存、逐列验证。译文语义及商务日语语体需要人工复核，见 [中日审校记录](BILINGUAL_QA.md)。
