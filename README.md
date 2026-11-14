# 芽语岛 · TOEIC 学习养成

[打开游戏](https://congruiwei.github.io/toeic-game/)

用几道商务英语练习培育一只住在浮岛上的芽团。单词、语法、听力和阅读分别积累经验，共同解锁六个形态。练习可以随时离开，回到小岛后点「继续学习」即可从上次的位置继续。

## 在 iPhone 上安装

1. 用 Safari 打开游戏，首次打开时保持联网，在设置看到「离线题库已就绪」。
2. 轻点「分享」。部分 Safari 布局先点「更多」，再选「分享」。
3. 选择「添加到主屏幕」。如有「作为网页 App 打开」选项，将它打开，然后点「添加」。
4. 从主屏幕图标打开游戏。在设置里点「测试声音」。普通练习点「点击开始」，可以重听；模考听力由一次点击启动，随后连续播放。

页面和题库可以离线使用。朗读使用设备提供的英语语音，部分语音需要联网或预先下载。不同 iOS 版本和语音包提供的口音不同。[Apple 主屏幕网页 App 指南](https://support.apple.com/zh-cn/guide/iphone/iphea86e5236/ios)

## 游戏内容

| 练习 | 题库规模 | 玩法 |
| --- | --- | --- |
| 单词 | 1087 张词卡，1026 个独立词头，44 个多义词 | 中英互选、听音辨词、例句填空、同义替换。答对收集词卡，按间隔复习 |
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
| 精听一句 | 答后展开「听力原文 · 逐句重听」，点某句即可按对应角色和当前语速播放，也可打开单句循环。 |
| 找到练习起点 | 首页的「水平诊断」含 30 道自适应题，可分次完成。结果提供四项能力起点和本次听读参考区间，可以在报告中查看历次诊断。 |
| 看分数变化 | 能力面板及学习报告分别显示听力、阅读参考估分和区间。独立词卡与快筛只更新词汇学习记录。报告中的听力、阅读与总分趋势用最近 3 个学习日加权平滑，可按 7 天、30 天或全部查看。 |
| 复习到期题 | 「图鉴 → 错题本」可练到期题，也可点单题提前练。非单词错题需要连续答对两次才移出。设置里可选 85%、90% 或 95% 的目标记忆率。 |
| 学解题步骤 | 「练习 → 解题方法」按 Part 浏览 22 张卡并试做例题。普通练习初次遇到相应题型会提示，设置中可关闭。 |

词卡采用 FSRS-6 安排下次复习，按答题结果和有效作答时间自动评级。快筛中只有通过现场抽查的词才获得 Easy 评级。[算法与离线实现](vendor/ts-fsrs/README.md)

## 模拟考试与学习报告

进入「练习 → 模拟考试」。完整卷依次为 6、25、39、30、30、16、54 题，听力、阅读各 100 题。半套依次为 3、12、20、15、15、8、27 题，两部分各 50 题。完整卷阅读限时 75 分钟，半套 38 分钟。可保存离开并继续；听力从未开始的语句接续，进入阅读后可跨题跳转。成绩页显示每 Part 的正确率、每题用时和错题。共听时间在题组内均摊。[TOEIC L&R 官方题型与考试时间](https://www.iibc-global.org/english/toeic/test/lr/about/format.html)

「报告」显示过去 7 天和 30 天的练习量、分 Part 和语法点的正确率，以及不同难度的已掌握词卡（进入长期复习且稳定度至少 7 天）。旧存档没有日期的记录只用于可恢复的累计统计。

## iPhone 声音与安装核对

在系统「设置 → 辅助功能 → 朗读内容」（部分系统为「阅读与朗读」）中进入「声音 → 英语」，下载带「增强」或「高级」的音色，回到游戏设置试听。可分别指定说话人 1、2、3，或让游戏在可用地区语音间轮换。[Apple 语音设置说明](https://support.apple.com/en-ie/guide/iphone/iph96b214f0/ios)

- 在 Safari 及主屏幕 App 各测试一次首次点击发声、语速、音量和蓝牙耳机。
- 试听下载前后的音色列表，以三人对话检查角色一致性、美英澳加口音与系统实际发音。
- 在线等到「离线题库已就绪」后打开飞行模式，重新启动，检查插画和已安装的本地语音。
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

校验题库（推荐 Node.js 22.7 或更高版本）：

```sh
node scripts/validate.mjs
```

## 自动化回归

从仓库根目录运行。应用不依赖 Node；Playwright 仅用于开发测试。

~~~sh
node scripts/validate.mjs
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
NODE_PATH=/tmp/island-browser-test/node_modules node tests/e2e.cjs
NODE_PATH=/tmp/island-browser-test/node_modules node tests/v6.cjs
NODE_PATH=/tmp/island-browser-test/node_modules node tests/shell-update.cjs
~~~

已有 Chrome 可给浏览器测试命令加 `PW_CHANNEL=chrome`。运行 `node tests/v6.cjs screen fsrs` 可单独检查快筛和复习；统一入口会在每个功能的 375、390、430px 三档各建独立上下文。脚本启动临时本地 HTTP 服务，模拟 iPhone 并使用可控语音事件。模考测试实际开始、回答、退出、恢复和交卷，并用测试存档推进到听力末段及阅读到期点。真实设备的系统音色与音响效果需另行试听。

本轮的模拟与测试输出见 [估分修正验收](docs/PREDICTION-CHECKS.md)。

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
