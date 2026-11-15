# 中日功能验收记录

基线为 `20ed11d`。本次最终应用壳为 `toeic-island-shell-33`，存档外层为 v4，旧 v1–v3 记录通过迁移继续使用。原七份英文题库与基线逐文件比较没有变化。测试日期：2026-11-16；浏览器：Google Chrome 157.0.8103.51，iPhone 13 设备模拟。没有使用真 iPhone。

## 冷加载对比

相同机器、本地静态服务、Chrome CDP 限速：下载 2 Mbps、上传 1 Mbps、延迟 80 ms；每次使用新浏览器上下文，关闭 Service Worker，避免离线预缓存干扰。每组 5 次，不删除最慢样本。首页从导航开始计至 `.habitat` 可见；首题从单词配置页点击开始计至第一个 `.lesson-option` 可见，不包括在地图选择模式的操作时间。复现命令见 README 的 `tests/performance.cjs`。

| 测量 | 修改前中位数 | 修改后中位数 | 差值 |
| --- | ---: | ---: | ---: |
| 首页 | 1717 ms | 1792 ms | +75 ms（约4.4%） |
| 第一题 | 2520 ms | 2518 ms | -2 ms |
| 首页到首题请求翻译包 | 0 | 0 | 0 |

首题中位数基本不变，首页增加约0.08秒。以下保留所有原始耗时；模拟结果不是实际 iPhone 网络或渲染性能的保证。

| 版本 | 首页5次（ms） | 首题5次（ms） |
| --- | --- | --- |
| 修改前 | 1806, 1717, 1715, 1722, 1702 | 2520, 2501, 2568, 2484, 2523 |
| 修改后 | 1841, 1811, 1790, 1792, 1788 | 2498, 2517, 2518, 3018, 3017 |

## 翻译体积与离线边界

七个中文包共559,469字节，七个日文包共695,507字节，合计1,254,976字节（UTF-8原始文件，未压缩）。另有53,214字节的日语词义小包、1,881字节的日语术语小包。数据按题库下载，正文包不进入首页或安装预缓存。

首次展开Part 2实测只请求中日两个文件；同页重复展开复用内存。关闭页面后断网重开，翻译从独立Cache Storage恢复。未下载的阅读翻译提示联网，并在同一页恢复网络后正常重试。真实SW升级保留已缓存译文。收藏快照无需重新下载译文，也随备份跨设备保存。

## 主校验输出

`node scripts/validate.mjs`，退出码0。除稳定键逐句对应，还检查一个源句的译文没有被拆成多个句子；引语内标点、连续问叹号、原文明确的邮件落款署名有针对性测试。

实际输出：

```text
Part 2 原词重复：干扰项 150/378 (39.7%)，正确回应 52/189 (27.5%)，仅靠排除即可作对 8/189 (4.2%)。
Part 6 插句位置 [1]/[2]/[3]/[4]：4/4/4/4
Part 7 插句位置 [1]/[2]/[3]/[4]：3/3/4/3
Part 7 专项：词义 25，NOT 16，插句 13；3–4 题单篇 30/40。插句排除于位置统计。
题型 | 最长（含并列） | 唯一最短¹ | 唯一最长¹ | 正确位置 A/B/C/D
Vocab meaning | 354/1087 (32.6%) | 178/1079 (16.5%) | 237/1079 (22.0%) | 260/273/275/279
Vocab english | 341/1087 (31.4%) | 177/1079 (16.4%) | 193/1079 (17.9%) | 281/253/269/284
Vocab sound | 330/1087 (30.4%) | 176/1082 (16.3%) | 183/1082 (16.9%) | 254/275/265/293
Vocab cloze | 306/1087 (28.2%) | 239/1078 (22.2%) | 163/1078 (15.1%) | 278/288/236/285
Vocab match | 305/1087 (28.1%) | 229/1087 (21.1%) | 259/1087 (23.8%) | 302/246/286/253
Part 1 | 15/60 (25.0%) | 15/60 (25.0%) | 15/60 (25.0%) | 15/15/15/15
Part 2 first | 4/11 (36.4%) | 3/10 (30.0%) | 3/10 (30.0%) | 4/4/3
Part 2 response | 70/189 (37.0%) | 52/188 (27.7%) | 60/188 (31.9%) | 63/63/63
Part 5 语法 | 78/240 (32.5%) | 34/238 (14.3%) | 36/238 (15.1%) | 60/60/60/60
Part 5 词汇 | 27/100 (27.0%) | 12/96 (12.5%) | 13/96 (13.5%) | 25/25/25/25
Part 3 | 53/156 (34.0%) | 44/147 (29.9%) | 35/147 (23.8%) | 39/39/39/39
Part 4 | 35/120 (29.2%) | 35/115 (30.4%) | 24/115 (20.9%) | 30/30/30/30
Part 6 | 21/64 (32.8%) | 15/62 (24.2%) | 14/62 (22.6%) | 17/16/15/16
Part 7 | 82/222 (36.9%) | 54/189 (28.6%) | 40/189 (21.2%) | 52/52/53/52
¹ 唯一最短、唯一最长的分母均排除所有选项等长的题。
i18n zh/vocab: 2181/2181 units
i18n ja/vocab: 2181/2181 units
i18n zh/part1: 240/240 units
i18n ja/part1: 240/240 units
i18n zh/part2: 803/803 units
i18n ja/part2: 803/803 units
i18n zh/listening: 2166/2166 units
i18n ja/listening: 2166/2166 units
i18n zh/grammar: 360/360 units
i18n ja/grammar: 360/360 units
i18n zh/reading: 1905/1905 units
i18n ja/reading: 1905/1905 units
i18n zh/methods: 44/44 units
i18n ja/methods: 44/44 units
Glossary: 49 rules; 7699 Chinese + 7699 Japanese units; term/cell hits 684 + 684; exact exceptions 2; quoted references 0.
Translation validation passed: 7699 Chinese + 7699 Japanese units; aligned keys and table columns.
Japanese derived meanings: 1087 exact entries; Japanese titles: 17 grammar + 22 methods.
词卡 1087 · 多义词头 44 · Part 1 60 · Part 2 200 · Part 5 340 · Part 3/4 组 92 · Part 6/7 组 76 · 解题方法卡 22
题库与方法卡通过校验，含 2548 个唯一 ID。
```

日语派生选择题另在 `tests/japanese-vocab.test.mjs` 用全部2174题核验唯一正确项、同义排除、长度和位置分布；原5435组词卡选项的哈希不变。

| 题型 | 最长含并列 | 唯一最短（排除全等长） | A/B/C/D |
| --- | --- | --- | --- |
| 看英文选日语 | 325/1087（29.9%） | 194/1085（17.9%） | 298/259/286/244 |
| 看日语选英文 | 324/1087（29.8%） | 187/1084（17.3%） | 272/280/292/243 |

## 逻辑测试

`node --test tests/*.test.mjs`，退出码0：

```text
ℹ tests 75
ℹ suites 0
ℹ pass 75
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 14893.240025
```

原独立入口 `voices.mjs`、`saves.mjs`、`forms.mjs`、`diagnosis-logic.mjs`、`prediction-logic.mjs`、`v6/replay-logic.mjs`、`v6/methods-logic.mjs` 均通过；覆盖四口音独立角色、下架ID旧档迁移、四套不重复全卷、24种半卷配额、自适应诊断、词卡不影响估分、平滑日曲线、分句及全部22张方法卡对应例题。`scripts/build-vocab-meanings.mjs --check`通过。

## 手机功能回归输出

`tests/v6.cjs` 原16个功能48个组合通过，随后增加的 `exam-translations` 三宽补测也通过；当前统一入口共17个功能、51个组合。375与430为浅色，390为深色。英语／日语朗读使用可控声音桩，检查可信点击调用栈、语言、声音和语速；不模拟实际声音质量。

```text
PASS claude at 375px
PASS claude at 390px
PASS claude at 430px
PASS diagnosis at 375px
PASS diagnosis at 390px
PASS diagnosis at 430px
PASS expressions at 375px
PASS expressions at 390px
PASS expressions at 430px
PASS fsrs at 375px
PASS fsrs at 390px
PASS fsrs at 430px
PASS issues at 375px
PASS issues at 390px
PASS issues at 430px
PASS japanese-audio at 375px
PASS japanese-audio at 390px
PASS japanese-audio at 430px
PASS japanese-terms at 375px
PASS japanese-terms at 390px
PASS japanese-terms at 430px
PASS japanese-vocab at 375px
PASS japanese-vocab at 390px
PASS japanese-vocab at 430px
PASS methods at 375px
PASS methods at 390px
PASS methods at 430px
PASS prediction at 375px
PASS prediction at 390px
PASS prediction at 430px
PASS replay at 375px
PASS replay at 390px
PASS replay at 430px
PASS screen at 375px
PASS screen at 390px
PASS screen at 430px
PASS translation-issues at 375px
PASS translation-issues at 390px
PASS translation-issues at 430px
PASS translation-recovery at 375px
PASS translation-recovery at 390px
PASS translation-recovery at 430px
PASS translations at 375px
PASS translations at 390px
PASS translations at 430px
PASS unknown at 375px
PASS unknown at 390px
PASS unknown at 430px
PASS exam-translations at 375px
PASS exam-translations at 390px
PASS exam-translations at 430px
```

视觉复核覆盖375px完整中日对照、390px深色表达本、430px声音和方法卡。发现英／日声音展开标题只有23px高，已修为44px并增加三宽断言；相关日语语音测试复跑3/3通过。其余新增控件没有横向溢出、标题截断或滚动到底后被底栏遮挡。所有2743行听力重听源句均有唯一对应翻译单位。

## 原应用与真实SW输出

`tests/e2e.cjs`、`tests/shell-update.cjs`、`tests/i18n-offline.cjs` 均退出0。原e2e中只把泛指声音列表的selector改成明确的英语列表，以适应增加的日语分区。

```text
PASS home at 375/390/430px
PASS manual voice selection and audition
PASS vocabulary, diagrams, illustrated Part 1, Parts 2–7, dictation and mobile layout
PASS mistake book and learning report
PASS JSON export and import
PASS full exam creation, checkpoint, interruption and resume
PASS continuous listening, timed reading, jumps, score, per-item timing, exam errors and half exam
PASS reading deadline auto-submits exactly once
PASS offline reopen, offline illustration and saved answer; zero uncaught page errors

PASS: single online cold open adopted version 2; XP and answered item retained.
PASS: offline relaunch and resume; background update does not interrupt practice.
PASS: another cold window activates the update without reloading the live exercise.
PASS: live timed exam keeps its task and timer as a newer cold window activates the next shell.

PASS i18n 375px: no eager packs; Part 2 downloads exactly the requested bilingual pair
PASS i18n 375px: closed-page offline reopen restores the answer and downloaded translations
PASS i18n 375px: uncached reading reports offline status; same-page online retry succeeds
PASS i18n 375px: real shell activation removes the old shell and preserves all translation packs
PASS i18n 390px: no eager packs; Part 2 downloads exactly the requested bilingual pair
PASS i18n 390px: closed-page offline reopen restores the answer and downloaded translations
PASS i18n 390px: uncached reading reports offline status; same-page online retry succeeds
PASS i18n 390px: real shell activation removes the old shell and preserves all translation packs
PASS i18n 430px: no eager packs; Part 2 downloads exactly the requested bilingual pair
PASS i18n 430px: closed-page offline reopen restores the answer and downloaded translations
PASS i18n 430px: uncached reading reports offline status; same-page online retry succeeds
PASS i18n 430px: real shell activation removes the old shell and preserves all translation packs
```

另以390px真实SW补查：缓存词义、语法译文和表达收藏后冷离线重载，已答日语词卡、表达快照、语法对照均可恢复。译文依赖JS首次下载中断后，在原页再次点击可恢复。

## iPhone手动核对

- Safari及主屏幕App首次点击英文／日语是否发声；下载Kyoko/Otoya增强或高级版后，自动选择及手动试听是否符合预期。
- 语速、静音状态、蓝牙耳机和锁屏返回后的系统声音行为。
- 联网展开某题型译文后，彻底关闭、飞行模式重新打开，检查译文及收藏复习；未下载的包应提示联网。
- 深色模式、日文字形、长句换行和底部Home条；导出收藏及练习进度，再导入同一备份。

翻译审校的实际修改与重点复核列表见 [BILINGUAL_QA.md](BILINGUAL_QA.md)。已知源英文疑点 `read-bikes` 保留到独立内容修订，本轮没有改动英文原题。
