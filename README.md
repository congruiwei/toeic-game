# 芽语岛 · TOEIC 学习养成

[打开游戏](https://congruiwei.github.io/toeic-game/)

用几道商务英语练习培育一只住在浮岛上的芽团。单词、语法、听力和阅读分别积累经验，共同解锁六个形态。练习可以随时离开，回到小岛后点「继续学习」即可从上次的位置继续。

## 在 iPhone 上安装

1. 用 Safari 打开游戏，首次打开时保持联网，在设置看到「离线题库已就绪」。
2. 轻点「分享」。部分 Safari 布局先点「更多」，再选「分享」。
3. 选择「添加到主屏幕」。如有「作为网页 App 打开」选项，将它打开，然后点「添加」。
4. 从主屏幕图标打开游戏。在设置里点「测试声音」。正式听题时点「点击开始」，可随时重听。

页面和题库可以离线使用。朗读使用设备提供的英语语音，部分语音需要联网或预先下载。不同 iOS 版本和语音包提供的口音不同。[Apple 主屏幕网页 App 指南](https://support.apple.com/zh-cn/guide/iphone/iphea86e5236/ios)

## 游戏内容

| 练习 | 题库规模 | 玩法 |
| --- | --- | --- |
| 单词 | 1000 个词，17 个主题 | 中英互选、听音辨词、例句填空、同义替换。答对收集词卡，按间隔复习 |
| 语法 | 240 道语法题、100 道词汇题 | 先浏览时间轴或结构图，再完成 Part 5 填空并查看英中解析 |
| Part 2 | 200 题 | 分开练首词辨识与问答回应，回应题朗读问题及三个选项 |
| Part 3 / 4 | 60 组，180 道理解题和 60 道听写 | 双人、三人对话和独白，含图表联读、意图题及原文依据 |
| Part 6 / 7 | 60 组、80 篇文稿、224 题 | 单篇、双篇及三篇材料，支持阅读计时、原文定位和同义替换 |

所有学习材料均为本项目原创。难度标签和预估分数用于游戏内调整，界面标注「仅供参考」。本项目与 ETS 无关联。首版未收录 Part 1 图片题。

首页提供三个任选任务，「练习」可选择主题、题型或语法关卡。「图鉴」保存答对过的词卡及待复习错题。游戏没有出勤要求，离开不会扣经验或退化。

## 保存与换设备

答题后立即写入本地存档，题目索引、答后反馈、能力、错题、词卡、计时与设置都随存档保存。游戏尝试申请浏览器持久化存储，授权结果取决于系统。清除网站数据、卸载应用或换浏览器前，可先备份。

在原设备打开「设置 → 导出进度」，保存 JSON 文件。在新设备打开游戏，选择「设置 → 导入进度」，选取该文件，核对伙伴和经验后点「恢复备份」。游戏会先验证文件，无效文件不会覆盖现有进度。建议从同一主屏幕图标继续游戏。如 Safari 和主屏幕版本呈现不同存档，可用此方式迁移。

## 本地运行

使用任意静态 HTTP 服务打开仓库根目录即可。站点使用原生 HTML、CSS、JavaScript ES modules 和 JSON，没有安装依赖和构建环节。

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

浏览器打开 `http://localhost:8000/`。本地文件协议无法正常加载 ES modules。Service Worker 需要 HTTPS 或 localhost；用 iPhone 真机验证离线安装时，可直接访问上方的 Pages 网址。

校验题库（Node.js 18+，验证脚本使用内置模块）：

```sh
node scripts/validate.mjs
```

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

旧页面仍打开时，浏览器会等待它关闭后切换到新版离线包。请关闭所有游戏标签页和主屏幕窗口，再重新打开。存档键独立于缓存版本。[GitHub Pages 发布来源说明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

文件结构、五种题库格式、加题示例、存档契约和进化算法见 [开发交接文档](docs/ARCHITECTURE.md)。
