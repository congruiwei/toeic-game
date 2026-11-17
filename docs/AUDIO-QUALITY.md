# 音频质量二次复核

基线为 `0e083058` 发布时的 2,505 条待复听记录：英语 403、日语 2,102。题目 ID、显示原文与答案保持不变。每个阶段保留原始证据，不以目标句提示识别器，也不以宽松的编辑距离阈值改标通过。

## 阶段结果

| 阶段 | 英语排除／修复 | 日语排除／修复 | 剩余英语 | 剩余日语 |
| --- | ---: | ---: | ---: | ---: |
| 初始基线 | — | — | 403 | 2,102 |
| 1. 严格文字／读音等价 | 153 | 77 | 250 | 2,025 |

第 1 步共排除 230 条，没有新合成或新识别调用，媒体文件逐字节不变。剩余 2,275 条将进行较强模型复查；自动修复与复听页面在后续独立阶段发布。本表仅把已完成阶段列为结果。

## 第 1 步规则及证据

`scripts/audio-compare.py` 使用可追溯的精确等价规则：有限复合词分写表、美英拼写表、缩写展开、数字及源文明确时钟格式、CMUdict 相同发音集合，以及用户允许的冠词差异。冠词差异单独记录原因，不声称冠词本身同音。CMUdict 保留全部音段，只忽略词典重音编号；不会用多个读音中最有利的一种强行通过。

日语使用 UniDic 的读音，未知汉字可用 pykakasi 并标明来源；展开长音符，保留促音、鼻音、真实音拍和时态。不能可靠确定的分词、多读字、英日混合文本继续复查。已有显式音素修正的日语条目，不能以另一套词典猜读证明不同表面文字等价。

保护用例包括：`has fallen / is falling`、否定词、单复数、`-ed`、标签 `A` 与冠词、正负数、日语「方／空」的不同读法、促音与长音。全部 18 条当前 `-ed/-d` 候选在此阶段仍为 review；它们是转写差异，尚不能据此认定录音确实漏读。

`data/audio/quality-review.json` 保存全部 2,505 条基线的完整音频元数据与实际 ASR 记录，另存逐条新规则、规范化中间结果、相等证明、依赖版本、比较器／规范化代码 SHA 和源文 SHA。当前审核文件仍保留原始 `recognized`、模型参数、音频 SHA、segments；只更新比较结果。Python 和 Node 校验均要求证明绑定当前媒体、原文及实际转写，空证明、错配摘要或仅修改 status 均不算通过。

重新执行本阶段：

```sh
TOEIC_TTS_DIR="$HOME/.local/share/toeic-kokoro"
"$TOEIC_TTS_DIR/venv/bin/python" scripts/recompare-bank-audio.py
"$TOEIC_TTS_DIR/venv/bin/python" scripts/recompare-bank-audio.py --apply
node scripts/validate-bank-audio.mjs
```

默认只预览；`--apply` 更新审核状态并同步播放包摘要。两种模式都锁定现有作者锁，避免混读检查点。首次基线不可被续跑覆盖；后续阶段开始后禁止再用本命令覆盖第 1 步统计。依赖固定在 `scripts/requirements-kokoro.txt`，只安装于仓库外的本地 Python 环境。[CMUdict](https://github.com/cmusphinx/cmudict)、[fugashi](https://github.com/polm/fugashi)、[UniDic](https://github.com/polm/unidic-py)、[pykakasi](https://github.com/miurahr/pykakasi) 均用于本地比较，不调用云端服务。

严格等价通过表示这次转写与目标文字在约定规则下相符，不能代替人耳判断自然度、重音或音质。最新剩余条目始终以 [validation.json](../data/audio/validation.json) 为准。

## 第 1 步验证输出

```text
题库／翻译／选项校验：PASS，2,548 个唯一 ID
默认音频校验：PASS，13,917 条必需音频均有实际 ASR，技术错误 0
严格规则后剩余：2,275（英语 250，日语 2,025）
Node：177/177
Python：106/106
本阶段检查命令：12/12，全部 exit 0
```

音频文件无变化；所有原题和中日译文无变化。规则只重新判定当前选中媒体的原始转写，不挑选历史重试中更有利的文本。
