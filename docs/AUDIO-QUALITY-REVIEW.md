# 音频复核：比较规则与强 ASR 证据

本文件说明音频质量复核的前两阶段。自动转写的差异是复核线索，不等于实际录音一定有错；`review` 也不等于已经人工确认可用。录音修复和剩余条目试听属于后续阶段，不由本阶段自动放行。

## 已保存的阶段结果

第一阶段将原有 2505 条待复核记录逐条保存在 `data/audio/quality-review.json` 的 `records[token].baseline`，包括当时的录音元数据和完整实际 ASR 记录。每条原始 `comparison` 及 `stages.comparison` 在后续阶段保持不变。第一阶段严格比较后，英语 250 条、日语 2025 条仍需强模型重审，共 2275 条。

第二阶段对这 2275 条取得同一录音的实际识别证据，固定模型为 `whisper-large-v3-turbo`，模型 SHA-256 为 `e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da`。使用 CPU/int8、逐文件 beam 5；没有提示原文或 hotwords，不沿用上一段文本，不开启 VAD。媒体 SHA、文本、实际朗读输入、声音及其余录音元数据均与基线一致。

| 语言 | 实测条目 | 比较匹配 | 仍需复核 | 不同音频 SHA |
|---|---:|---:|---:|---:|
| 英语 | 250 | 107 | 143 | 240 |
| 日语 | 2025 | 1069 | 956 | 1964 |
| 合计 | 2275 | 1176 | 1099 | 2204 |

相同录音可能用于多个条目，因此条目数与不同音频数不同；这些数值不是本次新调用推理的次数。完整实际记录保存于每条 `strongerASR`，包括转写、分段、识别参数、指纹、诊断指标和最终比较证明。`stages.strongerASR` 记录以上计数与模型身份；`finalizerRecognitionCalls: 0` 仅说明收尾脚本本身不调用模型，不代表前面的强 ASR 没有运行。

## 比较证明与格式修订

比较器 `scripts/audio-compare.py` 使用有限、可解释的规则；不靠编辑距离或相近音自动通过。证据绑定当前媒体 SHA、原文、实际朗读输入、实际转写、比较器文件 SHA 和规范化代码文件 SHA。匹配结果必须有相等且非空的证明。

第二阶段在保持实际转写不变的前提下，修正了 24 条英语记录的纯书写/数字格式漏判，例如：

- `café/cafe`、`café's/cafe's` 的有限拼写映射；不全局删除词语重音符号。
- 原文写 `dept.` 且实际输入明确拼读 `D E P T` 时，允许转写写成 `DEPT`；不推断任意缩写。
- 原文的 `120 V` 与同值同单位的转写 `120V`。
- 明确源文/朗读输入中的 `fifty-dollar deposit` 与转写 `$50 deposit`；显式转写为 `fifty dollars deposit` 仍不等价。
- 经确认的报时、投票比分、美元与美分、百万金额、少量货币省略句式。规则需要精确的源文和实际朗读输入约束，保留金额、正负号、单位及显式说出的词。

时态、复数、否定、词尾和实词缺失仍保留复核，例如 `liked/like`、`Who'll/We'll`、`Sent/Set`。不同完整读音集合、日语长音/促音或未经证实的异读不由这些格式规则放行。

`data/audio/comparison-revision.json` 独立保存第二阶段的旧、新比较证明、保持不变的原始 ASR 内容摘要、代码身份和 EN/JA 计数变化。2275 条所选记录的证明代码身份更新，其中只有 24 条分类改变；这两个数量不能混用。原始 `baseline`、第一阶段 `comparison` 与识别缓存不会因此被重写。

## 工具与校验

作者使用已有的外部音频环境；模型、识别缓存和锁文件应在仓库外。下列脚本不下载模型、不合成、不执行 ASR。默认只预览，只有显式 `--apply` 才写入：

```sh
python scripts/refresh-strong-comparison.py
python scripts/refresh-strong-comparison.py --apply
python scripts/finalize-audio-reaudit.py
python scripts/finalize-audio-reaudit.py --apply
```

可传 `--repo`、`--workdir`、`--model` 和 `--tokens-file`。不传 tokens 时从不可变基线精确派生完整目标；传入的文件必须与完整目标集合相等且无重复，不能只复核一部分后声称完成。

两个脚本都先取得 `bank-generate.lock` 和 `bank-audit.lock`，作者仍在写入时立即拒绝。所有目标的媒体、模型、实际分段/转写、指纹缓存和证明都通过预检后才写入。空转写、错误记录、缺项、过期 SHA、错误模型或无效证明不会记为成功。

比较修订先原子写独立报告，再仅更新所选 audit 记录的 `comparison/status`；中断后可根据原报告恢复。收尾脚本再保存完整强识别快照，调用原 `bank.flush` 更新索引状态和包摘要，保留原始生成配方。重复执行结果稳定；遇到后续阶段、变动的实际证据或冲突历史则拒绝覆盖。已有第二阶段归档后，不应重新运行比较修订来改写它。

普通 Python 可运行不依赖模型的隔离文件测试；比较器测试需要现有作者环境中的规范化和离线词典依赖：

```sh
python tests/bank-audio-finalize.test.py
python tests/bank-audio-comparison-revision.test.py
python tests/bank-audio-formatting.test.py
python tests/bank-audio-compare.test.py
node --test tests/bank-audio.test.mjs tests/bank-audio-comparison.test.mjs
node scripts/validate.mjs
node scripts/validate-bank-audio.mjs
```

`--strict-quality` 会把仍待复核的条目视为失败；常规音频校验保留其状态和警告，并检查既有真实重试证据。两种模式均不把这些条目假称为人工确认无误。
