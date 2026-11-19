# 本地学习音频：来源、生成与转写审核

本阶段使用已经选定的 Kokoro `af_heart`（Heart）、`am_puck`（Puck）、`af_bella`（Bella）和日语 `jf_alpha`（Alpha）。这三个英语声音均为美式；本批没有预生成英式或澳式音频。模型合成、编码和 Whisper 转写均在本机完成，不调用远程推理服务。

首轮冻结状态（`0e083058`）：**13,917 个必需来源键已全部生成、实际识别，所有剩余差异均完成真实重生成与识别，已确认输入纠音已交付，归档完成。默认结构与证据校验通过；当时严格质量检查有 2,505 条 `review`。** 其中英语 403 条、日语 2,102 条；转写差异不自动等于录音错误，也不代表已经完成人耳验收。以下生成统计来自该轮作者退出后的同一快照。后续严格比对、较强模型复查及修复进度见 [音频质量二次复核](AUDIO-QUALITY.md)。

## 来源与范围

`node scripts/build-audio-source.mjs` 读取现有题库、日语译文和 `js/translation-source.js`，生成 `data/audio/source.json`。它不修改题库、答案、题目 ID 或译文。`text` 保持原文；生成器另存 `spoken`，只用于数字、字母编号、插入标记和明确的发音处理。

来源清单保留 24,543 个键，区分 `required`、`priority` 和 `nonSpoken`：

- 必需音频为 13,917 个键：英语 6,234，日语 7,683。
- 英语必需部分包括词头和例句、Part 1 四句描述、Part 2 问句和回应、Part 3/4 对话及独白、题目与选项、听写、填好答案的语法句、Part 6/7 正文，以及各声音的 A–D 选项标签。
- 日语包含现有全部译文与词义、39 个方法或语法术语；纯视觉插入标记不朗读。
- 额外英文解析、搭配、同义表达、干扰词、易混词等保留来源键，但标为可选，默认不预生成；相应点读可以使用设备语音后备。
- 110 个纯 `[1]`–`[4]` 位置标记明确标为 `nonSpoken:true`，从音频覆盖分母排除。正文里的标记不发声，其他正文照常朗读。它们与选项 A–D 不同，不用选项字母替代位置标记。

`sourceSha256` 绑定来源 JSON 的实际字节。以后修改英文、译文或配声后，重新生成来源清单，再增量生成；未变化的音素和声音仍可复用外部 WAV 缓存。不要在生成运行时改题库或来源清单。

## 配声与键

双人场景固定一女一男：女声在 Heart 和 Bella 之间轮换，男声为 Puck；同时轮换谁是 A、谁是 B。三人场景使用三种声音。Part 2 问句与回应使用相反的男女声，三个回应保持同声，避免选项配声成为答题线索。单人广播轮换三种英语声音。听写使用其原句在场景中的声音。

来源和音频条目保留 `speaker`，播放层用原始键及说话人定位，不能只凭近似文本匹配。已用脚本核对 28 个双人组、24 个三人组、200 个 Part 2 问答组及全部听写的配声关系。

原有键沿用 `sourceUnits`。补充英文点读键为：

| 内容 | 键格式 |
| --- | --- |
| 词汇搭配、同义表达 | `词ID/collocation/句序`、`词ID/paraphrase/句序` |
| 干扰词、易混词 | `词ID/clozeDistractors/选项序/0`、`词ID/confusables/词序/0` |
| 未填答案的语法题干 | `题ID/prompt/句序`；朗读输入把空格读作 blank |
| 语法及 Part 6 选项 | `题ID/options/选项序/句序` |
| 英文解析 | `题ID/explanation/句序` |
| 日语术语 | `terms` 包内沿用日语术语表的原始键 |
| 选项字母 | `labels/声音ID/A`，其他字母同理；文本为 `A.` 等 |

## 清单与文件

`data/audio/manifest.json` 是轻量索引，页面无需下载整个来源清单。它包含 `version`、`model`、`voices`、`sourceSha256`、`generation`、`packs` 数组和 `totals`。

每个 `packs` 项包含：

```json
{
  "bank": "part2",
  "language": "en",
  "src": "./data/audio/en/part2.json",
  "count": 0,
  "expected": 1006,
  "requiredCount": 0,
  "requiredExpected": 803,
  "bytes": 0,
  "sha256": "实际包摘要",
  "duration": 0,
  "audioBytes": 0,
  "complete": false,
  "requiredComplete": false
}
```

这里的数值仅说明结构。`bytes` 是实际包 JSON 字节数；`audioBytes`、`duration` 按包内唯一音频路径去重统计。跨包还有相同音频时，全局 `totals` 再去重一次。

每个语言和题库分包位于 `data/audio/{en,ja}/{bank}.json`，结构为 `{version,language,bank,sourceSha256,generation,complete,requiredComplete,clips}`。`clips` 按完整来源键映射到：

```text
src, duration, bytes, sha256, voiceId, language, text, spoken,
inputSha256, phonemeSha256, decodedPeak, headroomDb,
required, speaker（适用时）, asrStatus
```

实际 M4A 位于 `audio/generated/{language}/{voiceId}/{内容摘要}.m4a`。相同声音和音素复用文件，各来源键仍有独立条目。模型、原始 WAV、语音依赖、临时音素和 ASR 模型全部放在仓库外。

完整性标记的含义必须区分：

- `complete`：全部可朗读来源键，包括可选项，均已有文件。
- `requiredComplete`：所有必需键已有文件。
- `auditComplete` / `requiredAuditComplete`：对应范围都已实际转写；有差异的 `review` 仍可能存在，因此不表示所有差异已解决。
- `asrStatus`：`pending` 尚未审核；`matched` 规范化后匹配；`review` 有差异待复核；`error` 转写失败，不算已完成审核。

## 生成与断点续跑

外部环境沿用 [KOKORO-AUDITION.md](KOKORO-AUDITION.md)，另按 `scripts/requirements-kokoro.txt` 安装本地 ASR 依赖。已固定 PyAV 16.0.1：PyAV 19 的解码 API 与当前 faster-whisper 不兼容，不能把这种解码失败记成审核成功。

```sh
TOEIC_TTS_DIR="$HOME/.local/share/toeic-kokoro"
uv pip install --python "$TOEIC_TTS_DIR/venv/bin/python" -r scripts/requirements-kokoro.txt
node scripts/build-audio-source.mjs
"$TOEIC_TTS_DIR/venv/bin/python" scripts/generate-bank-audio.py --threads 2
"$TOEIC_TTS_DIR/venv/bin/python" scripts/audit-bank-audio.py --threads 2 --watch
```

运行两个命令时使用独立终端，或由外部进程管理器持续运行。当前实际运行使用独立进程会话，PID 与日志记录在外部工作目录的 `bank-processes.json` 和 `logs/bank-*.log`。进程不会依赖交互工具保持打开；中断后用同样命令继续。

生成器每 10 条原子写入包和索引，读取已有条目的输入摘要决定是否复用。它使用 CPU ONNX、速度 1.0、24kHz，保守裁剪边缘静音，再做双遍响度归一化和约 48kbps AAC-LC 编码。编码后实际解码并检查峰值，必要时增加余量。`ffprobe` 核对文件格式、声道、采样率与时长。主流程先处理听力，再处理词汇与阅读等必需材料；只有传 `--include-optional` 才处理可选点读来源。

短于 400 ms 的字母录音不足响度计量窗口，曾出现 `input_i=-inf`。这类片段仅在末尾补静音至 500 ms，再执行同样的响度与 AAC 检查；原有音素样本不变，新增静音长度记在 `trailingSilenceAddedSeconds`。图表选项中独立字母 `A` 的朗读输入写为 `A.`，避免当成冠词；显示文字仍保持原样。

检查点用唯一临时文件、刷新落盘和原子替换。读取遇到瞬时不完整 JSON 时短暂重读，持续损坏仍抛出错误，不会当作空审计。公共错误字段移除本机绝对路径。若初轮生成器退出，识别器在已发布队列耗尽后让出控制；`--wait` 重试器会进入补生成及实际识别流程，不会因 `requiredComplete=false` 永远等待。

日语中的英文公司名、人名由英文 G2P 转音素，再与日语音素连接，避免 Cutlet 把裸 Latin 字母误当音素。编号字母、数字读法、`一回` 的促音及 `過去形` 等明确读法仅调整朗读输入。未知音素会记录错误，不会默默丢弃。

数字按原始语境决定读法，不能先统一写成汉字再交给词典猜测：日语时刻、时长、分钟、分数、月份、日期及助数词分别处理，例如 `09:05 → くじごふん`、`9時間 → きゅうじかん`、`5分の1 → ごぶんのいち`；原本表示“足够”的「十分」保持原词。视频 `02:10` 通过单键覆盖明确为两分十秒。英语型号 `A4` 用 `A. four` 的字母边界，避免被合成成单词或冠词；毫米单位展开为 `millimeters` / `ミリメートル`。所有改变均仅用于 `spoken` 或音素，显示文本和题库 ID 不变。

这些规则有固定语义期望及少量真实 G2P 回归，用外部工具环境运行，不需加载声学模型：

基础读法参考东京外国语大学的[助数词表](https://www.coelang.tufs.ac.jp/mt/ja/gmod/contents/explanation/017.html)及[时刻读法](https://www.coelang.tufs.ac.jp/mt/ja/gmod/courses/c02/lesson11/step1/explanation/018.html)；实际词典是否遵守这些读法仍以本地 G2P 回归与成品复核分别检查。

```sh
"$TOEIC_TTS_DIR/venv/bin/python" tests/bank-audio-normalization.test.py
"$TOEIC_TTS_DIR/venv/bin/python" tests/bank-audio-retry.test.py
"$TOEIC_TTS_DIR/venv/bin/python" tests/bank-audio-retry-flow.test.py
"$TOEIC_TTS_DIR/venv/bin/python" tests/bank-audio-completion.test.py
"$TOEIC_TTS_DIR/venv/bin/python" tests/bank-audio-io.test.py
"$TOEIC_TTS_DIR/venv/bin/python" tests/bank-audio-stream.test.py
```

测试覆盖时刻/范围/视频时码、金额及复合修饰、月份/助数词、`A4/L1/H1`、毫米、单字 `C` 和不朗读的插入标记。规范化改变后输入摘要会失效，生成器据新音素重新生成或复用音素确实相同的历史波形；不会仅改清单里的朗读文字而沿用不匹配的旧音频。

IO 回归包含短片真实 ffmpeg 编码、逐样本保留、暂时空文件恢复、永久坏 JSON 拒绝及失败写入保留旧检查点。`node --test tests/bank-audio-archive.test.mjs` 只在隔离副本检查归档：活进程保护、复制 SHA 校验、历史媒体删除前备份，以及移除外部作者目录后公开克隆仍能独立校验。

恢复回归不运行声学模型：检查源文、声音、朗读输入和覆盖配置的绑定；实际 ASR 证据包含文本、SHA、模型参数与是否逐条识别，空转录不能算完成；还用临时目录模拟中断、空候选、识别失败后继续和初轮缺失识别。初轮进程退出后，重试器先同步索引、补全仍缺的实际识别，再决定是否需要新合成，不能把“进程已结束”当作覆盖完整。

生成器、识别器、重试器共用 `scripts/audio-evidence.py` 的完成判据，Node 校验器采用同等门槛。真实 `flush` / `--sync-only` 回归另外覆盖：空转录或过期原文不能让索引声称审核完成；成品文件缺失、字节数或 SHA 改变会从索引摘除，并在续跑时重建。三个进程分别持有外部文件锁，防止另一个作者进程同时改同类文件。

`data/audio/generation-errors.json` 保留失败键，成功重试后清除；`data/audio/regenerations.json` 记录替换前后音频摘要与原因。`data/audio/overrides.json` 按 `语言:题库:来源键` 保存朗读配置，可包含 `spoken`、`phonemes`、`reason`。已确认的输入纠音必须走下文的纠音计划，携带经过复核的显式目标 `phonemes`，保留前后两份真实证据；不要仅手改配置后直接覆盖旧片段。所有写入进程仍需遵守唯一作者与检查点要求。

## ASR：真实转写与差异报告

采用本地 Whisper small 多语言模型、CTranslate2 CPU int8。识别输入是最终交付的 M4A；先核对音频 SHA256，然后实际迭代转写结果。**不把目标句作为 prompt 或 hotword**，避免识别结果被期望答案诱导。相同音频文件复用实际识别结果，各来源键仍独立比较；发生重生成后，音频摘要变化会自动重新审核。

短音频先做保守的批次筛查：将同语言成品解码，按实际长度拼成不超过 24 秒的临时输入，首段留 0.4 秒、文件之间留 0.6 秒静音，用 beam size 1 和 word timestamps 真正转写。分句只依据已知音频偏移与识别词时间，完全不使用目标文本做对齐。只有边界稳定且规范化文本完全吻合的文件才接受；词语跨界、落在静音、无效时间、漏词或任何差异，全部再对原成品文件做 beam size 5 转写。较长文件直接逐条识别。日语同音写法比较也只用于单条复核结果，批次筛查不放宽匹配标准。

这项拼接仅用于减少识别器的固定 30 秒编码开销，播放文件仍是一句一个文件。每批模型参数、输入 SHA、偏移和全部识别词时间保存在 `data/audio/audit-batches/`；逐键报告记录 `recognitionMethod`、`recognitionGeneration`、`singleFileVerification` 及 `screening` 的批次位置、边界判断和精确匹配结果。早先已完成的单文件 beam size 5 结果继续保留，不改称批次识别。传 `--individual-only` 可停用筛查。

报告位于 `data/audio/audit/{en,ja}/{bank}.json`，逐键保留目标原文、实际朗读输入、实际转写、音频摘要、时间段、置信信息和逐项差异。英语记录 WER；日语记录 CER，并补充音素比较以区分同音写法。`data/audio/audit-summary.json` 是运行统计。转写缓存仅存在外部 `tmp/bank-asr`。

ASR 的 `matched` 不能代替真人听感检查；`review` 也不自动表示合成错误。先核对实际差异与音素，再决定修读法、重生成或记录为识别器误差。不得靠放宽阈值把未解决差异改成已通过。最终需列出差异总数、已修复项、识别器误差与仍待复核项。

最终校验的 `unresolvedItems.triage` 只辅助安排人工复核顺序：可能的复合词空格或标点差异、少量已观察到的同音专名，以及词义/时态/漏词等风险分别标记，均保持 `review`。例如 `has fallen` 被识别成 `is falling` 会标为高优先级，不因字形相近放宽。未发布的历史重试音频提供 SHA 与归档标志，不生成指向已移除文件的公开播放链接。

词头的重音单独处理：来源条目保留词卡 `pos`、`ipa`；42 个多读音词头有明确音素覆盖，`record`、`present`、`permit`、`contract` 等按词性及现有音标区分。对应依据和仍需耳听的列表在 `data/audio/pronunciation-review.json`。上下文句子没有因此重写，显示英文也不变。ASR 通常无法发现重音错误，不能将转写匹配写成“重音已验证”；`offset`、`overstock`、`compact`、`nearby` 等词典与卡片重音记法不同的项目另列待听。

转写全部完成后同步播放包的审核状态：

```sh
"$TOEIC_TTS_DIR/venv/bin/python" scripts/generate-bank-audio.py --sync-only
```

本批收尾顺序为：初轮生成器自然退出后，等待中的重试控制器保持停止；如需测试识别线程数，只短暂停止识别器并复用真实结果，然后单独恢复识别。初轮实际 ASR 全部收齐、最后一批输入读法复核结束后，集中执行确认纠音与重新识别，最后再启动普通减速重试。不要在待修的输入问题尚未收口时提前恢复重试控制器。

差异重试由 `scripts/retry-bank-audio.py --threads 2 --wait --stream-retries` 接续。它等待初轮生成、识别两个写入进程结束，再逐键核对规范化输入，保留原文、原声音及音素，以 0.90 合成速度真正生成第二版，并对第二版做单文件 beam size 5 识别。只有严格匹配才采用第二版；仍不匹配时保留原版，记录 `unresolved`，不会把“已重试”当作“已解决”。这一步不用期望文本提示识别器，也不会自动改写专名或题目。被采用的较慢版本在片段中标记 `synthesisSpeed`，界面语速仍是对文件的播放倍率。

可加 `--stream-retries` 让重试生成与识别并行，仍保持一个生成作者和一个审计作者、同样的模型和单文件 beam size 5 门槛。审计显式跟踪本次生成子进程，不能因为开始时旧索引已经完整就提前结束；两者均成功退出后才汇总选择。任一子进程失败或控制器收到终止信号，另一进程会停止并被回收。外部 `bank-retry-children.json` 记录 PID、启动时间/命令身份与退出状态，恢复和最终归档都检查活跃子进程。隔离回归使用临时假 worker 验证生命周期，不把这些流程测试算成实际语音生成或识别。

`data/audio/retries.json` 保存初次与重试音频 SHA、完整转写、输入检查、次数和最终选择；`regenerations.json` 另记实际推理耗时与波形缓存是否复用。中断后可重新执行同一命令，未完成的记录继续处理，已经完成的一次自动重试不会无限重复。初轮脚本之外禁止同时运行其他生成器，以免包文件竞争写入。

输入侧纠音另用 `scripts/correct-bank-audio.py --plan <复核计划 JSON>`，默认只预览；停止全部作者和等待中的控制器后才可加 `--apply`。计划锁定 source SHA、逐键原文、旧音素 SHA 和经过复核的目标音素/朗读输入，不修改展示文字。已生成的键必须先保存真实初次 ASR，再生成并识别目标版本；完成门同时校验文字、语言、声音、朗读输入、速度、音素 SHA 和完整合成输入 SHA。未生成键只预置未来覆盖，不虚构初次音频或识别，不计为重生成。恢复使用相同计划，已经完成的键只修复报告检查点，不重复合成。

已确证旧输入有误的纠音与自动减速重试采用不同选择规则：纠音后保留正确输入的新音频，即使新转写仍为 `review`，并完整保留旧、新两份证据；不能回退到明知错误的旧输入。`normalization-review.json` 记录计划、交付状态和复核后保留的合法读法，`retries.json` 按 `confirmed-input-correction` 与普通减速重试分别计数。输入纠音未完成时，普通重试控制器会要求先恢复纠音计划，防止以旧输入覆盖修正。子进程由 PID 与进程身份账本监督，终止信号会回收子进程；强制终止后的活跃子进程也会阻止第二个作者启动。

朗读复核不能只依赖 ASR 文本。合法日语读法如「施錠／せじょう」「手製／てせい」「係官／かかりかん」保持不变；近音转写和词形误识别也不自动证明音频读错。回归用实际 G2P 检查这些读法，同时保留数字、否定、时刻、单位和语义范围的规范化检查。

2026-11-17 的集中输入纠音已实际完成 249 个已生成键，初次和修正后 ASR 证据均保留。它们对应 240 个独立新音频文件，全部实际用单文件 beam size 5 识别；249 个键中 114 个转写匹配、135 个仍为 `review`。修正覆盖了商务语境中 `use / separate / insert` 的词性读音、复数 `tours`、引用缩写 `dept.`，以及经上下文核实的日语词语与星期读法。已知错误输入被替换并不表示所有声音都经过人工试听或质量全通过。此次另为 93 个未生成的必需键和 5 个可选键设置了后续首次生成的音素覆盖，不把它们计入重生成；12 个候选的现有音素已正确，未修改。完整逐键理由、旧/新输入及证据在 `normalization-review.json` 和 `retries.json`。

待核清单也区分确证输入错误与文字比较差异。首批新增英文阅读的 13 个高差异项经文本和实际缓存音素复核，12 个涉及时间记法/比较归一化、1 个涉及 `Jo / Joe` 同音专名，未找到应修改输入的证据。例如 ASR 的原始写法 `815`、`845` 被比较器按整数处理，并不证明声音真的念成“八百多”。这些项仍保留 `review`；`normalization-review.json` 的 `asrTextReviewNotes` 按观察时的音频 SHA 保存说明，明确没有将文字核对称为人耳验收。

纠音可加 `--stream`，使用与普通重试相同的监督器并行生成及识别；最终仍逐键核对两版证据。`tests/bank-audio-correction.test.py` 的 24 个隔离测试覆盖目标输入绑定、原始证据不可缺失、断点恢复、首次生成零计数、正确的单键范围，以及真实临时子进程的 SIGTERM 回收和 SIGKILL 后活进程检测。这些流程测试使用假作者，不计入真实模型调用次数。进程身份使用出生时间与脚本/参数，排除 macOS Python 启动时可能改写的解释器路径，仍检查 PID 是否被复用。

首份子进程账本立即保存实际 OS 出生时间和已知的启动参数，不等待 `ps` 的命令行字段就绪。恢复时再比对实测出生时间与完整参数；观察到暂空参数时有限复读，持续无法核实时明确拒绝启动另一个作者，不能把未知身份当作没有活跃作者。旧版“出生时间完整、参数暂空”的账本可用已存的启动参数恢复比较。`tests/bank-audio-stream.test.py` 的 15 个隔离测试包含 7 个确定性启动竞态用例，并覆盖生成/识别监督与纠音监督两条路径；出生时间或完整参数不符均不会匹配旧身份。

同一个键再次出现已确认的输入问题时，先校验上一次完成记录的原版、修正版实际 ASR 以及当前目标输入。完整旧记录保存在 `retries.archivedCases`，新记录以 `predecessor` 绑定其索引、来源键和所选音频 SHA；新初版必须就是上次选定的修正版。这样第二次纠音保留三版证据，而不是覆盖第一次历史。断点恢复和最终 Node 校验均拒绝缺失、空白、旧 SHA 或被改写的前驱证据。归档仅移走不再发布的媒体，公开记录仍保留逐版摘要和实际转写。

初轮识别收齐后，第二轮集中纠音已实际完成 92 个经复核的输入目标，包括按时态区分的英文 `read`、日语时刻的音素切分及具体语境的复合词读法；其中一个键是在先前纠音基础上追加局部修正。90 个独立新媒体均进行了真实单文件 beam size 5 识别，共 390.50 秒音频、434.31 秒识别推理；92 个键中 56 个匹配、36 个仍保留 `review`。两轮当前共有 340 个不同的已重生成来源键，另保存一个被后续修正版取代的完整纠音案例；不要把复用中间版本的证据重复计为新模型调用。此次完成后的必需当前实际 ASR 为 13,917，`pendingInputCorrections` 为 0。原题文字、译文、时间数值和已确认的其他读法均保持不变。

已实际试验 3 个来源：均进行了新 ONNX 推理与新单文件识别。日语「コートをフックに…」的转写由「高等服に…」恢复正确；英语 `can toward / contorted` 仍未匹配，保留原版及两次证据。进一步核对发现日语 G2P 把「数本」转为 `sɨːpoɴ`，确实误读为「すうぽん」，因此仅把朗读输入明确为「すうほん」，并对全库含这个词的 2 条句子定点重生成、重新识别；两条均已规范化匹配。「数本の傘…」保留三次版本的记录。这说明减速不能修复所有差异，还需检查具体音素，不能把重生成覆盖率当作发音正确率。

完整性校验不需要 Python 或模型：

```sh
node --test tests/bank-audio.test.mjs
node scripts/validate-bank-audio.mjs --allow-incomplete  # 开发中仍检查已有文件真实性
node scripts/validate-bank-audio.mjs                     # 发布前：必需键完整，所有差异均有真实重试证据
node scripts/validate-bank-audio.mjs --strict-quality    # 额外质量门槛：任何 review 都报错
```

校验包括题库/日译原文绑定、必需范围、两人男女配声与三人三声、听写说话人、所有视觉标记不朗读、包与 M4A 的实际 SHA/字节数、AAC 容器时长、单声道 24kHz，以及当前音频对应的真实 ASR 证据。制作期间仍在目录里的历史音频也会核对；完成正式归档后，公开仓库只保留其 SHA、原始转写和已经校验过复制的记录，校验器不依赖作者电脑的外部历史目录。开发模式只允许未完成和未解决项目，仍拒绝错误文件、错声或不安全的批次接受；默认发布校验拒绝缺失、未识别及未重试差异，已真实重试仍不符的项目保留 `review` 并输出 WARN 和完整 `unresolvedItems`，不会改标通过。`--strict-quality` 则把所有剩余 `review` 作为错误。报告必须区分结构覆盖通过与严格质量未通过的数量，不能把覆盖完整写成语音质量全通过。

三个计算进程全部退出、必需范围完整后，进行最终发布整理：

已确认的输入读法错误另有发布门槛：正式纠音计划必须携带经过核对的显式目标 `phonemes`，可同时修订 `spoken`，不能只依赖文字替换后重新猜读。当前片段必须使用该目标音素和对应的实际 ASR，单纯减速重试旧的错误音素不能放行。`pendingInputCorrections` 列出尚未交付的项目；开发模式保留该清单，正式模式拒绝它们。已存在旧录音的纠音保留初次和纠音后的两份真实证据；首次生成前安装的预防覆盖只检查目标输入与当前实际 ASR，不虚构不存在的旧录音。

```sh
node scripts/archive-bank-audio-history.mjs          # 只预览，不删改
node scripts/archive-bank-audio-history.mjs --apply  # 完整覆盖验证后，先复制校验，再清理
node scripts/validate-bank-audio.mjs
node scripts/validate-bank-audio.mjs --strict-quality
```

整理时仅保留已经有当前 `matched` / `accepted` 证据的可选片段，其余可选片段退出播放包，使用设备语音后备；具体键和原因记录在 `unpublished-optional.json`。所有不再被当前包引用的 M4A 先复制到外部工作目录的 `tmp/audio-history`，逐一核对复制后的字节数与 SHA，记录 `archive.json` 后才移除仓库里的旧文件。当前播放文件数、容量、时长始终按现行包的唯一 `src` 计算，历史版本与重试次数另列。默认发布校验拒绝遗留的孤立 M4A，公开克隆不需要取回历史音频即可核查发布结构和历史识别证据。

## 已完成的基准

首次分层基准实际尝试 100 条，成功 98 条：222.38 秒音频耗时 298.63 秒，包含编码，RTF 约 1.34。两条失败都是日语 `C` 编号的音素问题，随后修复输入规范化；这两个键现已实际生成并完成当前音频的真实 ASR，仍保留 `review`，不能把生成成功等同识别无差异。该基准使用 4 个 ONNX 线程。

修复解码依赖后，Whisper 用 2 个 CPU 线程实际识别 20 个文件：53.74 秒音频耗时 72.16 秒推理，RTF 约 1.34；18 个规范化匹配、2 个有差异（Their/The、An/and），均保留实际转写。先前的解码失败不计入这 20 个成功识别文件。

另取 10 条英文及 10 条日语实际比较：单条 beam size 1 共 97.32 秒、单条 beam size 5 共 110.08 秒；单条先筛后复核反而要 134.85 秒，因此没有采用。相同 20 个文件改为 4 个批次后，批次识别共 24.80 秒，其中 8 个文件边界稳定且精确匹配，另外 12 个回单条复核，合计 90.29 秒，较逐条 beam size 5 约省 18%。8 个稳定命中均与真实单条识别一致，没有发现错配；原始实验记录在 `data/audio/benchmark-asr.json` 和 `data/audio/benchmark-asr-batch.json`。这是小样本结果，不能据此保证全库速度或听感。

初轮生成器自然退出后，又对 12 个尚无当前识别缓存的唯一成品做了同模型、同 beam size 5、无提示词的线程对照，合计 55.86 秒音频、24 次真实识别。2 线程耗时 35.859 秒，4 线程耗时 25.667 秒，12 条原始转录逐字一致，实测约快 1.397 倍。因此只把独立运行的初轮 ASR 补队列改为 4 线程；后续并行重试仍保持合成 2 线程、识别 2 线程。2 线程的 12 条真实结果已写入原识别缓存，后续直接复用。完整参数、两个配置的逐条原始转录与选择结果位于 `benchmark-asr.json` 的 `postGenerationThreadComparison`，不是对全部材料的速度或听感保证。

早期容量规划曾估算约 11.4 小时、247MB；下节为生成、选择和归档后的实际值。合成与识别同时运行时使用 2+2 线程；初轮合成结束后的独立识别按上述实测采用 4 线程。最终普通重试的 2,689 个来源键全部为必需项，对应 2,615 个独立重试媒体；它们全部实际进行了单文件 beam size 5 识别，共 10,049.14 秒音频、12,048.35 秒识别推理。来源键的合成计数和独立文件的识别计数不同，不能互换。

## 最终交付与待听清单

2026-11-17 完成了实际生成、识别、重试选择和归档。再次执行默认校验通过；`--strict-quality` 产生的 2,505 个错误全部是保留的 `review`，没有缺片、缺少实际识别、缺少重试证据或未交付的已确认输入修正。

| 指标 | 最终值 |
| --- | ---: |
| 必需来源键 / 已生成 / 当前实际 ASR | 13,917 / 13,917 / 13,917 |
| 当前发布的来源键（含已匹配可选项） | 13,951 |
| 当前唯一 M4A 文件 | 13,549 |
| 当前唯一文件总时长 | 41,591.815 秒（约 11.55 小时） |
| 当前唯一文件总容量 | 274,968,880 字节（274.97 MB） |
| 仓库外已校验归档的旧 M4A | 3,000 个不同 SHA，74,392,158 字节 |
| 已归档的非发布重复元数据 | 8 份 |
| 未采用的可选录音 | 10 个来源键，使用设备语音后备 |
| 已确认输入修正仍待交付 | 0 |
| 孤立公开媒体 / 非发布元数据遗留 | 0 / 0 |
| 默认结构与证据校验 | 通过 |
| 严格质量校验 | 未通过：2,505 条待核对 |

完整清单在 [validation.json](../data/audio/validation.json) 的 `unresolvedItems`；每条包含当前原文、朗读输入、真实转写、当前文件，以及实际重试证据。英语与日语分布如下：

| 题库 | 英语 review | 日语 review |
| --- | ---: | ---: |
| Part 1 | 6 | 29 |
| Part 2 | 37 | 167 |
| Part 3/4 与听写 | 83 | 447 |
| 单词与例句 | 182 | 782 |
| 阅读 | 75 | 543 |
| 语法 | 13 | 111 |
| 方法卡 | 0 | 8 |
| 术语 | 0 | 15 |
| 选项字母 | 7 | 0 |
| 合计 | 403 | 2,102 |

辅助复核分类为：58 条可能是拼写/分词差异、2 条可能是同音专名、2,445 条列入词义/时态/省略等一般核对范围；这不表示后者已被证明有语音错误。优先级为高 1 条、普通 2,504 条，高优先级仍是 `p1-050` 的已完成动作 `has fallen` 与识别器 `is falling` 的差别。所有类别都保留 `review`。

[retries.json](../data/audio/retries.json) 当前有 3,033 个完成的来源病例：340 个输入纠音键、2,693 个普通重试键（含先前 4 个试验键），当前选定版本有 528 个转写匹配、2,505 个仍待核对。另保存 1 个被下一轮纠音替代的完整历史病例；同一键的中间版本和 ASR 证据不能重复算成新模型调用。[regenerations.json](../data/audio/regenerations.json) 累计记录 3,066 个不同来源键的音频 SHA 变化、3,073 个变化事件，包含早期配声、规范化与输入修正；这也不同于当前重试病例数。

[archive.json](../data/audio/archive.json) 保存逐文件 SHA、字节数和复制核验记录；公开校验实际涉及的已归档重试历史媒体为 2,950 个，其余归档项包含未发布的试验与旧生成文件。公开仓库不依赖外部历史目录，也不发布无用副本。历史文字观察在 `normalization-review.json` 保留当时 SHA；已修好的确证项通过交付记录和当前修正版 SHA 明确对应，不能把历史观察当作新的未完成项。

2026-11-18 的最终内容修订仅涉及两道 Part 6 题的非正确干扰项及对应中英文解析，共 6 个授权字段。所有题目 ID 和答案不变；重建来源后，13,917 个必需来源对象、13,951 个已发布片段对象均与修订前完全相同，包括音频 SHA、声音、朗读输入及 ASR 状态。新增 2 个可选解析分句使来源总数变为 24,543；当前来源指纹为 `e7b0d77969d8992c62e1d5cbde565b913c55be641f412ab3fb530593abdb6fb2`。此次仅执行 `--sync-only`，没有模型推理；第二次归档新增媒体及元数据均为 0，默认校验再次通过，严格质量检查仍仅有原 2,505 条 `review`。因此上表实际文件数、容量、时长和待听分布保持不变。

仍需人工试听的是上述转写差异及单独记录的重音/合法异读问题。可选来源未预生成时透明使用设备语音后备，不宣称全部 24,543 个来源键都有文件。后续修改题库后应重新生成来源清单、同步音频包，再执行归档预览、归档和两种校验；发布总量以最后一次同步后的现行包计算。

## 强识别后的修复工具

这一节描述追加质量工作的执行契约，具体交付结果见 [AUDIO-QUALITY-REVIEW.md](AUDIO-QUALITY-REVIEW.md) 和当前 `quality-review.json`。前面的初轮统计保留为历史快照，不能与追加修复后的现行媒体总量混用。

`scripts/contextual-audio-probe.py` 只用于英文孤立词头、Part 2 首词选项和选项字母。它把当前交付 M4A 解码为 16kHz float32 PCM，原样放到固定无目标载句 `The word is` 和 200ms 数字零静音之后；不会重新合成目标词，也不向识别器提供目标提示。原始片段、载句、拼接波形和目标区间均有 SHA，真实 strong individual beam size 5 转写及词时间戳保留在 `quality-review.json` 的 `contextProbes`。

第二版时间门允许尾词的时间戳从已知零静音区开始，但不能进入载句 PCM，且必须重叠原目标 PCM 的有效声段；原目标前导静音不能冒充目标发音。有效声段以 10ms 窗、RMS 至少 0.001 复算。版本号进入 proof ID，旧版判定和原始识别均不覆盖；使用 `--finish-only` 重评现成真实缓存不计为新的模型识别。只有完整证明门通过才另标 `accepted`，原 individual 转写仍完整保留为 `review`，不能把补充语境证据写成原孤立音频已被独立识别匹配。Python 生成/审计与 Node 发布校验都核对该门；伪造 accepted、错误媒体 SHA、缺失 proof 或未知 acceptance method 均不能放行。

`scripts/build-audio-repair-plan.py` 从已经完成强识别的当前 review 创建仓库外计划，不修改题库。每项绑定原文、来源 SHA、旧音频与音素 SHA、具体朗读改动及理由。英文默认保持已核音素和原声音，以 0.88 合成速度重录；少数已审清晰度变体逐项列出。对没有显式音素覆盖、没有句末标点的孤立词，计划可仅给原音素追加句点，使收束韵律明确，不添加发音词。日语默认速度 0.94，专名与专业词读法仅使用 `japanese_repair_readings.py` 的明确表；已有人工复核的显式音素不会被文字规范化覆盖。

```sh
"$TOEIC_TTS_DIR/venv/bin/python" scripts/build-audio-repair-plan.py --language en --output "$TOEIC_TTS_DIR/tmp/en-repair-plan.json"
"$TOEIC_TTS_DIR/venv/bin/python" scripts/repair-strong-bank-audio.py --plan "$TOEIC_TTS_DIR/tmp/en-repair-plan.json"  # 预览
"$TOEIC_TTS_DIR/venv/bin/python" scripts/repair-strong-bank-audio.py --plan "$TOEIC_TTS_DIR/tmp/en-repair-plan.json" --threads 4 --apply
```

将 `en` 换为 `ja` 可制作日语计划。实际作者必须串行运行，禁止与语境探针或其他生成/审计作者重叠。修复工具先保存原版完整 strong ASR，再修改朗读覆盖，实际生成不同 SHA 的候选音频，并按计划选定的固定强识别模型（默认 `large-v3-turbo`）、CPU int8、individual beam size 5、无提示词重新识别。每个候选的来源、声音、朗读输入、音素和合成指纹都重新核对。中断后用同一计划恢复；`--finish-only` 只允许已有真实候选证据收尾，不能用它跳过合成或识别。完整旧 retry 保存到 `archivedCases`，新记录用 `predecessor` 连接实际版本，不覆盖早期纠音与减速证据。

英文需要追加一轮经过审核的具体变体时，计划必须增加绑定上轮完整 repair 的 `previousRepairSha256`，并显式使用 `--next-round`。上轮必须已完成、仍为 review，且当前音频、真实 ASR、朗读覆盖及 retry 镜像与其最终候选一致。完整旧 repair 保存在 `priorRepairs`，新 repair 的 `previousRepair` 指向其索引和 SHA；恢复时同样核查该链，不允许用新计划覆盖未完成的旧计划。`counts.attempted` 统计不同来源键，`repairRounds` 统计这些键完成过的轮次，两者都不等于去重后的实际模型调用数。

若候选已被真实识别，却未满足计划中的精确音素输入，先保存其 `priorCandidates`，随后重建目标输入；最终 retry 的 `priorRetries` 保留该中间版及实际转写。选项字母的默认音素不能覆盖显式修复输入，重用/同步也必须核对显式音素 SHA。修复作者在取锁后逐一复核预检时的质量账本、覆盖、音频包、审计包和索引字节，若其他作者在取锁前发布了新证据则拒绝写入，要求重新预检。

独立英文单词头可在明确的追加计划中换用另外一个已选美式声音，范围只限 `en/vocab/*/meaning` 的单个单词，不能用于词组、例句、对话、首词选项或字母标签。来源清单的默认 `voiceId` 不变；新录音的 `voiceId` 如实记录实际音色，`sourceVoiceId` 保留原指派，`voiceOverrideInput` 保存参与输入指纹的完整合成配方。只有 Heart、Puck、Bella 三种已选音色和明确的原音素可用；实际声音、配方 SHA、已核音素、来源、当前覆盖及多轮真实 ASR 由 Python 与 Node 两端核对。旧 full-model proof 留在其原媒体 SHA 下，不冒充新录音的证明。

此批新换声音频直接使用 `--asr-model whisper-large-v3`，计划须同时指定 `asrModel`；模型名与 SHA 必须匹配允许的固定版本，不允许恢复时悄悄改模型。`recognitionModels` 列出实际候选所用模型，原 Turbo 识别仍留在旧版本。换声后的独立单词比较明确禁用冠词删除，额外的 `a/an/the` 不能据此通过；原句子的既有比较口径保持不变。若仍需下一音色，使用新的 `--next-round` 计划，只重试尚未通过的词，并保留此前各声音的媒体、输入和真实转写。

日语候选仍为 review 时，从录音 `clips` 移除并写入显式 `fallbacks`，同时保留原版与候选的实际强识别证据。后备条目没有媒体路径，标明 `playback: system`、原日文、未解决原因和最后审计 SHA；设备日语声音没有在本机自动验收，不能计为 Kokoro matched。索引的 `requiredPlaybackComplete` 可包含有完整证据的系统后备，而 `requiredComplete`、`requiredAudited` 仍只统计录音；`recordedAuditComplete` 只表明现行录音证据齐全。严格质量检查约束发布录音的 review，系统后备数量与 `systemVoiceAudited: false` 必须另行报告。

全部作者退出后再做归档。新旧修复媒体、语境判定和 fallback 证据不得在生成过程中清除；归档先验证复制到仓库外的 SHA，再删除不再发布的媒体。最终重新运行默认和严格校验，使用同一停止后的快照统计当前唯一文件、录音 review、context accepted 和系统后备，不把这些类别合并成“全部语音质量通过”。

## 人工复听前的历史快照

2026-11-19 完成最后一轮真实重录、强识别、有限证明发布和归档；以下数值取自首批人工复听之前。原学习文本、题目 ID 和来源指纹不变。

| 指标 | 现行值 |
| --- | ---: |
| 必需来源键 | 13,917 |
| 必需预录音频键及当前实际 ASR | 13,125 / 13,125 |
| 显式日语设备语音后备 | 792 |
| 发布录音来源键（含已匹配可选项） | 13,159 |
| 当前唯一 M4A | 12,793 |
| 当前唯一媒体总时长 | 38,962.255 秒（约 10.82 小时） |
| 当前唯一媒体容量 | 257,929,434 字节 |
| 英语录音仍为 review | 50（含 11 个字母或代码条目） |
| 日语发布录音仍为 review | 0；未解决的 792 项已显式改为系统后备 |
| 补充证明 accepted | 4 个原样 PCM 语境、13 个有限词典等价、11 个同媒体完整模型复核 |
| 已确认输入修正未交付 / 孤立媒体 / 多余元数据 | 0 / 0 / 0 |

默认覆盖及真实证据校验通过；严格质量校验仍有 50 个 `review`，记录于[该版本校验报告](https://github.com/congruiwei/toeic-game/blob/0514db9b/data/audio/validation.json)。系统后备不计为本地录音识别通过，也不声称设备声音已被自动验收。剩余英语分布：Part 2 为 2、Part 3/4 为 16、单词与例句 19、阅读 8、语法 1、选项字母包 4；其中 11 个字母/代码包含题目选项里的单字母及 `A8`。

独立词头换声共实际尝试两批：21 个来源键对应 20 个新媒体识别，新增 11 个匹配；仅对仍未通过的 10 个词再试第三种已选声音，实际识别 10 个媒体，新增 2 个匹配。原来已通过的词不重复换声。两批均保持已核音素，以完整 `large-v3` 单文件 beam size 5 识别；没有目标提示词，也未放宽独立词的冠词比较。

最后 8 条重点过去式句和 1 条姓名句采用同声自然 0.92 速度，完整保留词尾辅音、正常词边界及标点，不插入词组内逗号停顿或额外音节。9 个新媒体均实际识别，前后转写逐字相同，继续保留其真实差异；这不能据此断言录音漏读了输入中已有的 `/d/`。姓名句随后仅按既有严格词典证明规则单独处理同音拼写，原识别文本及前后媒体仍保留。所有未解决项继续提供复听，不将文字或音素核对称为人耳验收。

本阶段实际新增归档 1,873 个不再发布的媒体，均先复制并校验 SHA 后移除；累计外部历史为 4,873 个唯一媒体、115,923,181 字节和 8 份历史元数据。公开重试、修复和补充证明保留完整版本与指纹，公开校验无需访问外部历史目录。详尽阶段结果与比较口径见 [AUDIO-QUALITY-REVIEW.md](AUDIO-QUALITY-REVIEW.md)。

## 人工复听与日语假名录音

英语人工通过 42 条，另 8 个新版随时可以复听。[英语复核记录](AUDIO-HUMAN-REVIEW.md)

日语使用逐条编写的平假名合成 Alpha 音频。合成器依据假名直接映射音素，作者在输入中指定助词读音、长音及停顿。完整 large-v3 对编码后的 AAC 独立转写。比较器只在识别端把汉字转换为读音，保留手写参考。792 条中，291 条恢复 Kokoro，501 条保留系统日语语音。[完整条目清单](JAPANESE-AUDIO-REVIEW.md)

作者工具先用 `render-kana-audio.py render` 生成音频，再用同一脚本的 `asr` 模式核验。两个命令均接收 `--readings`（来源键到手写读音的 JSON 对象）和 `--out`（仓库外的检查点目录）。`publish-manual-kana.py` 用 `--render-dir` 和 `--readings` 预检整批。添加 `--apply` 后，只把读音核验通过的录音加入播放清单。公开质量记录保留每个来源键的手稿、媒体 SHA、识别分段与决定。

## 原作者资料

- [Kokoro 模型与许可](https://huggingface.co/hexgrad/Kokoro-82M)，[官方声音列表](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md)。
- [kokoro-onnx 作者的 CPU 封装](https://github.com/thewh1teagle/kokoro-onnx)，使用其 v1.0 ONNX 与声音包。
- [faster-whisper 作者安装、CPU int8 和转写说明](https://github.com/SYSTRAN/faster-whisper)。
- [OpenAI Whisper 原模型与许可](https://github.com/openai/whisper)，初轮采用 faster-whisper 作者维护的 [Whisper small 转换版](https://huggingface.co/Systran/faster-whisper-small)，后续强识别按质量报告记录固定模型及 SHA；完整模型来源为 [官方 large-v3 转换版](https://huggingface.co/Systran/faster-whisper-large-v3)。

工具与模型各自的许可按原作者资料保留；本仓库发布学习文本的合成音频，不提交模型或依赖代码。
