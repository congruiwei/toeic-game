# 芽语岛开发手册

`index.html` 是游戏页面，`audition.html` 是独立试听页。浏览器原生加载 ES modules 和 UTF-8 JSON，题库、界面、养成逻辑都在本机运行。安装、启动和 Pages 发布命令见 [README](../README.md)。

## 从一次答题追踪代码

1. `js/app.js` 的 `boot()` 让新玩家直接进入小岛，按需加载所选题库；已有存档先加载完整题库并校正引用，再渲染首页。设置、导航、练习和弹窗通过 `data-act` 在同一处处理点击。
2. `js/training.js` 生成练习地图和配置面板。`app.js::start()` 收集学习模式、主题、细分题型和计时选项，将 `bank.js::select()` 选定的题目引用写入 `session.items`。
3. `js/bank.js` 保留原始题库 `bank`，并建立全局 `catalog`（子题 ID → 题目引用与材料）。`question(ref)` 取出当前题干、答案、原文、选项和能力类别。组内子题继承材料组的难度。
4. `js/practice.js::practiceView()` 按当前状态渲染图解、题面、反馈或结算。阅读题呈现整组文稿。听力原文可在提交后展开。题库文本在进入 HTML 前转义，高亮只包裹匹配到的原文片段。
5. `app.js::answer()` 只接受尚未作答的题，调用 `js/state.js::reward()` 更新能力、经验、错题、SRS 和进化，再把本题答案与本轮得分一起保存。下一题按钮只前移游标。同一道题在答后页面重开不会再次结算。
6. `js/library.js` 从题库和存档派生图鉴、主题筛选和错题列表。图鉴以单词 ID 为单位，任一单词题型答对一次即可收入。

| 文件 | 维护内容 |
| --- | --- |
| `style.css`、`practice.css`、`library.css` | 全站主题和布局、答题页、图鉴与错题本 |
| `js/art.js` | 原创 SVG 生物、六个阶段、能力分支特征、栖息地 |
| `js/tiles.js`、`js/icons.js` | 任务插画、交互图标 |
| `js/audio.js`、`js/japanese-audio.js` | 统一朗读入口、预生成优先及系统语音后备、设备音色选择、Web Audio 音效 |
| `js/recorded-audio.js`、`js/audio-downloads.js`、`js/audio-settings.js` | 按需清单、HTMLAudio 队列、下载与缓存管理、模考预载 |
| `assets/`、`manifest.webmanifest` | 品牌 SVG、180px Apple 图标、192/512px 安装图标、启动范围与竖屏显示 |
| `sw.js`、`.nojekyll` | 离线包与 GitHub Pages 静态发布 |
| `scripts/validate.mjs` | 检查六份题库、方法卡及中日翻译，输出错误位置和失败退出状态 |

## 数据约定

六个 JSON 文件的根都是数组。插画位于 assets/part1，题目文字位于 `data/`。词条、主题、材料组、选择题和听写题各有自己的 `id`，在**整套题库**中唯一。使用 1–100 位 ASCII 字母、数字、下划线或短横线，避开对象保留键。可参考现有前缀 `v-`、`gram-`、`p2-`、`p3-`、`p4-`、`read-`。难度 `level` 为整数 400、500、600、700、800 或 900。

选择题通用字段如下。除单词外，每道选择题都以此为基础。

| 字段 | 类型 | 用法 |
| --- | --- | --- |
| `id` | string | 稳定子题 ID |
| `prompt` | string | 题干或作答指令 |
| `options` | string[] | 顺序即显示顺序，Part 2 回应题也是朗读顺序；选项去重 |
| `answer` | string | 正确选项的完整文字，逐字匹配 |
| `correctedFrom` | string（可选） | 明确判错的旧答案；须仍在选项中且不同于 answer。旧模考只有命中此值时，回顾、复制、问题报告才改用当前正答，并标明原成绩保留；不改已保存 keys、成绩和经验 |
| `en`、`zh` | string | 英文解析、中文解析，指出决定答案的具体信息 |
| `evidence` | string | 听力、阅读使用；一段来源内可精确搜索的连续文字，保留原标点和大小写 |
| `paraphrase` | string | 听力、阅读使用；说明原文如何转换为选项里的表达 |

校验器能发现字段、标记和引用不一致。它用与游戏相同的函数生成五种词汇选项，逐题型统计最长答案比例（字符数，含并列最长），超过 40% 报错。同时报告排除全等长题后的唯一最短和唯一最长比例；唯一最短超过 35% 报错。正确选项位置的明显偏斜会给出警告，小题组的偶然波动可结合计数解释。每次编题也要把所有选项逐个代入语境，检查是否只有一个成立；多篇阅读须通读各文稿，核对日期、数量、发件人和代词指向。

### 单词与七种派生题型

在 [vocab.json](../data/vocab.json) 追加一个对象并补齐中日翻译，就会产生七种练习。下列例子展示单义卡的基本字段。

```json
{
  "id": "v-grommet",
  "level": 700,
  "theme": "制造",
  "word": "grommet",
  "ipa": "/ˈɡrɑːmɪt/",
  "pos": "n.",
  "zh": "护线圈；孔眼垫圈",
  "example": "The cable passes through a rubber grommet in the metal panel.",
  "collocation": "a rubber grommet",
  "paraphrase": "a protective ring around an opening",
  "clozeDistractors": ["receipt", "forecast", "deduction"]
}
```

`theme` 用中文，新增主题会出现在筛选器里。`example` 必须有且只有一次完整的 `word`，允许大小写差异。`paraphrase` 应匹配例句中的具体词义。例句填空优先使用 `clozeDistractors`，写三个互不相同且放进该句都不成立的英文干扰项。旧词条缺少此字段时可从词库生成选项。正式发布的词条必须提供三个手选填空干扰项：词性、形态和词数与目标匹配，全库同一干扰项最多出现三次。可选的 `confusables: string[]` 收录易混拼写或发音，也允许库外词。中译英和听音题优先使用这些词，其余选项按同词性优先、同主题次优先补足。意义相同或有明显重叠的词可加到 `avoidWith: string[]`：任意一边列出，生成选项时即双向避配。听音题过滤已知同音词；收录新的同音对子时同步维护 `bank.js` 的同音表。

| 引用中的 `format` | 提示 | 正确选项 |
| --- | --- | --- |
| `meaning` | 英文词头 | `zh` |
| `english` | 中文释义 | `word` |
| `sound` | 点击朗读词头 | `word` |
| `cloze` | `example` 隐去词头 | `word` |
| `match` | 英文词头 | `paraphrase` |
| `meaning-ja` | 英文词头 | 日语释义包的 `{id}/meaning` |
| `english-ja` | 日语释义 | `word` |

选项顺序使用词头、ID 和题型派生的种子。同一词的七种题型共享 FSRS 记录和词卡。`formats` 保留原五种供旧记录兼容；`vocabularyFormats` 包含七种。`vocabulary-language.js` 用既有作答次数推进释义语言交替，其余三种题型仍轮换。旧存档内已经确定的题型不改写；未下载日语释义时显示可重试的加载状态，完成后才开始作答计时。同一英文词头的不同义项不会互相成为干扰项；生成日语选项时额外排除同义释义。

### Part 5 语法与图解

[grammar.json](../data/grammar.json) 每一项为一个语法主题。已有主题加题只需在其 `questions` 里追加。新增主题可参照下例。

```json
{
  "id": "gram-quantity",
  "title": "数量词",
  "diagram": {
    "kind": "flow",
    "steps": [
      {"label": "可数复数", "detail": "folders → many folders"},
      {"label": "不可数", "detail": "paper → much paper"}
    ],
    "caption": "先判断名词是否可数，再选描述数量的词。"
  },
  "questions": [{
    "id": "gram-quantity-01",
    "level": 400,
    "prompt": "How ___ folders can the cabinet hold?",
    "options": ["many", "much", "little", "long"],
    "answer": "many",
    "en": "Folders is a plural count noun, so the question starts with How many.",
    "zh": "folders 是复数可数名词，询问数量用 how many。"
  }]
}
```

时间点或跨度适合 `kind: "timeline"`，结构或判断步骤适合 `"flow"`。每个图解至少有两步；时间轴用三个短节点可适应手机宽度。每题自带 `level`；用三个下划线 `___` 表示作答位置。练习在进入主题时显示图解，随后进入同一主题的题目。

### Part 2 首词与回应

[part2.json](../data/part2.json) 采用扁平结构。在通用选择题字段上增加 `level`、`type`、`audio`。首词题使用 `type: "first"`，将 `answer` 写成录音开头的完整单词，例如录音 `Where are the spare keys?` 对应 `Where`，可配 `When`、`Who` 为干扰项。

```json
{
  "id": "p2-extra-roll",
  "type": "response",
  "level": 500,
  "audio": "Could I borrow your tape dispenser?",
  "prompt": "听录音，选出最合适的回应。",
  "options": ["Help yourself. It's on my desk.", "About six meters long.", "I spoke at the meeting."],
  "answer": "Help yourself. It's on my desk.",
  "evidence": "borrow your tape dispenser",
  "paraphrase": "Help yourself → permission to use the dispenser",
  "en": "The speaker asks permission. Help yourself grants it.",
  "zh": "说话人想借用胶带座；Help yourself 表示同意对方取用。"
}
```

校验器另行报告 Part 2 原词重复：英语转小写后按字母切词，剔除函数内定义的常见虚词、缩写片段及 up，不作词干还原。同一选项命中多个重复词也只计一次。只有正确项不重复、两个干扰项均重复时，记为可仅靠排除原词答对。

新增回应题用 `questionType` 区分 wh、yes-no、choice、negative、tag、statement、request、suggestion，用布尔字段 `indirect` 标明是否需要从回应推知答案。

`response` 会把问句和按 A、B、C 编号的回应依次朗读，作答前隐藏选项正文。`evidence` 必须来自 `audio`；回应里的线索可以写进 `paraphrase` 和解析。

### Part 3/4 材料、子题与听写

[listening.json](../data/listening.json) 的每项有 `id`、`title`、`part`、`level`、`turns`、`questions`、`dictation`。以下为可独立校验的结构示例；扩充正式材料时，按现有题组为一段材料设置多道理解题。

```json
{
  "id": "p3-extra-tray",
  "part": 3,
  "level": 400,
  "title": "托盘的位置",
  "turns": [
    {"speaker": "A", "text": "Have you seen the blue tray?"},
    {"speaker": "B", "text": "I left it beside the copier."}
  ],
  "questions": [{
    "id": "p3-extra-tray-q1",
    "prompt": "Where is the tray?",
    "options": ["Near the copier", "Under a desk", "In a cupboard"],
    "answer": "Near the copier",
    "evidence": "beside the copier",
    "paraphrase": "beside → near",
    "en": "The second speaker left the tray next to the copier.",
    "zh": "第二位说话人把托盘放在了复印机旁。"
  }],
  "dictation": {
    "id": "p3-extra-tray-d",
    "text": "I left it beside the copier.",
    "answer": "beside"
  }
}
```

Part 3 用数字 `3`，以 `A`、`B`、`C` 区分最多三名说话人；Part 4 用数字 `4`，全部话轮由同一人朗读。`questions[].evidence` 应完整落在一个 `turns[].text` 内。听写模式从单独的子题 ID 找到 `dictation`，播放完整的 `text`，显示挖去 `answer` 的句子。该句须逐字取自原对话，答案是只出现一次的单词，判分忽略首尾空白和大小写。

听力图表可附 `graphic: {title, headers: string[], rows: string[][]}`。每行单元格数与表头相同。配套问题以 `Look at the graphic.` 开头，答案要结合录音线索和图表中的数据才能得出。

### Part 6/7 与多篇联读

Part 7 的上下文词义题、否定题、插句题分别标 `kind: "vocabulary" | "negative" | "insertion"`。插句选项固定依次为 `[1]` 至 `[4]`；相应标记必须出现在同一篇文稿。校验器统计长度时保留这类题，统计 A/B/C/D 分布时排除插句。

[reading.json](../data/reading.json) 的组字段为 `id`、`title`、`part`、`level`、`documents`、`questions`。文稿还可附带 `table: {headers, rows}`，正文和表格均可作为答案依据。每篇文稿有中文类型 `type`、英文标题 `title`、英文正文 `text`。换段在 JSON 字符串中写 `\n\n`，界面保留换行。每道子题包含通用选择题字段、`evidence`、`paraphrase`。

```json
{
  "id": "read-extra-pickup",
  "part": 7,
  "level": 500,
  "title": "地毯送货安排",
  "documents": [
    {"type": "邮件", "title": "Original delivery", "text": "Your carpet was booked for Tuesday at 10 a.m."},
    {"type": "通知", "title": "Revised delivery", "text": "We will come one day later, at the same time."}
  ],
  "questions": [{
    "id": "read-extra-pickup-01",
    "prompt": "When will the carpet arrive?",
    "options": ["Wednesday at 10 a.m.", "Tuesday at 10 a.m.", "Wednesday at noon"],
    "answer": "Wednesday at 10 a.m.",
    "evidence": "one day later, at the same time",
    "paraphrase": "one day later than Tuesday → Wednesday",
    "en": "The notice moves Tuesday's delivery to Wednesday and keeps the original hour.",
    "zh": "邮件约在周二上午十点；后续通知推迟一天，时间不变，因此是周三上午十点。"
  }]
}
```

Part 7 的 `documents` 放一篇即为单篇，两篇或以上即为联读。答案依据可以横跨多篇，`evidence` 取其中一篇的连续片段作为高亮锚点，其余依据在 `en`、`zh` 讲清。Part 6 用数字 `6`，在正文里用 `[1]`、`[2]` 标出空位，题干带同一编号，例如 `Which word best completes [1]?`。每个空位对应一道题。校验器会报告漏号或重复出题。

## 学习和养成规则

- **选题与复习。** 学习队列可直接从快筛结果或练习地图打开。普通混合词汇练习优先到期错词和到期词卡，再结合难度、快筛状态与题目曝光次数排序；显式选择某主题后，候选只来自该主题。错题本的到期入口按下次复习时间排序，只选到期记录；单题入口支持提前练习。非词汇错题答错时重置连续正确数，连续答对两次后移出。
- **FSRS。** `js/review-scheduler.js` 调用本地 `vendor/ts-fsrs/index.js`。上游 `ts-fsrs@5.2.3` 实现 FSRS-6.0，使用默认 21 个权重、学习步与重新学习步，目标记忆率为 0.85、0.90 或 0.95，默认 0.90。选择错误或明确不知道 → Again；普通答对、有效时间超过 8 秒 → Hard；其余普通答对 → Good；自报认识并通过抽查 → Easy。手势自报认识不算答题，留待短期确认。稳定度到期和成绩都按词卡 ID 区分独立义项。[上游包和 MIT 许可证](../vendor/ts-fsrs/README.md)
- **难度。** 首页诊断从 500 档起，共 30 题。按实际可用档位匹配目标，上一题正确时下一题目标升 100，错误或不知道时降 100，限制在 400–900。保留本轮题 ID 和游标，以便中断后继续。诊断模块独立汇总四项能力档位。诊断中每提交一题立即按 `sourceType: "diagnosis"` 更新估分、报告和对应复习记录；完成时只生成诊断结果，避免对全卷二次计分。模考则在交卷时对已经作答的各题更新估分，未答保留在错题本供复习。普通练习从最近一次已完成诊断的个人起点调整。尚未完成诊断时保留普通自适应路径。
- **估分。** `js/prediction.js` 分别更新听力 L 和阅读 R。模型比较实际作答与当前能力在给定题目难度下的预期表现，包含选择题的猜测底线。独立词卡和快筛抽查只计入词汇学习统计。听写继续按 0.35 的基础权重计入听力，Part 2 首词和重复题也采用较低权重。更新灵敏度为 `20 + 84 / (1 + (evidence / 35)³)`，每科从 104 起步，随着该科有效证据增加逐渐接近 20。两科各换算为 5–495 的估计和游戏参考区间，总计 10–990；有效样本增加时区间一般收窄。开始积累估分后的每个开岛日保存一个本地日期快照，同日作答更新当日的听力、阅读和合计值，报告按最后三个有快照的本地日期从旧至新赋权 1、2、3；只有两天时用 2、3，一天时取当日值。切换时段仅裁剪已算好的曲线。原始日快照、当前分数、参考区间与进化使用未平滑的估计。该模型未经官方量表标定。
- **成长。** 每题答对 +12 XP，答错 +4 XP，同时计入总经验和该题能力。每 100 总 XP 升一级，每 400 总 XP 解锁下一称号，至第五称号封顶。打开或从后台返回时，距最近访问记录已满 6 小时可获 8 总 XP。离开不会扣分、降级或减少能力。
- **进化。** 分数门槛依次为 400、500、600、700、800、900；各阶段另要求**每项**能力分别至少有 0、36、90、165、260、380 XP。进化时固定本次最强能力作为 `branch`；平手按词汇、语法、听力、阅读顺序取首项。每题最多推进一个阶段，已经获得的阶段会保留。形态名称、阈值和技能顺序在 `js/state.js`，图形特征在 `js/art.js`。

## 存档、恢复与版本

主键由 `state.js::KEY` 定义为 `sprout-isle.save`，值为整份 JSON。启动时请求 `navigator.storage.persist()`，授权结果由浏览器决定。设备之间可通过设置里的 JSON 导出、导入迁移进度。

| 字段 | 内容 |
| --- | --- |
| `version` | 当前存档协议版本，由 `state.js::VERSION` 管理 |
| `stats`、`xp`、`stage`、`branch` | 四项能力经验、总经验、阶段索引 0–5、最近一次进化分支 |
| `history` | 最近最多 120 条 `{skill,level,ok}` |
| `seen` | 按题目 ID 计数的作答次数 |
| `words` | 每个词卡 ID 的正确次数、作答次数、Unix 毫秒到期时间与 FSRS 卡片状态；保留兼容用的 `box` |
| `errors` | 每个错题保留 `misses,at,ref`；非词汇题再存 FSRS 状态和 `correctStreak` |
| `session` | 空闲时为 null；练习时有 `mode,title,items,index,right,gain,selected,elapsed,timed,intro` |
| `settings` | `theme,sound,motion,rate,accent,timed` 及语音槽、目标记忆率、方法提示等可选偏好 |
| `expressions` | `version:1` 的三语句子快照、FSRS 卡片及未完成翻卡练习；详见下文 |
| `lastVisit` | 最近访问的 Unix 毫秒时间戳，开页或切换前后台时更新 |

每个 `items` 元素为 `{id,mode}`，单词还可带 `format`。`index` 为从 0 开始的当前题序号，等于题量时显示结算。`selected: null` 表示可作答，已作答则保存所选文字。`elapsed` 为本轮有效阅读时间的毫秒累计。页面隐藏、离开练习、弹窗打开或完成作答时暂停计时。练习留在本地，首页「继续学习」恢复同题与作答阶段。

同源其他窗口写入存档时，当前窗口监听 `storage` 事件同步状态。保存前也检查最近读取的原始值，发现较新记录时优先采用它，并提示回首页继续。

导入先检查文件大小、解析 JSON，通过 `decode()` 验证版本和值域，再调用 `reconcileBank()` 清理已下架 ID。启动、文件导入、跨窗口同步和保存前冲突处理走同一路径。未完练习保留仍有效的题和原游标所指的作答阶段；当前题若已下架则前进到下一道有效题。全部下架时结束本轮，保留总经验。已作答的下架题计入可选的 `session.retiredAnswered` 结算分母。错题、见题次数和 SRS 清除下架引用；错误的已知题型或损坏存档仍会报错。用户确认恢复才替换当前进度。启动读取旧存档失败时保留原始记录并阻止自动覆盖。当前外层存档协议为 v5，兼容 v1–v4。v4 增加翻译／日语偏好和表达本，v5 增加 audioMode 与 audioGapMs，保持原学习记录与已达到形态。读取时由 `decode()` 验证和升级受支持的旧档，保留原主键。新增结构应以旧样本检验本机启动、跨窗口写入、导入和二次解码的幂等性。内层报告、预测和模拟考试的版本独立。

**稳定 ID 是题库对存档的接口。** 新增题目分配新 ID。修正拼写保留原 ID；替换考点、删除材料、调整题型或改答案前，检查 `session.items`、`session.selected`、`words`、`errors` 和 `seen` 的旧值。需要改 ID 时实现明确的迁移映射，保留历史统计，避免让旧的未完练习失去所引用的题。

## 语音与离线更新

- `audio.js::speak()` 与 `japanese-audio.js::speakJapanese()` 优先解析预生成清单；无文件才进入系统语音后备。默认 `audioMode:'recorded'`，显式 `system` 跳过预生成，设备音色设置只用于系统路径。首次点击同步解锁同一个 HTMLAudioElement，再按需取清单；失去用户手势的系统后备会提示再点一次。
- `recorded-audio.js` 使用稳定 key、bank、language、seed 和 speaker 定位音频，多句话轮保留 keys 数组。听写从原话轮继承说话人。播放速率用 playbackRate 和 preservesPitch，范围0.75–1.2；句间默认200ms。模考中若已经开始播放后失败，保存检查点退出，不从头用系统语音重播已听内容。
- 首页不下载音频。已播放文件进入独立音频缓存；设置按包下载、取消或删除，音频 JSON 与进度 JSON 分开。模考开始／恢复听力前，按同一 listeningScript 与解析器预载本卷全部文件，完成后再让用户点击开始，准备时间不计入作答。
- `sw.js` 安装时对 `files` 中的页面、图标、模块、样式和题库发起 `cache: "reload"` 请求。整包写入成功后才能完成安装。应用壳优先读缓存，导航可回退到缓存的 `index.html`。
- 已有 `data/*.json` **联网优先**。每次加载时，`updateBank()` 尝试获取最新版，验明 HTTP 成功且正文能解析为非空数组，再写入缓存。断网、请求失败、返回无效数据或网络超过 2.5 秒时，使用上次缓存。这个轻量检查仅检查顶层数组，发布前仍需完整运行校验脚本。
- **向既有文件追加同格式题目，只改 JSON。** 发布修改后的 HTML、CSS、JS、图标或不兼容的数据格式时，连同改动一起更新 `sw.js` 的 `CACHE` 标识。新增资源也要加入 `files`。所有站内路径相对项目根目录，兼容本地根路径和 Pages 仓库子路径。v6 用 `js/shell-update.js` 在冷开的首页通知已安装完成的新 worker 接管，并在尚未交互时重新加载。正在练习、计时或交互的页面继续使用当前文档。初次从未接入该协议的旧版升级，可以在联网下载完成后关闭所有旧客户端并再开一次。`activate` 只清理旧 `toeic-island-shell-*` 缓存，保留独立的翻译与音频缓存；存档仍由 localStorage 独立管理。
- 只改现有题型的内容无需增加运行时模块。真正新增互动类型时，依次扩展校验器、`loadBank()` 的索引、`question()` 的题面与 `skillFor()` 的计分映射、`training.js` 入口、`practice.js` 呈现和 `app.js` 交互，再将新增资源纳入离线包。为新增题型同时核对错题复习、退出续答、导入导出和离线首题。

## 验证入口

从仓库根目录运行：

```sh
node scripts/validate.mjs
python3 -m http.server 8080 --bind 127.0.0.1
```

前一个命令独立执行，不需要安装依赖。第二个命令仅供本机开发，打开 `http://127.0.0.1:8080/`。发布时直接使用静态文件。

手机回归按实际入口进行：

1. 在 375、390、430px 竖屏分别打开首页、图解、长选项和多篇阅读。切换深色模式，检查底部导航与键盘弹起后的听写输入。
2. 各做一道正确和错误的题。作答后刷新，从首页继续，核对本题解析和 XP。单词首次答对后检查图鉴，词汇错题答对后检查错题本；非词汇错题检查连续两次正确的清除条件。
3. 点击测试声音和首播，分别测试首词、间接回应、双人对话、独白、听写；在 iPhone Safari 或独立启动模式确认实际可听声音与口音。
4. 开启阅读计时，切到后台再返回，核对计时只累计活动练习时间。导出 JSON，换一个测试浏览器导入，检查四项经验、图鉴和未完成的题。
5. 联网打开，确认设置显示「离线题库已就绪」，然后离线重开主页，进入此前未玩的题型。更新题库后用旧存档重复续答，确认新资源与既有 ID 同时可用。

## 语音选择与试听

用户点击播放、试听或继续模考后，`js/audio.js` 才创建 `SpeechSynthesisUtterance`。每次播放先调用 `hush()` 取消旧队列并递增代号，过期回调不会推进新的播放。设置页订阅 `voiceschanged`，等待设备异步提供英语声音。

`englishVoices()` 接受 `en`、`en-*`、`en_*`，过滤旧 Apple 合成引擎 URI 和已知趣味音色，去掉重复的语音标识。只有筛选后仅余 Eloquence 一类声音时才采用它们。音质等级从本机返回的名字及 URI 识别，识别 Premium／高级、Enhanced／增强和普通三档。系统未注明质量时按普通档处理。

`settings.voiceSlots` 可省略。存在时，键是 `A`、`B`、`C`，值是 `voiceURI`，缺少 URI 时用 `name|lang`。旧存档自动选音，换设备后找不到先前的声音也会自动分配。手动分配优先；给两个角色指定同一声音时，先分配的角色使用它，另一角色尝试别的声音。每条声音可独立试听。

自动模式依据题目或材料组 ID 最后一段数字和角色次序，在设备有声源的 US、GB、AU、CA 四类口音中轮换。同一材料重开后使用相同起点。固定口音模式优先匹配指定地区。选音先尽可能区分不同人物，再考虑地区、音质、已识别声音的性别差异和已知自然音色。可用声音少时会复用并调整音高。系统列出了声音但没有可用英语声音时，界面提示下载英语声音；列表暂为空时，按语言标签向浏览器请求系统声音。语速保存在 `settings.rate`，范围为 0.75–1.2。实机试听取决于系统实际提供的音色。

## 多义词与 Part 1 插画

`data/vocab.json` 每张卡占一个 ID。同一 `word` 可以有多张卡，每张都要写唯一的 `id`、简短中文 `sense` 和准确的 `zh`。例如 `v-decline` 表示「婉拒」，`v-decline-fall` 表示「下降」。保留既有 ID，加新义项时创建新 ID。SRS、收藏和错题均按 ID 保存。同拼写的卡不会互作干扰项。看词选义与同义替换题展示该义项的例句，回答后可查词义标签、音标、搭配和释义。同形异读词须逐卡填写音标。预生成词头按词卡词性及音标显式处理常见异读词；系统后备仍可能只读同一拼写的一种读音。

例句采用 8–20 词的商务场景，完整词头只出现一次。每张卡填写三个同词性、同形态、等词数的 `clozeDistractors`，逐一代入后只能有一个语义成立的选项。规范化后同一填空干扰项在全库最多出现三次。`confusables` 放形音近的拼写。`avoidWith` 放可能同义或在译选题中无法排除的词头，生成时双向过滤。听音题另检查已知同音组和相同音标。

`data/part1.json` 中每题包含 `id`、`level`、`image`、四个英文句子的 `options`、逐字匹配的 `answer`、中文画面说明 `description`、英中解析 `en` 和 `zh`。路径用 `assets/part1/<id>.svg`，每题独立创作一张自包含 SVG。图和句子应共同支持唯一答案。练习先看插画，再由说话人 A 按 A–D 顺序读出四句，提交前屏幕只显示选项字母。回答后显示原句、画面说明及解析。调整图片时同时更新 Service Worker 缓存版本；安装阶段会根据 Part 1 清单预缓存每张图。

## 模拟卷配额及组卷

`js/exam.js` 生成试卷，`js/exam-controller.js` 管理播放、计时和交卷，`js/exam-ui.js` 负责题面和成绩。下表数字为题数。

| 卷型 | Part 1 | Part 2 | Part 3 | Part 4 | Part 5 | Part 6 | Part 7 | 阅读时限 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 全套 | 6 | 25 | 39 | 30 | 30 | 16 | 54 | 75 分钟 |
| 半套 | 3 | 12 | 20 | 15 | 15 | 8 | 27 | 38 分钟 |

Part 2 只选正式问答题。全套 Part 3、4 分别取 13、10 组；半套分别取 7、5 组，Part 3 最后一组取 2 题。Part 5 全套取语法、词汇各 15 题，半套取语法 8 题、词汇 7 题。Part 6 取 4 或 2 篇，每篇四空。Part 7 全套选 10 组单篇（29 题）、2 组双篇（10 题）、3 组三篇（15 题）。半套选 5 组单篇（14 题）、1 组双篇（5 题）、2 组三篇（共 8 题）。文章和文档完整展示，抽取的子题保持材料原顺序。若半套最初五篇单篇的可用题总数不足 14，组卷器尝试换入同卷池较长的材料。

Part 1、Part 2、Part 5 各自按稳定 ID 哈希排序，交错分为四池。长听力、Part 6、Part 7 单篇／双篇／三篇分别把整组材料分入四池，平衡难度、篇长、图表、三人对话和意图题覆盖。一次组卷只使用同一池号；优先交卷次数较少的池，再看材料已见题次，池内优先选见得少的题组。固定题库下从新档连续完成四套完整卷，题目 ID 和阅读／听力材料 ID 均应互不重复。半套考试也占用对应池的一次完成记录；四池用尽后允许重用。增减材料可能改变分组，按以下试验重新检查实际可形成的卷数。

### 听力断点、阅读计时和交卷

`exam` 可选，内部 `version: 1`。归档的 `units[]` 每项记录 `part` 和本组题目 ID 数组 `ids`。已开始的卷用这些 ID 恢复。导入时 `examValid` 核对各 Part 配额、题序、重复 ID、同组关系和当前游标。完成的卷另存 `keys` 作为交卷时的正确答案快照。 `examForms` 是四个非负完成次数，旧档缺失时按四个零处理。

Part 1 连读四个描述，Part 2 读题干和三个回应，Part 3/4 读材料的 `turns` 后依次读题干。模考统一给作答保留 5.5 秒，长听力每题各有一次等待。每段朗读沿用同组分配的角色声音。`exam.unit` 指向当前组，`step` 保留每个回合、题干或等待步骤的原有序号；可选 `exam.sentence` 指向当前步骤中下一句未开始的自然句，缺失时按 0 读取。控制器复用 `splitSentences`，每次只播放一句：首次实际 `onStart` 时保存下一句索引，最后一句才把 `step` 加一并将 `sentence` 归零；结束回调仅作兜底，不重复推进。中途退出后跳过已开始的一句，保留同一回合尚未开始的后续句；开始前播放失败则位置不变。旧档的已推进 `step` 不重新解释，不重播旧回合，也不需要提高主存档版本。导入时将 `sentence` 与当前步骤实际句数核对，等待步骤与阅读阶段只允许 0。`wait` 保存句间停顿或 5500 ms 答题等待的剩余毫秒，暂停和导出后可恢复；准备音频期间不计作答时间。播放失败时保存进度并返回入口，由用户再次点击继续，改用系统语音仍沿用同一句位置。`tests/exam-sentence-resume.test.mjs` 覆盖这些存档和恢复边界。

进入 Part 5 后才开启阅读倒计时。`deadline` 保存运行中的截止时间，`remaining` 保存剩余毫秒。`cursor` 可在所有阅读题间跳转，已选答案可在交卷前修改。保存离开、切后台或收到页面离开事件时结算用时并暂停；恢复时用保存的剩余时间建立新的截止时间。未触发生命周期事件而突然关闭时，原绝对截止时间仍可用于结算。到时自动交卷。

`times` 按题目 ID 累计毫秒数，尚未进入具体题目的共听时长在同组题间均摊；焦点切到某题后，后续停留时间计入该题。`answeredAt` 保留每题最后一次选择的时间。交卷时记录每 Part 的正确数、题次、逐题耗时和错因；未答题计错并进入错题本。听力和阅读各按本卷答对比例线性映射到 5–495 分，合计 10–990 分，仅供参考。

## 学习报告与旧版进度

`js/report.js` 的 `recordStudy` 统一接收已判定的练习结果和交卷时确实作答的模考条目。模考用最后一次选择的 `answeredAt` 归入设备本地日期。保存的可选 `report` 独立使用 `version: 1`，内含各 Part／单词／听写的 `parts`、Part 5 各关卡的 `topics` 和按 `YYYY-MM-DD` 聚合的 `days`。计数器使用 `{total, right}`。近 7、30 天窗口均含今天；保留最近一次记录日期往前共 370 天的日计数。

旧版一级存档可以没有 `report`。渲染时按当前题目 ID 将旧 `seen` 归到对应 Part 和语法关卡。旧单词练习的次数和判定使用 `words[id].tries/right`。其余旧判定只有在该能力的完整历史仍可核对、且整段历史唯一归属某个 Part 时才恢复正确数；关卡同理。无法还原日期的旧题次只进入累计量，无法还原正确性的记录显示「有判定」数量与全部题次。报表按长期复习状态且稳定度至少 7 天统计分级词汇掌握量，按有判定练习的最低正确率推荐复习，并以较大的样本量打破平局。

## 快筛、答后工具与存档迁移

- `js/answers.js` 定义 `UNKNOWN`。选择题提交「不知道」属于已经作答，始终判错。保留此哨兵以在错题、反馈和报告中区分选错与明确不会。未作答仍用 `null` 或缺少答案键。不要把哨兵当普通选项文字。
- `js/screening.js` 维护 `screening.run` 和 `screening.marks`。一轮最多从未练过、未筛过的词中挑 20 张，难度递增，一轮内不重复同一词头。marks 区分待学、尚待确认、自报通过抽查和已学；完成验证后的反馈也可续接。抽查只有提交后才记录实际作答。快筛结果和普通练习分别保存，重新进入未完快筛不会重抽。
- `js/question-tools.js` 生成用户所见选项顺序、原文和答案的快照。问题反馈含题号、预设原因、最多 1,000 字备注和该快照，在设置中复制。答后可复制包含完整材料的 Claude 提问；剪贴板拒绝访问时显示可全选的文本。内容保存或复制均在本机完成。
- `js/replay.js` 从已作答题的原文构建分角色逐句播放列表。保留题号、说话人、题组内音色分配和答案高亮。切换题目、折叠面板或离开时停止循环，模考答题阶段保留一次连续播放的规则。
- `js/methods.js` 按需加载 `data/methods.json`。每一项有稳定 `id`、`part`、`title`、`lead`、`steps[]`（`label`、`text`）和 `note`。首次提示的已读 ID 放在 `methodsSeen`，相应偏好在 `settings.methodHints`；方法地图可再次打开并进入匹配题型的真实例题。
- 旧 Leitner 记录的原到期日、累计正确数和尝试次数保留。旧盒 1–5 的 1/3/7/14/30 天作为初始化稳定度，旧盒 0 初始化为重新学习；缺失的上次复习时刻按原间隔保守估计。之后按真实评分调用 FSRS。更改目标记忆率会在各题下次评级时影响间隔。系统不具备旧档中从未保存的逐次复习日志。
- 旧档没有分科缓存时，模型只用保留的听力、语法、阅读历史初始化。分科缓存 v1 的混合总量缺少逐题明细，迁移到 v2 时沿用已有分数与证据，之后只更新符合新规则的作答。若可确认旧阅读证据全部来自词卡，则将阅读恢复为初始值。保留已存日快照、经验和形态。诊断历史保留原判定区间，新诊断的阅读区间使用语法和阅读。

## 回归入口

开发环境使用 Node 运行以下命令。网站本身仍可直接由静态 HTTP 服务提供。

```sh
node scripts/validate.mjs
node tests/voices.mjs
node tests/forms.mjs
node tests/saves.mjs
node --test tests/report.test.mjs tests/exam-edge.test.mjs tests/screen.test.mjs tests/fsrs.test.mjs
node tests/v6.cjs
```

组卷测试对真实题库连续生成四套全卷，断言 800 个题目 ID 唯一、跨卷材料不重复，并检查每卷的图表、三人对话、意图题覆盖；再用 24 个种子检查半卷配额。语音测试使用模拟声音清单。存档测试覆盖删除旧题后的游标修复，边界测试还会在两场考试之间插入普通练习，验证曝光权重变化后四套卷仍互斥，并核对非法导档、半套阅读子题数量和缺失历史日期的处理。需要浏览器回归时，让 Node 能解析 Playwright，在安装过 Chromium 的开发机运行 `node tests/e2e.cjs`。该脚本在本地临时端口提供静态文件，使用 iPhone 尺寸与模拟语音事件测试作答、断点、导入导出、报告、模考、离线重开和插画加载。真机上的系统音色、用户手势和扬声器效果需另外试听。

统一浏览器入口从 `tests/v6/` 装载功能场景，例如 `node tests/v6.cjs screen fsrs`。不带功能名时执行所有场景；每个场景分别使用 375、390、430px 竖屏上下文。ES module 单测无需浏览器，Playwright 测试需要本机 Chromium 和可解析的 `playwright` 模块。开发环境配置见 [README](../README.md)。


## 中日翻译、日语词卡与表达本

原题库和题目 ID 是唯一英文来源，不在翻译包中复制英文全文。新增或改动英文后，应同步维护两个语言包并运行主校验器。键结构和分句规则见 [I18N_DATA.md](I18N_DATA.md)，用语规范见 [glossary.md](glossary.md)。

| 文件 | 职责 |
| --- | --- |
| `js/translation-source.js` | 从原 JSON 生成稳定源单位；填入 Part 5／6 正确答案，按原句分切，保留表格单元格边界 |
| `data/i18n/{zh,ja}/{bank}.json` | 七个 bank 的译文 `{version:1, entries:{key:text}}`；每语言 7699 条 |
| `data/i18n/ja/vocab-meanings.json` | 1087 个日语释义的轻量派生包，单词题与详情不必下载例句全集 |
| `scripts/build-vocab-meanings.mjs` | 从日语 vocab 包生成释义小包；`--check` 只校验是否同步 |
| `data/i18n/ja/terms.json`、`js/japanese-terms.js` | 17 个语法主题、22 个方法标题的日语标签；遇到带标记的标题才加载 |
| `data/i18n/glossary.json`、`scripts/validate-glossary.mjs` | 50 条上下文术语规则；表格按单元格检测，例外必须精确记录源句、译句及理由 |
| `data/i18n/literals.json` | 英文专名确实无需翻译的精确例外，不以整篇豁免代替译文 |
| `js/translations.js` | 按语言和 bank 合并并发请求，缓存成功结果；失败可重试，网络不可用时读 Cache Storage |
| `js/translation-ui.js`、`translation.css` | 懒加载的逐句／逐行渲染、语言切换、收藏；正确设置 `lang=zh-CN` 与 `lang=ja` |
| `js/japanese-audio.js` | 同步点击触发 ja-JP 朗读、过滤趣味语音、质量排序与手动选音 |
| `js/expressions.js`、`js/expression-ui.js` | 收藏验证、双向翻卡、FSRS 及表达本列表／报告 |

### 下载与显示边界

首页和第一道未作答练习不请求 `data/i18n`。翻译按钮只出现在答后、已交卷模考回顾和允许学习的卡片详情中。设置默认展开时，也先通过答题状态检查。Part 6 在同篇尚有未答空位时，暂缓已填好所有答案的整篇对照；当前已答插句题的选项译文仍可查看。完成本篇才开放全篇。事件处理器再次检查当前视图与源单位，隐藏按钮并非唯一保护。

`translation-ui.js` 由 `app.js` 动态导入，失败会清除待处理 promise 并重试新模块 URL，样式失败也可重新加载。`translationExpanded` 默认 false；`translationLanguage` 默认 `both`，另支持 `zh` / `ja`。逐句重听的子面板独立展开，模考的折叠回顾只在实际打开后下载。

首次展开调用 `loadTranslations(bank)`，并行下载中日两个文件。`toeic-island-translations-v1` 与应用壳缓存独立，译文下载后缓存；无 SW 控制的首次访问也由模块直接写缓存。SW 对翻译包联网优先，最长等待 15 秒，失败回退已缓存文件；普通英文题库仍用 2.5 秒回退。译文 JSON 不进入安装预缓存，未下载部分离线时提示联网重试。升级壳版本保留已下载翻译，正常联网重新打开相应题型时刷新该包。

日语词义题首次按需下载 53,214 字节释义小包，`vocabLanguage` 默认 `both`，还支持 `zh` / `ja`。快筛抽查和诊断沿用原中文题型；普通混合练习的两种释义方向交替使用中日。英文原题、正确答案和原五种题型的确定性选项序列未改。

### 表达本存档契约

`expressions: {version:1, items:[], run:null}` 是旧档迁移默认值。每条 item 为 `{key, sourceId, bank, en, zh, ja, addedAt, fsrs?}`；保存真实源句与当时三语译文的快照，原题日后下架也不删除收藏。相同 key 只收藏一次。导出、导入包含收藏及复习状态；不包含可重新下载的全文翻译缓存。备份文件上限为 25 MB。

`run` 保存方向 `ja-en` / `en-ja`、key 队列、游标、是否翻开。每轮最多 20 条，优先到期句子，没有到期卡时允许自由温习。必须翻开后才能评级，1–4 对应 Again / Hard / Good / Easy；两种方向共享同一条表达的 FSRS 状态与设置中的目标记忆率。掌握数按 Review 状态且稳定度至少 7 天统计，练习不改变 TOEIC 估分或进化。导入校验拒绝重复 key、非法语言文本／时间／卡片状态和不属于收藏的练习引用；不会把损坏结构静默置空。

日语朗读入口优先播放已生成的 Alpha 音频；系统路径在用户点击调用栈中执行 `speechSynthesis.speak()`，避免先等待动态导入。使用 `settings.japaneseVoice` 指定音色，找不到时回退自动；优先高级、增强、普通，再优先 Kyoko / Otoya。尚未返回语音清单时以 ja-JP 请求系统默认音色；已有清单但无安全日语声音时提示下载。英文逐句重听的语速设置也用于日语。

### 翻译校验与回归

`node scripts/validate.mjs` 同时验证题库和翻译：完整源 key 集合、无空译文、非英文复制、逐句／表格列对齐、50 条术语规则、释义派生包一致性及39个标题。专名和必要语境变化以精确例外记录，不能用宽泛词表免除检查。机器检查保证结构，语义和商务日语自然度仍需要逐句审校。

`node --test tests/*.test.mjs` 检查源句拆分、翻译缓存、术语、日语词义选项、存档迁移、FSRS、语音筛选等；`tests/v6.cjs` 对全部功能执行375/390/430px回归（390px深色）。`tests/i18n-offline.cjs` 使用真实SW测试断网冷启动和缓存升级，`tests/performance.cjs` 保留可复现的5次冷加载测量。具体命令见README，完整审校和实测结果见 [BILINGUAL_QA.md](BILINGUAL_QA.md)。

### 独立 Kokoro 试听与全库音频

`audition.html`只负责试听与记录候选，不修改正式练习的朗读或`sprout-isle.save`。自己的偏好键为`toeic-island-audition-v1`。`data/audio-audition-source.json`保存原题／日语译文的精确key与文本、官方候选等级，`spoken`可显式覆盖数字或特殊读法；`data/audio-audition-manifest.json`按`clips[voiceId][sampleId]`定位完整样本及`segments`逐句音频。每条含`src/duration/bytes/sha256`，源文件SHA与完成标记防止半份或跨文本版本发布。

音频在`audio/audition/`，点击才下载，使用同一个HTMLAudioElement播放与双人试配。系统日语通过直接点击触发speechSynthesis。SW35为试听五个页面／清单资源提供按访问更新的专用分支；未加入安装预缓存，也不把对象清单当成题库数组处理。AAC、模型生成工具及外部环境的说明见 [KOKORO-AUDITION.md](KOKORO-AUDITION.md)。正式学习音频使用另一个清单及缓存，不复用试听选择作为配声设置。


### 正式音频的生成与缓存

`data/audio/source.json` 是开发用来源表，不由游戏加载。`data/audio/manifest.json` 按 bank／语言索引小包，`data/audio/{en,ja}/{bank}.json` 将稳定源键映射到 `audio/generated/` 中的独立 AAC/M4A 文件。每条有原文、朗读文本、声音、时长、字节数、SHA-256 及 ASR 状态。模型、Python 环境、原始 WAV 和转写中间缓存放在仓库外；只有压缩媒体、可审查清单和生成脚本进入仓库。[完整数据与生成契约](AUDIO-GENERATION.md)

音频缓存 `toeic-island-audio-v1` 存完整200响应，SW可从它生成Safari所需的206分段响应。下载前后核对文件大小、M4A标识和SHA；取消保留已完成文件，删除使用代数令牌防止尚未完成的请求重新填满缓存。清单缓存 `toeic-island-audio-meta-v1` 独立保留，播放缓存不是存档的一部分。音频不列入SW安装预缓存，升级不会强制重新下载全部媒体。

空间统计最多同时读取4个缓存响应的实际字节，不依赖可能缺失或失真的Content-Length。设置页同时加载小清单与统计，清单和按钮不用等待全缓存扫描；新的统计会取消旧请求。删除前后都会改变缓存代号，持有旧Cache对象的统计必须重开当前缓存，不能在删除后回显旧容量。
