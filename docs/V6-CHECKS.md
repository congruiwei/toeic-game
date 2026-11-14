# 芽语岛 v6 验收记录

本地静态站点在 GitHub Pages 项目子路径下运行。手机回归使用 Chromium 的 iPhone 竖屏参数。390px 使用深色模式，375px 与 430px 使用浅色模式。语音测试可控地触发播放事件，实体 iPhone 的音色、触摸手感及系统剪贴板需在设备上确认。

## 题库与方法卡

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

## 状态、组卷与复习回归

```text
✔ four full exams stay disjoint when ordinary practice changes question exposure between exams (89.19448ms)
✔ a half exam repairs low-capacity single-text selection while keeping whole passage sources (29.976935ms)
✔ malformed imports are rejected without relying solely on part totals (8.80436ms)
✔ completed scores use stored answer keys after a question changes or disappears (8.457955ms)
✔ a migrated report never attributes mixed legacy reading outcomes to one part (6.460791ms)
✔ a report recommendation routes to the exact weaker real grammar topic (2.14491ms)
✔ the real Part 6 corpus gives every score band a complete four-gap reading (1.159316ms)
✔ FSRS-6.0 default vectors and all four automatic grades (13.201797ms)
✔ old word boxes preserve IDs, statistics and deadlines; errors remain reviewable; migration is idempotent (3.540623ms)
✔ nonword error persists after one success, lapses reset the streak, two consecutive successes remove it (1.575581ms)
✔ verified screen check is Easy, fast Good and delayed Hard use one bank entry (3.122126ms)
✔ v1 report is optional; rejects malformed restored counters and calendar dates (6.872265ms)
✔ practice and exam share counters; SRS vocabulary mastery uses the current box (4.047293ms)
✔ local 7/30 day windows include today, exclude tomorrow and do not invent dates for legacy answers (2.267403ms)
✔ long-term counters survive day pruning and serialization (2.889185ms)
✔ 20 unique headwords, ordered by difficulty; claims never count as answers and verified cards stay out of queue (9.714911ms)
✔ pending spot check resumes exactly and a stale gesture cannot double-count (0.705879ms)
ℹ tests 17
ℹ suites 0
ℹ pass 17
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 563.896912
```

## 独立逻辑测试与同档估分对照

```text
Full form 1: 200 unique questions, graphics / three-voice / intent groups 5/6/4
Full form 2: 200 unique questions, graphics / three-voice / intent groups 5/6/3
Full form 3: 200 unique questions, graphics / three-voice / intent groups 6/6/4
Full form 4: 200 unique questions, graphics / three-voice / intent groups 5/6/3
PASS 4 disjoint full forms (800 questions, no shared passages); 24 half forms meet 50+50 quotas
PASS voice quality, exclusions, four-accent rotation and distinct manual cast
PASS old saves with retired current, prior, later, completed and all-retired questions
Diagnosis: adaptive coverage, restore, stale clicks, per-skill start OK
evolution transitions [[1,13],[2,45],[3,80],[4,115],[5,151]]
fixed answer counts and old/new scores [[32,500,520,1],[96,705,720,3],[160,900,925,5],[240,900,970,5]] old evolution attempts [ 13, 54, 84, 118, 147 ]
Same 96-answer v1 save: 705 → 675 [555–795]; L 310 [240–380], R 365 [315–415]; XP 1064, form 4 preserved.
Sentence boundaries, options, speakers and time abbreviations passed.
22 method cards all resolve to a real matching question; legacy saves, once-only, disabled and diagnostic passed.
```

## 九项功能 · 三种宽度

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

## 既有端到端回归

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

## 联网更新和离线重开

```text
PASS: single online cold open adopted version 2; XP and answered item retained.
PASS: offline relaunch and resume; background update does not interrupt practice.
PASS: another cold window activates the update without reloading the live exercise.
PASS: live timed exam keeps its task and timer as a newer cold window activates the next shell.
```
