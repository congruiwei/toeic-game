# 音频复听

[打开复听页](https://congruiwei.github.io/toeic-game/audio-review.html)。这里收集经过识别复核后，仍需人耳判断的**可播放录音**。自动转写只是线索：姓名、同音词和拼写差异未必是发音错误；也不能因为转写正确，就保证实际听感没有问题。

## 使用方法

1. 先听英语 Part 1，再听 Part 2、对话与独白／听写、语法、单词、阅读，日语最后。可以用题号、原文或转写搜索整个队列。
2. 每条显示原文和当前转写；同一录音的 Turbo 与完整 large-v3 转写不同时，会分别列出。点「0.75× 重听」或「1× 重听」，可反复比较；切换条目会先停止上一段，底部也有停止按钮。
3. 选择「没问题」「有问题」或「听不出来」，需要时填写备注。没有把握就选「听不出来」，不必强行下结论。
4. 点「复制我的复核记录」，再自行粘贴到需要的地方。复制权限不可用时，会显示已全选的文本框；页面不会自动发送记录。

列表每次显示 50 条，再点按钮继续显示。筛选可切换「尚未判断」「我的记录」「全部条目」；搜索匹配整个队列。已改用设备日语声音的条目属于已处理结果，只单独显示数量，不要求用户判断已经下架、无法播放的旧录音。

## 保存与离线

复听记录使用独立 localStorage 键 `toeic-island.audio-review.v1`，不读取或覆盖游戏存档。每条判断同时绑定 token 和音频的 SHA-256；同题换了录音后，不会沿用旧结论。旧记录仍保留，导出时注明不再属于当前版本。损坏的旧记录不会被静默覆盖；存储失败会显示提示，此时可复制当前页面中的记录。

清除网站数据会清除本机记录。复听记录不包含在游戏的进度备份里；需要保存到别处时，请先复制导出。

首次打开按需下载清单，只有通过结构校验的清单才写入专用缓存 `toeic-island.audio-review.queue.v1`。断网、错误页面或坏 JSON 不会覆盖好清单。已通过游戏 Service Worker 访问过的复听页面可离线重开；首次直接访问、尚未受游戏 Service Worker 控制时，仍需要网络加载页面。

**缓存清单不等于下载录音。** 页面不会预载整套媒体；点击时才播放。离线播放依赖已缓存的对应录音，未下载的录音仍需网络。iPhone Safari 与主屏幕 App 的首次发声、蓝牙音量和飞行模式应在真机复核。

## 清单生成与契约

`data/audio/review-queue.json` 是最终质量记录的派生文件，格式如下：

```js
{
  version: 1,
  sourceSha256: '当前源清单的 SHA-256',
  systemFallbackCount: 0,
  entries: [{
    token: 'en:part2:题号/options/0/0',
    language: 'en', bank: 'part2', key: '题号/options/0/0',
    text: '英文或日文原文', recognized: '当前媒体的真实识别转写',
    recognitionModel: 'whisper-large-v3-turbo', // 或 whisper-large-v3，取自当前实际 audit
    // 可选：同一当前媒体的完整模型实际转写，与 Turbo 原样文本不同才添加。
    fullRecognition: {model: 'whisper-large-v3', recognized: '完整模型的真实转写'},
    src: './audio/generated/en/af_heart/内容地址.m4a',
    sha256: '该媒体的 SHA-256', priority: 1,
    reason: '复听提示，不预先替用户判断'
  }]
}
```

`build-review-queue.mjs` 先运行完整音频覆盖和证据校验，再读取当前 manifest、pack 和质量记录。它只接纳 `unresolvedItems` 中当前存在的录音，并再次检查 src、text、spoken、language 和媒体绑定。已处理的系统后备不进入 entries；缺失转写、重复 token、过期绑定或不完整证据会终止生成。排序和输出是确定的，`--check` 会对比整个派生文件。

当前转写的模型标签来自当前 SHA 绑定的真实 audit：新录音直接由完整 large-v3 识别时，显示「完整 large-v3 识别」，不会误标为 Turbo。

若当前条目的 `crossModelChecks` 有同一媒体的完整 large-v3 实际结果，生成器核对 token、媒体 SHA、完整 sourceClip、原 Turbo 文本、模型身份和实际分段。两份文本不同时，页面分别显示「Turbo 识别」和「完整 large-v3 识别」，搜索与复制导出同时包含两份；相同文本不重复显示。旧音频 SHA 的检查不会沿用。页面展示识别线索，不把任何模型的转写当作人工听感结论，也不根据这些文字自行更改判断。

```sh
node scripts/validate-bank-audio.mjs
node scripts/build-review-queue.mjs
node scripts/build-review-queue.mjs --check
node --test tests/audio-review-queue.test.mjs tests/audio-review-routing.test.mjs
```

不要手动编辑复听队列来掩盖差异；应先完成原始证据或录音的修正，再生成清单。页面加载的清单仅是人工复听入口，不会改变题库答案、音频质量账本或游戏进度。

Service Worker 仅把复听 HTML、CSS、JS 作为访问时缓存的可选页面；清单不加入首页预缓存。清单的验证写入由页面持有，Service Worker 对音频元数据保持网络／已有缓存后备，避免 HTML 错误页覆盖好数据。页面将写入串行化，旧请求不能在新清单写入之后覆盖缓存。

## 浏览器回归

```sh
NODE_PATH=/path/to/playwright/node_modules PW_CHANNEL=chrome node tests/audio-review.cjs
NODE_PATH=/path/to/playwright/node_modules PW_CHANNEL=chrome node tests/audio-review-live.cjs
NODE_PATH=/path/to/playwright/node_modules PW_ENGINE=webkit node tests/audio-review.cjs
NODE_PATH=/path/to/playwright/node_modules PW_ENGINE=webkit node tests/audio-review-live.cjs
```

测试用固定的小清单与可控播放器覆盖 375、390 深色、430px、按需加载、单播放器、语速、错误恢复、标签与备注、组合输入、全本搜索、50条增量、刷新恢复、换 SHA 隔离、损坏记录保护、复制后备和清单缓存。离线场景实际关闭 HTTP 服务器，再重新打开页面；只缓存页面壳的测试 SW 不提供清单，因此必须从页面验证后的缓存恢复。

WebKit 使用各场景独立的临时持久 profile，结束后删除，保留普通 Safari 的跨导航存储行为。录音播放状态在该 UI 套件中受控，实际合成音质与 iPhone 发声仍须人耳和真机验证。

`audio-review-live.cjs` 另用真实最终清单、生产 Service Worker 和原生 M4A 播放器：验证项目子路径导航、首开零录音下载、点击一条后缓存、断网冷重开及同一录音离线播放。它使用独立浏览器 profile，下载的媒体只存在临时测试 profile，不影响日常存档。
