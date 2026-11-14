# 估分修正验收

旧模型取自 `a3d60cb`。在仓库根目录运行 `node scripts/simulate-prediction.mjs` 即可复现下表。两版共用 128 个种子、题序和作答随机数。难度按各 Part 的题库分布抽取，听读能力设为相同，每个模拟题使用独立 ID。正式作答计 200 题，每天 5 题。词汇对照额外加入 2,000 次已判分的词卡作答。

稳定性使用能力固定在 600 的考生。个人波动取第 201–500 题的样本标准差，再对 128 人求平均。另列第 200 题时 128 人之间的标准差。

## 模拟输出

```text
旧版 a3d60cb  173be0a48eb61a08    候选 7e7e0182df874cc5
种子 1729 起共 128 条轨迹；200 道正式题后比较校准，再观察 300 题波动。每日 5 道正式题。
两版共享难度、题序、日期和答题随机数。L/R 设为对称能力，难度按旧题库各 Part 抽取；选择题含随机猜中下限，logistic 分母 300。
┌─────────┬──────┬────────┬────────┬──────┬────────────┐
│ (index) │ 真值 │ 旧总分 │ 新总分 │ 差   │ 配对标准误 │
├─────────┼──────┼────────┼────────┼──────┼────────────┤
│ 0       │ 400  │ 382.5  │ 385.74 │ 3.24 │ 2.61       │
│ 1       │ 500  │ 492.3  │ 493.98 │ 1.68 │ 2.08       │
│ 2       │ 650  │ 640.55 │ 643.05 │ 2.5  │ 1.86       │
│ 3       │ 800  │ 797.81 │ 798.95 │ 1.13 │ 1.75       │
└─────────┴──────┴────────┴────────┴──────┴────────────┘
┌─────────┬────────────────────────────┬───────┬───────┬────────┐
│ (index) │ 指标                       │ 旧    │ 新    │ 差     │
├─────────┼────────────────────────────┼───────┼───────┼────────┤
│ 0       │ 'betweenLearnerSDAtWarmup' │ 50.49 │ 38.66 │ -11.84 │
│ 1       │ 'rawScoreSD'               │ 41.81 │ 21.86 │ -19.95 │
│ 2       │ 'rawDailySD'               │ 41.99 │ 21.98 │ -20.01 │
│ 3       │ 'displayedDailySD'         │ 41.99 │ 21.22 │ -20.77 │
└─────────┴────────────────────────────┴───────┴───────┴────────┘
┌─────────┬──────────────┬──────────────┬────────┬────────┬────────────┬────────────┐
│ (index) │ 条件         │ 已评分词汇题 │ 旧阅读 │ 新阅读 │ 相对无词旧 │ 相对无词新 │
├─────────┼──────────────┼──────────────┼────────┼────────┼────────────┼────────────┤
│ 0       │ 'control'    │ 0            │ 218.91 │ 219.61 │ 0          │ 0          │
│ 1       │ 'familiar'   │ 2000         │ 422.23 │ 219.61 │ 203.32     │ 0          │
│ 2       │ 'unfamiliar' │ 2000         │ 117.34 │ 219.61 │ -101.56    │ 0          │
└─────────┴──────────────┴──────────────┴────────┴────────┴────────────┴────────────┘
词汇已评分正确率 0.95/0.3；纯自评不写入估分。曲线：旧=raw dated totals，新=production smoothing。
```

## 题库校验

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
词卡 1087 · 多义词头 44 · Part 1 60 · Part 2 200 · Part 5 340 · Part 3/4 组 92 · Part 6/7 组 76 · 解题方法卡 22
题库与方法卡通过校验，含 2548 个唯一 ID。
```

## Node 测试

```text
✔ four full exams stay disjoint when ordinary practice changes question exposure between exams (105.180856ms)
✔ a half exam repairs low-capacity single-text selection while keeping whole passage sources (41.306621ms)
✔ malformed imports are rejected without relying solely on part totals (11.903456ms)
✔ completed scores use stored answer keys after a question changes or disappears (12.280844ms)
✔ a migrated report never attributes mixed legacy reading outcomes to one part (10.031688ms)
✔ a report recommendation routes to the exact weaker real grammar topic (3.620854ms)
✔ the real Part 6 corpus gives every score band a complete four-gap reading (1.479777ms)
✔ FSRS-6.0 default vectors and all four automatic grades (16.223354ms)
✔ old word boxes preserve IDs, statistics and deadlines; errors remain reviewable; migration is idempotent (6.007986ms)
✔ nonword error persists after one success, lapses reset the streak, two consecutive successes remove it (2.19666ms)
✔ verified screen check is Easy, fast Good and delayed Hard use one bank entry (2.891003ms)
✔ demonstrably word-only R resets without touching audio, XP, attained form, cards or dated results (14.706201ms)
✔ a mixed prior survives a truncated word-only history, unknown IDs, and exam-only evidence (17.962723ms)
✔ uncatalogued decode defers the v1 decision; a partial lookup cannot turn unresolved evidence into words (2.226269ms)
✔ old uncached history seeds once from recoverable L/R only; later vocabulary cannot evict the model (2.969857ms)
✔ word-only uncached backup leaves prediction absent and corrupted version-one cache is rejected (1.158709ms)
✔ v1 report is optional; rejects malformed restored counters and calendar dates (15.818521ms)
✔ practice and exam share counters; SRS vocabulary mastery uses the current box (5.782121ms)
✔ local 7/30 day windows include today, exclude tomorrow and do not invent dates for legacy answers (4.413618ms)
✔ long-term counters survive day pruning and serialization (3.892688ms)
✔ 20 unique headwords, ordered by difficulty; claims never count as answers and verified cards stay out of queue (15.640589ms)
✔ pending spot check resumes exactly and a stale gesture cannot double-count (0.595212ms)
ℹ tests 22
ℹ suites 0
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 634.598382
```

## 估分、诊断、存档、组卷、语音与方法卡

```text
evolution transitions [[1,13],[2,42],[3,76],[4,112],[5,151]]
fixed answer counts and old/new scores [[32,500,520,1],[96,705,730,3],[160,900,920,5],[240,900,975,5]] old evolution attempts [ 13, 54, 84, 118, 147 ]
Same 96-answer v1 save: 705 → 690 [565–815]; L 320 [250–390], R 370 [315–425]; XP 1064, form 4 preserved.
PASS independent word and spot-check evidence, dictation weight, three-day weighted charts and raw snapshots
Diagnosis: adaptive coverage, restore, stale clicks, per-skill start OK
Diagnosis: vocabulary-independent R ranges and verified historical ranges
PASS old saves with retired current, prior, later, completed and all-retired questions
Full form 1: 200 unique questions, graphics / three-voice / intent groups 5/6/4
Full form 2: 200 unique questions, graphics / three-voice / intent groups 5/6/3
Full form 3: 200 unique questions, graphics / three-voice / intent groups 6/6/4
Full form 4: 200 unique questions, graphics / three-voice / intent groups 5/6/3
PASS 4 disjoint full forms (800 questions, no shared passages); 24 half forms meet 50+50 quotas
PASS voice quality, exclusions, four-accent rotation and distinct manual cast
22 method cards all resolve to a real matching question; legacy saves, once-only, disabled and diagnostic passed.
Sentence boundaries, options, speakers and time abbreviations passed.
```

## 九项手机功能，375 / 390 / 430px

```text
PASS claude at 375px
PASS claude at 390px
PASS claude at 430px
PASS diagnosis at 375px
PASS diagnosis at 390px
PASS diagnosis at 430px
PASS fsrs at 375px
PASS fsrs at 390px
PASS fsrs at 430px
PASS issues at 375px
PASS issues at 390px
PASS issues at 430px
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
PASS unknown at 375px
PASS unknown at 390px
PASS unknown at 430px
```

## 端到端回归

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
```

## 离线与跨版本回归

```text
PASS: single online cold open adopted version 2; XP and answered item retained.
PASS: offline relaunch and resume; background update does not interrupt practice.
PASS: another cold window activates the update without reloading the live exercise.
PASS: live timed exam keeps its task and timer as a newer cold window activates the next shell.
```
