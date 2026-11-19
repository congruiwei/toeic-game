# 芽语岛 · TOEIC 学习养成

词卡的新增词、构词家族、易混词分组、退役配对及 20 组三语趣句见[词卡内容清单](docs/VOCAB-CARDS.md)。

[打开游戏](https://congruiwei.github.io/toeic-game/) · [音频复听](https://congruiwei.github.io/toeic-game/audio-review.html)

英语预生成音频使用 Kokoro Heart、Puck、Bella，日语使用 Alpha，均由本地开源模型合成。保留[声音试听](https://congruiwei.github.io/toeic-game/audition.html)和[本地生成说明](docs/AUDIO-GENERATION.md)。

音频覆盖范围、识别待核对清单、加载性能和浏览器测试结果见[音频与选项释义验收](docs/AUDIO-RELEASE-CHECKS.md)。

后续读音规则、较强本地识别与待复听数量更新见[音频质量二次复核](docs/AUDIO-QUALITY.md)。

用几道商务英语练习培育一只住在浮岛上的芽团。单词、语法、听力和阅读分别积累经验，共同解锁六个形态。练习可以随时离开，回到小岛后点「继续学习」即可从上次的位置继续。

复听页按题型列出仍需人工判断的可播放录音，支持慢速重听、三个判断标签、备注和本机记录导出。已处理的日语系统后备单独计数，不混入复听队列。[复听与维护说明](docs/AUDIO-REVIEW.md)

在「图鉴 → 词根图鉴」可以查看构词家族。在单词答后点构词片段，还能对照同族词；部分 Part 5 解析也会标出后缀与词性的关系。[词根与词缀说明](docs/MORPHEMES.md)

在「练习 → 易混词对决」可以用一句话区分同组单词。答错的义项会进入「我的单词本」。查看词卡或答完普通练习后，也可以点两个词连续试听，比较重音和读音。[易混词内容与出题规则](docs/CONFUSABLES.md)

## 在 iPhone 上安装

1. 用 Safari 打开游戏，首次打开时保持联网，在设置看到「离线题库已就绪」。
2. 轻点「分享」。部分 Safari 布局先点「更多」，再选「分享」。
3. 选择「添加到主屏幕」。如有「作为网页 App 打开」选项，将它打开，然后点「添加」。
4. 从主屏幕图标打开游戏。在设置里点「测试声音」。普通练习点「点击开始」，可以重听；模考先下载本套听力，再点「开始听力」，随后连续播放。

页面和题库可以离线使用。已播放的音频会自动缓存；设置可批量下载听力、单词、阅读和日语音频，显示实际大小、进度及已用空间，也可取消或删除音频。没有对应音频时使用系统语音后备。中日译文首次展开时下载，下载过的部分可离线查看。[Apple 主屏幕网页 App 指南](https://support.apple.com/zh-cn/guide/iphone/iphea86e5236/ios)

## 游戏内容

| 练习 | 题库规模 | 玩法 |
| --- | --- | --- |
| 单词 | 1124 张词卡，1057 个独立词头，50 个多义词 | 中英／日英互选、听音辨词、例句填空、同义替换。答对收集词卡，按间隔复习 |
| 语法 | 240 道语法题、100 道词汇题 | 先浏览时间轴或结构图，再完成 Part 5 填空并查看英中解析 |
| Part 1 | 60 张原创插画，60 题 | 看图听四句描述，作答后看英文原句、画面说明及解析 |
| Part 2 | 200 题 | 分开练首词辨识与问答回应，回应题朗读问题及三个选项 |
| Part 3 / 4 | 92 组，276 道理解题和 92 道听写 | 双人、三人对话和独白，含图表联读、意图题及原文依据 |
| Part 6 / 7 | 76 组、108 篇文稿、286 题 | 单篇、双篇及三篇材料，支持阅读计时、原文定位和同义替换 |

所有学习材料均为本项目原创。难度标签和预估分数用于游戏内调整，界面标注「仅供参考」。本项目与 ETS 无关联。Part 1 为原创场景插画。

首页提供三个任选任务，「练习」可选择主题、题型或语法关卡。「图鉴」保存答对过的词卡及待复习错题。游戏没有出勤要求，离开不会扣经验或退化。

## 学习入口

| 想做什么 | 在哪里操作 |
| --- | --- |
| 承认暂时不会 | 选择题点「不知道」后可以看解析。它计入错题，报告中的「不知道」和普通选错分别统计。 |
| 快速找出生词 | 在「练习 → 单词快筛」查看最多 20 个未学词，左滑不认识、右滑认识，也可用按钮。每 3 次自报认识，立即抽查 1 次。结束后点「练习待学词」学习生词和需要确认的词。 |
| 记录可疑题目 | 答后点「这题有问题」，选原因并可写备注。设置中的问题报告保存在本机，可复制全部记录。 |
| 请 Claude 解释 | 在答后点复制给 Claude 的按钮，再自行粘贴到对话。复制内容包含题目、材料、选项、你的答案、正确答案和解析。 |
| 看懂每个选项 | 答后展开的选项释义列出中日意思、词性和具体对错理由；已有词卡可点开详情。释义包按需下载，读过后可离线看。 |
| 建立自己的词汇复习队列 | 在答后选项旁点「加入我的单词本」，到「练习 → 我的单词本」双向翻卡复习。库外词生成简易卡，按 FSRS 复习；报告显示收藏、掌握及到期数量；词本支持全本搜索和分批显示。 |
| 点读英文 | 答题后点英文旁的小喇叭；词卡详情、方法卡和表达本可随时点读。Part 6 填好所有答案的全文等本篇完成后开放。 |
| 精听一句 | 答后展开「听力原文 · 逐句重听」，点某句即可按对应角色和当前语速播放，也可打开单句循环。 |
| 找到练习起点 | 首页的「水平诊断」含 30 道自适应题，可分次完成。结果提供四项能力起点和本次听读参考区间，可以在报告中查看历次诊断。 |
| 看分数变化 | 能力面板及学习报告分别显示听力、阅读参考估分和区间。独立词卡与快筛只更新词汇学习记录。报告中的听力、阅读与总分趋势用最近 3 个学习日加权平滑，可按 7 天、30 天或全部查看。 |
| 复习到期题 | 「图鉴 → 错题本」可练到期题，也可点单题提前练。非单词错题需要连续答对两次才移出。设置里可选 85%、90% 或 95% 的目标记忆率。 |
| 学解题步骤 | 「练习 → 解题方法」按 Part 浏览 22 张卡并试做例题。普通练习初次遇到相应题型会提示，设置中可关闭。 |

## 中日对照与职场表达本

- **答后翻译：** Part 1–7、单词和听写答完后点「显示翻译」，逐句查看英文、中文和商务日语；表格按行对照。上方「中 / 日 / 中日」会记住选择，默认中日。设置可改为默认展开。模考交卷后在逐题回顾中查看；Part 6 同篇还有未答空位时，完成后的整篇译文暂不展示。
- **精听与学习卡：** 逐句重听列表可单独展开翻译；图鉴词卡与方法卡的英文例句可以随时查看。17 个语法主题和 22 张方法卡均附日语术语。
- **日语词义：** 1124 张词卡详情同时显示中日释义。「设置 → 单词题释义语言」默认混合，中日释义题交替；也可固定中文或日语。「练习 → 单词」可固定「看英文选日语」或「看日语选英文」。快筛抽查和诊断保持既有题型。
- **收藏与复习：** 在答后展开的听力、阅读或词汇译文旁点「收藏」，进入「练习 → 表达本」。可按日语回想英文或按英文回想日语，翻开后自评「不会 / 模糊 / 会了 / 很熟」，用现有 FSRS 安排复习；「报告」显示收藏和掌握数量。练习进度、三语快照及复习时间都随 JSON 备份。
- **日语朗读：** 点日语译文、词义或表达本中的日语即可朗读；表达本另有英／日朗读按钮。默认使用预生成的 Alpha；切到「使用系统语音」后，可在「声音」中选择、试听设备提供的日语音色。
- **纠正译文：** 答后点「这题有问题 → 翻译不自然」，备注具体句子和语言；设置里可以复制全部问题报告，再自行交给审校者。

两种语言各有 7699 条对齐记录，另有 39 个日语术语标签；[术语表](docs/glossary.md)统一 50 项常见表达。首次展开按题库分包下载，首页与首题不请求译文。尚未下载的译文需要先联网打开一次；导出进度会保存收藏句子的三语快照，不会打包整套翻译缓存。[翻译数据格式](docs/I18N_DATA.md)及[审校与验收记录](docs/BILINGUAL_QA.md)供后续维护。

词卡采用 FSRS-6 安排下次复习，按答题结果和有效作答时间自动评级。快筛中只有通过现场抽查的词才获得 Easy 评级。[算法与离线实现](vendor/ts-fsrs/README.md)

## 模拟考试与学习报告

进入「练习 → 模拟考试」。完整卷依次为 6、25、39、30、30、16、54 题，听力、阅读各 100 题。半套依次为 3、12、20、15、15、8、27 题，两部分各 50 题。完整卷阅读限时 75 分钟，半套 38 分钟。可保存离开并继续；听力从未开始的语句接续，进入阅读后可跨题跳转。成绩页显示每 Part 的正确率、每题用时和错题。共听时间在题组内均摊。[TOEIC L&R 官方题型与考试时间](https://www.iibc-global.org/english/toeic/test/lr/about/format.html)

「报告」显示过去 7 天和 30 天的练习量、分 Part 和语法点的正确率，以及不同难度的已掌握词卡（进入长期复习且稳定度至少 7 天）。旧存档没有日期的记录只用于可恢复的累计统计。

## iPhone 声音与安装核对

设置中可切换「Kokoro 预生成音频」与「使用系统语音」。预生成的三个英语声音均为美式，双人对话男女声错开，三人对话各用一个声音；角色配声在同组内保持一致。系统模式的音色、口音和手动说话人设置只控制设备语音，不改变预生成配声。iOS 系统语音设置中下载的音色不保证向网页开放，以游戏实际列出的语音为准。

- 在 Safari 及主屏幕 App 各测试一次首次点击发声、语速、音量和蓝牙耳机。
- 播放双人、三人对话，核对 Heart／Puck／Bella 的角色一致性；播放日语 Alpha，再切系统模式对照。测试 0.75×、1×、1.2× 时的音调与句间停顿。
- 在线等到「离线题库已就绪」，下载一包音频并展开需要的译文，再开飞行模式重启，检查插画、已下载的音频与中日译文。删除音频后确认用量减少，学习进度保留。
- 模考中途锁屏再回来，点「继续考试」确认语句接续、阅读剩余时间和答案。设备上保存最近一套成绩，换设备前可导出 JSON。

## 保存与换设备

答题后立即写入本地存档，题目索引、答后反馈、能力、错题、词卡、计时与设置都随存档保存。游戏尝试申请浏览器持久化存储，授权结果取决于系统。清除网站数据、卸载应用或换浏览器前，可先备份。

在原设备打开「设置 → 导出进度」，保存 JSON 文件。在新设备打开游戏，选择「设置 → 导入进度」，选取该文件，核对伙伴和经验后点「恢复备份」。游戏会先验证文件，无效文件不会覆盖现有进度。建议从同一主屏幕图标继续游戏。如 Safari 和主屏幕版本呈现不同存档，可用此方式迁移。

## 本地运行

使用任意静态 HTTP 服务打开仓库根目录即可。站点使用原生 HTML、CSS、JavaScript ES modules 和 JSON，没有安装依赖和构建环节。

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

浏览器打开 `http://localhost:8000/`。本地文件协议无法正常加载 ES modules。Service Worker 需要 HTTPS 或 localhost；用 iPhone 真机验证离线安装时，可直接访问上方的 Pages 网址。

校验题库、翻译和选项释义（推荐 Node.js 22.7 或更高版本）：

```sh
node scripts/validate.mjs
```

## 自动化回归

从仓库根目录运行。应用不依赖 Node；Playwright 仅用于开发测试。

~~~sh
node scripts/validate.mjs
node scripts/validate-options.mjs
node scripts/validate-bank-audio.mjs
node scripts/build-review-queue.mjs --check
node tests/voices.mjs
node tests/saves.mjs
node tests/forms.mjs
node --test tests/*.test.mjs
node tests/diagnosis-logic.mjs
node tests/prediction-logic.mjs
node scripts/simulate-prediction.mjs
node tests/v6/replay-logic.mjs
node tests/v6/methods-logic.mjs
npm install --prefix /tmp/island-browser-test playwright
/tmp/island-browser-test/node_modules/.bin/playwright install chromium
NODE_PATH=/tmp/island-browser-test/node_modules node tests/audio.cjs
NODE_PATH=/tmp/island-browser-test/node_modules node tests/audio-app.cjs
NODE_PATH=/tmp/island-browser-test/node_modules node tests/audio-metadata.cjs
NODE_PATH=/tmp/island-browser-test/node_modules node tests/audio-review.cjs
NODE_PATH=/tmp/island-browser-test/node_modules node tests/audio-review-live.cjs
NODE_PATH=/tmp/island-browser-test/node_modules PW_ENGINE=chromium node tests/audio-cache-usage.cjs
NODE_PATH=/tmp/island-browser-test/node_modules node tests/e2e.cjs
NODE_PATH=/tmp/island-browser-test/node_modules node tests/v6.cjs
NODE_PATH=/tmp/island-browser-test/node_modules node tests/shell-update.cjs
NODE_PATH=/tmp/island-browser-test/node_modules node tests/i18n-offline.cjs
NODE_PATH=/tmp/island-browser-test/node_modules node tests/options-offline.cjs
NODE_PATH=/tmp/island-browser-test/node_modules node tests/humor-offline.cjs
NODE_PATH=/tmp/island-browser-test/node_modules node tests/performance.cjs
~~~

也可安装 Playwright WebKit，并用下面的命令显式选择它运行音频及离线回归；`PW_CHANNEL` 仅对 Chromium 生效：

~~~sh
/tmp/island-browser-test/node_modules/.bin/playwright install webkit
NODE_PATH=/tmp/island-browser-test/node_modules PW_ENGINE=webkit node tests/audio.cjs
NODE_PATH=/tmp/island-browser-test/node_modules PW_ENGINE=webkit node tests/audio-app.cjs
NODE_PATH=/tmp/island-browser-test/node_modules PW_ENGINE=webkit node tests/audio-metadata.cjs
NODE_PATH=/tmp/island-browser-test/node_modules PW_ENGINE=webkit node tests/audio-review.cjs
NODE_PATH=/tmp/island-browser-test/node_modules PW_ENGINE=webkit node tests/audio-review-live.cjs
NODE_PATH=/tmp/island-browser-test/node_modules PW_ENGINE=webkit node tests/audio-cache-usage.cjs
NODE_PATH=/tmp/island-browser-test/node_modules PW_ENGINE=webkit node tests/v6.cjs
NODE_PATH=/tmp/island-browser-test/node_modules PW_ENGINE=webkit node tests/options-offline.cjs
~~~

`v6.cjs` 的 WebKit 场景使用各自独立的临时持久 profile，并在测试结束后删除。当前 WebKit 的非持久上下文会在最后一个 CacheStorage 连接随页面重载关闭时清空缓存；独立持久 profile 保留了普通 Safari 的跨导航存储行为，不需要修改生产缓存代码或放宽断言。

WebKit 的离线回归通过关闭本地 HTTP 服务器模拟网络中断，保留原缓存、冷重开和字节范围断言。当前测试引擎的 `setOffline(true)` 连独立 Service Worker 的固定响应也会阻断，因此不能用它判定离线功能。自动化结果仍需在真实 iPhone 上用飞行模式复核。 快筛手势在 Chromium 使用原生触摸输入，在 WebKit 使用可信指针拖动覆盖同一捕获逻辑；真实手指滑动仍列入 iPhone 手测。

已有 Chrome 可给浏览器测试命令加 `PW_CHANNEL=chrome`。运行 `node tests/v6.cjs screen fsrs` 可单独检查快筛和复习；统一入口会在每个功能的 375、390、430px 三档各建独立上下文。脚本启动临时本地 HTTP 服务，模拟 iPhone 并使用可控语音事件。模考测试实际开始、回答、退出、恢复和交卷，并用测试存档推进到听力末段及阅读到期点。音频专门回归还测试真实 M4A 播放、速度、系统后备、按需下载、取消与删除、离线分段播放，以及模考下载后开始／中断／恢复／交卷。真实 iPhone 的首次点击和音响效果需另行试听。[播放、缓存与点读说明](docs/AUDIO-PLAYBACK.md)

中日功能回归包含答前隐藏、答后显示、三语言切换、模考隔离、日语题型、收藏及备份、FSRS、日语点击朗读、术语标签和翻译问题报告。`tests/i18n-offline.cjs` 另启真实 Service Worker，检查离线冷启动与升级保留翻译缓存。`tests/performance.cjs` 用 2 Mbps / 80 ms 网络、5 次冷启动记录首页及首题中位数。最新答案与日语修订见 [修正记录](docs/ANSWER-JA-CORRECTIONS.md)。选项释义结构及个人词卡备份契约见 [选项释义维护说明](docs/OPTION-DETAILS.md)。详细结果见 [双语测试与性能](docs/BILINGUAL-CHECKS.md)，翻译修订与后续复核项见 [双语自查](docs/BILINGUAL_QA.md)。

估分模拟与测试输出见 [估分修正验收](docs/PREDICTION-CHECKS.md)。

v6 首次发布的校验输出、三宽回归和同档估分对照见 [v6 验收记录](docs/V6-CHECKS.md)。

上一版各难度题量、测试输出和加载速度见 [定版验收](docs/RELEASE-CHECKS.md)。复审说明和逐字段前后对照见 [按 ID 的复审清单](docs/CONTENT-REVIEW.md) 与 [CSV 明细](docs/review-detail.csv)。

## 发布到 GitHub Pages

仓库使用 `main` 分支的根目录。站点资源使用相对路径，支持 `/toeic-game/` 子路径。`.nojekyll` 让 Pages 直接发布静态文件。

首次部署，在具备仓库 Pages 管理权限的 gh 会话中执行：

```sh
gh api repos/congruiwei/toeic-game/pages --method POST \
  -f 'source[branch]=main' -f 'source[path]=/'
```

已有 Pages 站点若要更改来源，将上面的 `POST` 改为 `PUT`。也可在 GitHub 的 Settings → Pages 选择 Deploy from a branch → main → /(root)。

后续发布先运行题库校验，提交变更并推送到 `origin main`。向既有 JSON 文件追加题目时只需修改 JSON：下次联网打开时会拉取更新并缓存，离线时回退到上次已下载的题库。修改 JS、CSS、HTML 或改变数据格式时，更新 `sw.js` 的缓存版本；新增运行时文件也要列入离线清单。

```sh
git push origin main
gh api repos/congruiwei/toeic-game/pages --jq '{status, html_url, source}'
gh api repos/congruiwei/toeic-game/pages/builds/latest --jq '{status, commit, error}'
```

从较早版本首次迁入 v6 时，若仍看到旧首页，请保持联网，待下载完成后关闭所有旧标签页和主屏幕窗口，再开一次。v6 后续更新可在联网冷启动、尚未交互的首页接管。正在练习或计时的窗口会继续原题。存档键独立于缓存版本。[GitHub Pages 发布来源说明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

文件结构、六种题库格式、加题示例、存档契约和进化算法见 [开发交接文档](docs/ARCHITECTURE.md)。
