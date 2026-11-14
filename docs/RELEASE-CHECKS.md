# 定版验收

## 题库清单

| 计数单位 | 400 | 500 | 600 | 700 | 800 | 900 | 合计 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 单词义项卡 | 99 | 362 | 375 | 181 | 46 | 24 | 1087 |
| Part 1 题 | 12 | 12 | 12 | 9 | 9 | 6 | 60 |
| Part 2 题 | 44 | 41 | 37 | 29 | 28 | 21 | 200 |
| Part 3 组／听写 | 10 | 10 | 10 | 9 | 7 | 6 | 52 |
| Part 3 理解题 | 30 | 30 | 30 | 27 | 21 | 18 | 156 |
| Part 4 组／听写 | 8 | 8 | 8 | 6 | 5 | 5 | 40 |
| Part 4 理解题 | 24 | 24 | 24 | 18 | 15 | 15 | 120 |
| Part 5 语法 | 51 | 49 | 52 | 34 | 33 | 21 | 240 |
| Part 5 词汇 | 17 | 24 | 22 | 17 | 12 | 8 | 100 |
| Part 6 组 | 3 | 3 | 4 | 3 | 2 | 1 | 16 |
| Part 6 题 | 12 | 12 | 16 | 12 | 8 | 4 | 64 |
| Part 7 组 | 11 | 12 | 12 | 9 | 9 | 7 | 60 |
| Part 7 题 | 37 | 40 | 44 | 37 | 36 | 28 | 222 |

## 校验脚本原始输出

~~~text
Part 2 原词重复：干扰项 150/378 (39.7%)，正确回应 52/189 (27.5%)，仅靠排除即可作对 8/189 (4.2%)。
Part 6 插句位置 [1]/[2]/[3]/[4]：4/4/4/4
Part 7 插句位置 [1]/[2]/[3]/[4]：3/3/4/3
Part 7 专项：词义 25，NOT 16，插句 13；3–4 题单篇 30/40。插句排除于位置统计。
题型 | 最长（含并列） | 唯一最短¹ | 唯一最长¹ | 正确位置 A/B/C/D
Vocab meaning | 354/1087 (32.6%) | 178/1079 (16.5%) | 237/1079 (22.0%) | 260/273/275/279
Vocab english | 341/1087 (31.4%) | 177/1079 (16.4%) | 193/1079 (17.9%) | 281/253/269/284
Vocab sound | 330/1087 (30.4%) | 176/1082 (16.3%) | 183/1082 (16.9%) | 254/275/265/293
Vocab cloze | 321/1087 (29.5%) | 247/1078 (22.9%) | 171/1078 (15.9%) | 290/272/250/275
Vocab match | 305/1087 (28.1%) | 229/1087 (21.1%) | 259/1087 (23.8%) | 302/246/286/253
Part 1 | 15/60 (25.0%) | 15/60 (25.0%) | 15/60 (25.0%) | 15/15/15/15
Part 2 first | 4/11 (36.4%) | 3/10 (30.0%) | 3/10 (30.0%) | 4/4/3
Part 2 response | 70/189 (37.0%) | 52/188 (27.7%) | 60/188 (31.9%) | 63/63/63
Part 5 语法 | 78/240 (32.5%) | 34/238 (14.3%) | 36/238 (15.1%) | 60/60/60/60
Part 5 词汇 | 27/100 (27.0%) | 12/96 (12.5%) | 13/96 (13.5%) | 25/25/25/25
Part 3 | 53/156 (34.0%) | 44/147 (29.9%) | 35/147 (23.8%) | 39/39/39/39
Part 4 | 35/120 (29.2%) | 35/115 (30.4%) | 24/115 (20.9%) | 30/30/30/30
Part 6 | 21/64 (32.8%) | 15/62 (24.2%) | 13/62 (21.0%) | 17/16/15/16
Part 7 | 82/222 (36.9%) | 54/189 (28.6%) | 40/189 (21.2%) | 52/52/53/52
¹ 唯一最短、唯一最长的分母均排除所有选项等长的题。
词卡 1087 · 多义词头 44 · Part 1 60 · Part 2 200 · Part 5 340 · Part 3/4 组 92 · Part 6/7 组 76
六份题库通过校验，含 2526 个唯一 ID。
~~~

## 浏览器和逻辑回归

浏览器在隔离测试存档中运行；语音事件由测试替身提供。iPhone 尺寸仿真不能确认真机的声线、下载音质、系统后台行为和主屏幕安装。

~~~text
PASS home at 375/390/430px
PASS manual voice selection and audition
PASS vocabulary, diagrams, illustrated Part 1, Parts 2–7, dictation and mobile layout
PASS mistake book and learning report
PASS JSON export and import
PASS full exam creation, checkpoint, interruption and resume
PASS continuous listening, timed reading, jumps, score, per-item timing, exam errors and half exam
PASS reading deadline auto-submits exactly once
PASS offline reopen, offline illustration and saved answer; zero uncaught page errors
~~~

~~~text
✔ four full exams stay disjoint when ordinary practice changes question exposure between exams (50.335262ms)
✔ a half exam repairs low-capacity single-text selection while keeping whole passage sources (20.052912ms)
✔ malformed imports are rejected without relying solely on part totals (6.956054ms)
✔ completed scores use stored answer keys after a question changes or disappears (6.271751ms)
✔ a migrated report never attributes mixed legacy reading outcomes to one part (6.104401ms)
✔ a report recommendation routes to the exact weaker real grammar topic (1.336271ms)
✔ the real Part 6 corpus gives every score band a complete four-gap reading (0.464075ms)
✔ v1 report is optional; rejects malformed restored counters and calendar dates (4.268594ms)
✔ practice and exam share counters; SRS vocabulary mastery uses the current box (2.568881ms)
✔ local 7/30 day windows include today, exclude tomorrow and do not invent dates for legacy answers (2.52069ms)
✔ long-term counters survive day pruning and serialization (2.534433ms)
ℹ tests 11
ℹ suites 0
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 380.856185
~~~

另外通过 5 种下架题存档迁移、英语声音筛选与角色分配测试。四套完整卷各 200 题，题 ID 与材料跨卷不重；24 个半套种子均达到 50 道听力及 50 道阅读。

## 首次加载

本地静态 HTTP、gzip 压缩、隔离 Chromium、冷缓存、150ms 延迟、下行 1.6 Mbps。屏蔽 Service Worker 以单独测量首次前台请求。每版三次，记录从导航开始到可见首页、再立即点听力任务到可见首题。

| 场景 | 改动前 d8ab174（三次，毫秒） | 定版（三次，毫秒） | 中位数 |
|---|---|---|---|
| 首页出现 | 2712 / 2664 / 2678 | 1150 / 1135 / 1123 | 2678 → 1135 ms |
| Part 2 首题出现 | 2823 / 2777 / 2788 | 2587 / 4970 / 1515 | 2788 → 2587 ms |

首题有一次花了 4970 ms；三次结果不足以代表真机首题延迟。新存档首页无需等待六份 JSON，选择练习时才加载相关题库。后台 Service Worker 安装完整离线包的时间未计入本表。已有存档需先取得全库以校正引用。

## 内容复核

复审及后续自然化的逐字段记录见 [修改明细](review-detail.csv)。没有待处理的已知错钥。建议独立抽核 p1-007（手伸向罐子与握住罐子的区别）、p3-g49-q2（一次性接收的范围）、read-donor-match-03（承诺与实际到账两个时间点）。
