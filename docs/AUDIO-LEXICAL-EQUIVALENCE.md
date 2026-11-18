# 修复后的有限词典等价认定

此工具用于解释实际强 ASR 转写中的少量同音或异体拼写差异。它读取已完成修复的音频、真实合成配方和实际识别缓存，不生成音频、不运行识别，也不修改通用比较器。词典与输入配方证据不等于人工听感验收；原始 ASR 的 `review` 及其不等价比较证明始终保留。

## 允许的边界

`scripts/audio-lexical-rules.json` 保存有限规则、精确音素 token 和词典来源。每条只允许一种定向差异及实际选择的读音，不把词典的所有异读任意合并。例如 `route` 的 /ruːt/ 可与 `root` 对应，/raʊt/ 则不行；源文明示履历名词 `résumé` 可对应无重音符的拼写，不能据此合并动词 `resume`。

所选条目必须同时通过以下检查：

- 最终 repair 已完成且为 `recorded-review`。原始与当前媒体 SHA 不同，原文、语言、声线保持一致。
- 源文件、当前 clip、最终 repair candidate、现行 override、manifest 合成参数、实际文件 SHA 和大小全部一致。
- 完整 appliedOverride 的 phoneme SHA 与 clip 一致，重新计算的 input SHA 正确。规则还锁定已逐项审查的完整原文、spoken、声线、来源 key 和完整音素配方；不能借用同句另一个未变词的同音音素。
- 原始 ASR 是固定允许 SHA 的 whisper-large-v3-turbo 或 whisper-large-v3、CPU/int8、individual beam 5，没有 prompt、hotwords 或前文条件。指纹、外部实际缓存、分段、转写及比较证明绑定当前媒体；证明保留指纹的精确序列化输入，Python 与 Node 均核对其内容和 SHA。
- spoken 与 recognized 仅有一处批准的定向词形差异，原文有唯一锚点，其他词和符号相同。不删除冠词、单复数、过去式、否定、所有格或近音差异。

姓名读法只按已验证的实际配方处理：`p2-017/options/2/0` 的完整句子及 `lˈuɪs` 配方允许唯一的 Luis → Lewis 拼写差异，两者 Cambridge 英语条目均列 /ˈluː.ɪs/；不把 Luis 的其他读法或其他姓名、句子一概合并。最终媒体 SHA 与真实 ASR 指纹仍由批准计划单独绑定。

姓名读法未核定、缺失词尾、增加音节等情况保留复听。新增规则需要词典原始依据和对应实际合成配方，并补充正反例；不能只因为 ASR 结果接近而新增规则。CMUdict 的个别发音依据注明 Carnegie Mellon 来源，同时记录所用词表版本及 SHA。

## 数据与发布校验

方法名为 `selected-recipe-lexical-equivalence-v1`。成功认定时，当前 audit 仅新增 `acceptance` 并将 `status` 改成 `accepted`；原始 `comparison.equivalent` 仍为 false，转写、分段、模型身份等字段原样保留。

独立证明追加到 `quality-review.records[token].lexicalEquivalences`，包含完整原始 ASR、完整输入音素、当前媒体与配方绑定、规则及来源、决策 token 和证明 ID。`baseline`、首轮 `comparison`、`strongerASR`、`repair.original`、`repair.candidate` 与 retry 历史不改。

`stages.postRepairLexicalEquivalence` 单独报告当前认定数、不同媒体数、零新识别调用和零媒体修改。主校验返回 `lexicalAcceptedCount` / `lexicalAcceptedItems`。`audit-summary.json` 仍表示最近一次实际识别运行，工具不会伪造其调用数。

Python 发布同步与 Node 最终校验分别验证证明。单独写入 `status:'accepted'` 不足以通过校验；缺失、null、未知方法、重复证明、失配 SHA 或修改转写均被拒绝。既有 unchanged-PCM context 认定和日语设备声音后备保持各自独立门禁。

## 计划与运行

计划是版本 1 的 JSON：顶层含 `sourceSha256` 与 `entries`。每项精确指定 `token`、`sourceText`、`spoken`、`recognized`、`audioSha256`、`phonemeSha256`、`voiceId`、`actualAsrFingerprint` 和 `ruleId`。计划应在音频作者完成后按最终媒体核对；任何绑定变化都必须重新审查，不能沿用旧结论。

```sh
# 默认预览；不写仓库，不创建模型 session。
python scripts/accept-repair-equivalence.py --repo /path/to/repo --workdir /path/to/external-work --plan /path/to/approved-plan.json

# 仅在计划审查通过、音频作者已退出后显式应用。
python scripts/accept-repair-equivalence.py --repo /path/to/repo --workdir /path/to/external-work --plan /path/to/approved-plan.json --apply
node scripts/validate-bank-audio.mjs
```

`--repo` 默认是脚本所在仓库，`--workdir` 默认是用户目录下 `.local/share/toeic-kokoro`，必须位于仓库外。运行需要实际 ASR 缓存；公开克隆中的证明校验不依赖私有模型或缓存目录。

应用取得 `bank-retry.lock`、`bank-generate.lock`、`bank-audit.lock`，任一被占用则立即拒绝，不终止任何进程。所有候选完成预检且发布门禁已安装后才写入：先原子写质量证明，再原子写相关 audit，最后用既有 `bank.flush` 同步 pack 与索引，原合成 generation 不变。

这不是跨文件事务。若中断，用同一批准计划重跑可恢复；证明不会重复追加，已有其他方法或失配证明不会被覆盖。完整成功后再次运行不改变文件字节。恢复和完整校验完成后再发布。

## 测试

```sh
python tests/bank-audio-lexical.test.py
python tests/bank-audio-lexical-integration.test.py
node --test tests/bank-audio-lexical.test.mjs tests/bank-audio-lexical-integration.test.mjs
```

测试使用明确标记的合成 fixture，不创建模型、不调用 ASR；应用测试只写临时目录。覆盖严格读法和反例、预览只读、全部预检后写入、错误媒体/缓存/override、写锁、中断恢复、幂等、历史保留，以及真实发布分派器对缺失和篡改证明的拒绝。
