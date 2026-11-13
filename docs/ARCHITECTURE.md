# 芽语岛开发手册

`index.html` 是唯一页面。浏览器原生加载 ES modules 和 UTF-8 JSON，题库、界面、养成逻辑都在本机运行。安装、启动和 Pages 发布命令见 [README](../README.md)。

## 从一次答题追踪代码

1. `js/app.js` 的 `boot()` 加载全部题库，恢复本地存档，并渲染首页。设置、导航、练习和弹窗通过 `data-act` 在同一处处理点击。
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
| `js/audio.js` | 语音队列、音色选择、Web Audio 音效 |
| `assets/`、`manifest.webmanifest` | 品牌 SVG、180px Apple 图标、192/512px 安装图标、启动范围与竖屏显示 |
| `sw.js`、`.nojekyll` | 离线包与 GitHub Pages 静态发布 |
| `scripts/validate.mjs` | 检查五份题库，输出错误位置和失败退出状态 |

## 数据约定

五个 JSON 文件的根都是数组。所有内容只放在 `data/`。词条、主题、材料组、选择题和听写题各有自己的 `id`，在**整套题库**中唯一。使用 1–100 位 ASCII 字母、数字、下划线或短横线，避开对象保留键。可参考现有前缀 `v-`、`gram-`、`p2-`、`p3-`、`p4-`、`read-`。难度 `level` 为整数 400、500、600、700、800 或 900。

选择题通用字段如下。除单词外，每道选择题都以此为基础。

| 字段 | 类型 | 用法 |
| --- | --- | --- |
| `id` | string | 稳定子题 ID |
| `prompt` | string | 题干或作答指令 |
| `options` | string[] | 顺序即显示顺序，Part 2 回应题也是朗读顺序；选项去重 |
| `answer` | string | 正确选项的完整文字，逐字匹配 |
| `en`、`zh` | string | 英文解析、中文解析，指出决定答案的具体信息 |
| `evidence` | string | 听力、阅读使用；一段来源内可精确搜索的连续文字，保留原标点和大小写 |
| `paraphrase` | string | 听力、阅读使用；说明原文如何转换为选项里的表达 |

校验器能发现字段、标记和引用不一致。它用与游戏相同的函数生成五种词汇选项，逐题型统计最长答案比例（字符数，含并列最长），超过 40% 报错。正确选项位置的明显偏斜会给出警告，小题组的偶然波动可结合计数解释。每次编题也要把所有选项逐个代入语境，检查是否只有一个成立；多篇阅读须通读各文稿，核对日期、数量、发件人和代词指向。

### 单词与五种派生题型

在 [vocab.json](../data/vocab.json) 追加一个对象就会产生五种练习。下列例子展示全部字段。

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

选项顺序使用词头、ID 和题型派生的种子。同一词的五种题型共享 SRS 盒子和词卡。混合练习轮换题型，也可在练习地图固定一种题型。

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

- **选题。** `select()` 先应用模式和主题筛选，优先未掌握的错题和到期词，再按目标难度、练习次数和小幅随机扰动排序。未到期的词排在后面。普通短练习最多取五题；阅读和 Part 3/4 选择一组后按原文顺序出整组题。独立错题练习按连续未订正的错误次数降序，同次数优先较早记录。
- **SRS。** 初始盒为 0。答对前进一盒，到 5 为止；盒 1–5 的间隔为 1、3、7、14、30 天。答错退回盒 0，记录两分钟后的复习时间，并进入错题本。错题优先级可以让它在到期前就再次出现。错题按 ID 记录，再次答对移出。
- **难度。** 每种能力独立计算。在保留的答题历史中取该能力最近 12 题，不足 4 题时从 400 起步。平均题目难度先取到最近的整百，正确率至少 75% 再加 100，低于 45% 减 100，最终限制在 400–900。
- **预估分数。** 跨能力取最近 32 题，按从旧到新的序号加权。每次正确暂计“难度 +145”，每次错误暂计“难度 −175”。不足 8 题时以题数除以 8 的比例从 400 向加权值过渡，最后取最近的 5 分并限制在 400–900。此值是游戏内参考估计。
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
| `words` | 每个词的 `{box,due,right,tries}`，`due` 为 Unix 毫秒 |
| `errors` | 每个错题的 `{misses,at,ref}`，`ref` 保存实际模式和词汇题型 |
| `session` | 空闲时为 null；练习时有 `mode,title,items,index,right,gain,selected,elapsed,timed,intro` |
| `settings` | `theme,sound,motion,rate,accent,timed` |
| `lastVisit` | 最近访问的 Unix 毫秒时间戳，开页或切换前后台时更新 |

每个 `items` 元素为 `{id,mode}`，单词还可带 `format`。`index` 为从 0 开始的当前题序号，等于题量时显示结算。`selected: null` 表示可作答，已作答则保存所选文字。`elapsed` 为本轮有效阅读时间的毫秒累计。页面隐藏、离开练习、弹窗打开或完成作答时暂停计时。练习留在本地，首页「继续学习」恢复同题与作答阶段。

同源其他窗口写入存档时，当前窗口监听 `storage` 事件同步状态。保存前也检查最近读取的原始值，发现较新记录时优先采用它，并提示回首页继续。

导入先检查文件大小、解析 JSON，通过 `decode()` 验证版本和值域，再通过 `verifyRefs()` 核对未完练习和错题的 ID / 模式。用户确认恢复才替换当前进度。启动读取旧存档失败时保留原始记录并阻止自动覆盖。当前实现只识别 v1；若修改结构，先在 `decode()` 的入口实现从 v1 及已支持版本到新结构的迁移，再修改版本号，并用旧存档回归测试本地启动和备份导入。

**稳定 ID 是题库对存档的接口。** 新增题目分配新 ID。修正拼写保留原 ID；替换考点、删除材料、调整题型或改答案前，检查 `session.items`、`session.selected`、`words`、`errors` 和 `seen` 的旧值。需要改 ID 时实现明确的迁移映射，保留历史统计，避免让旧的未完练习失去所引用的题。

## 语音与离线更新

- `play` 与设置的“测试声音”按钮直接触发 `audio.js::speak()`。它取消上一队列，按话轮创建 `SpeechSynthesisUtterance`，保留引用并依次加入 `speechSynthesis`。把首播放在用户点击事件内，避免 iOS 自动播放限制。
- 语速取设置的 0.75–1.2。优先使用设备提供且匹配所选口音的英语音色，尽量给每个说话人分配独立音色。可用音色不足时轮用现有音色，并用不同音高区分。离线朗读取决于设备上的本地英语语音；Web Audio 为正确、升级、进化分别生成提示音。
- `sw.js` 安装时对 `files` 中的页面、图标、模块、样式和题库发起 `cache: "reload"` 请求。整包写入成功后才能完成安装。应用壳优先读缓存，导航可回退到缓存的 `index.html`。
- 已有 `data/*.json` **联网优先**。每次加载时，`updateBank()` 尝试获取最新版，验明 HTTP 成功且正文能解析为非空数组，再写入缓存。断网、请求失败、返回无效数据或网络超过 2.5 秒时，使用上次缓存。这个轻量检查仅检查顶层数组，发布前仍需完整运行校验脚本。
- **向既有文件追加同格式题目，只改 JSON。** 发布修改后的 HTML、CSS、JS、图标或不兼容的数据格式时，连同改动一起更新 `sw.js` 的 `CACHE` 标识。新增资源也要加入 `files`。所有站内路径相对项目根目录，兼容本地根路径和 Pages 仓库子路径。旧 worker 有活动页面时，新版本会等待；关闭该站的已开页面及主屏幕窗口并重开，使新版本接管。`activate` 清理本应用旧缓存，存档仍由 localStorage 独立管理。
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
2. 各做一道正确和错误的题。作答后刷新，从首页继续，核对本题解析和 XP。单词首次答对后检查图鉴，错题复习答对后检查错题本。
3. 点击测试声音和首播，分别测试首词、间接回应、双人对话、独白、听写；在 iPhone Safari 或独立启动模式确认实际可听声音与口音。
4. 开启阅读计时，切到后台再返回，核对计时只累计活动练习时间。导出 JSON，换一个测试浏览器导入，检查四项经验、图鉴和未完成的题。
5. 联网打开，确认设置显示「离线题库已就绪」，然后离线重开主页，进入此前未玩的题型。更新题库后用旧存档重复续答，确认新资源与既有 ID 同时可用。
