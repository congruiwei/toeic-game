# 音频播放与英文点读

本文说明主游戏的录音播放、系统语音后备、离线下载和点读接线。独立试听页为 `audition.html`；它的候选收藏仅用于选择声音，不修改主游戏存档。

## 声音与设置

- 默认 `settings.audioMode = 'recorded'`：优先播放同源预生成 M4A 文件，英语采用 `af_heart`、`am_puck`、`af_bella`，日语采用 `jf_alpha`。三种英语声均为美式；场景和说话人的配音由生成清单决定，客户端不随机换声。
- `settings.audioMode = 'system'`：使用浏览器 `speechSynthesis`。英语口音、A/B/C 声音槽和日语声音设置只影响系统语音；它们不改变录音文件的配音。
- `settings.rate` 为 0.75–1.2。文件播放设置 `playbackRate` 并开启 `preservesPitch`，Web Speech 设置 `utterance.rate`。
- `settings.audioGapMs` 是播放器内部的句间／循环间隔参数，默认 200 ms，实际播放限制在 0–1500 ms；当前设置界面提供速度控件，未提供独立间隔控件。系统模式在点击时同步排入整段语音，其句间停顿由系统语音引擎决定。
- 设置中的逐声试听强制使用所选系统声音，方便确认网页实际可见的声音。操作系统已下载的 Siri、增强或高级声音不一定会出现在网页的 `getVoices()` 中。

声音选择不依赖付费在线语音 API。文件播放走普通静态资源请求；无对应文件时才尝试设备语音。

## 文件与职责

| 文件 | 职责 |
| --- | --- |
| `js/recorded-audio.js` | 懒加载清单、按源键／文本／场景解析录音、共享 HTMLAudio、连续播放、取消与高亮回调 |
| `js/audio.js` | 保持英语 `speak`／`hush` 接口，选择录音或系统后备；游戏音效也在此文件 |
| `js/japanese-audio.js` | 同一播放通道上的日语文件播放和设备语音后备 |
| `js/audio-downloads.js` | 分包下载、模考精确预缓存、完整文件校验、用量统计、删除 |
| `js/audio-settings.js` | 设置内下载分组、进度、取消和删除界面 |
| `js/readable.js` | 输出带安全转义的英文文本与独立点读按钮 |
| `js/read-aloud.js` | 点读切换与高亮；不自行注册全局点击事件或决定学习权限 |
| `js/replay.js` | 答后听力逐句重听与循环，保留源键和说话人 |
| `js/exam-controller.js` | 模考准备、用户点击开始、播放检查点与保存离开 |
| `sw.js` | 音频文件独立缓存、离线 Range 响应与元数据缓存 |

`recorded-audio.js` 不导入题库、翻译源或 `replay.js`，避免题库／翻译源间循环依赖。只有 `audio-downloads.js` 的模考准备使用 `exam.js` 的 `listeningScript`。

## 清单与按需加载

入口 `data/audio/manifest.json` 是小索引，`packs` 为数组，按 `bank` 和 `language` 指向独立 JSON 包：

```js
{
  version: 1,
  sourceSha256: '源数据指纹',
  complete: false,
  packs: [{
    bank: 'listening', language: 'en',
    src: './data/audio/en/listening.json',
    count: 123, bytes: 45678, sha256: '包文件 SHA-256',
    complete: false, requiredComplete: true,
    audioBytes: 123456, duration: 456.7
  }]
}
```

上面只演示字段，数值不代表实际发布量。`complete` 表示全部源键完整，`requiredComplete` 表示本包必需范围完整，不能用后者冒充前者。播放器可以使用包内已存在的有效文件；整包下载要求 `complete` 或 `requiredComplete` 为真。

包内为 `{version, bank, language, sourceSha256, clips}`。每个 `clips[sourceKey]` 至少包含 `src, text, language, voiceId, duration, bytes, sha256`，听力另有 `speaker`。路径必须位于本站 `audio/generated/` 且为 `.m4a`。文件以内容指纹命名；不要用同一 URL 覆盖不同音频。

进入练习／诊断、词库或方法页时，`prepareVisibleAudio()` 后台加载当前英语分类的元数据，不下载整库录音，也不阻塞第一题。英语听力同时准备 `labels` 包，以便给 Part 1/2 的选项加 A/B/C/D 读音。日语首次播放会主动加载对应日语包，不要求用户先去下载设置。

包下载时校验索引声明的字节数、SHA-256、语言／分类以及 `sourceSha256`；缓存后备也经过同样校验，防止跨版本包混用。索引和已载入包在当前页面内复用。

## 播放接口与首次点击

```js
speak([{ text, speaker: 'B', key, bank: 'listening' }], settings, notify, {
  seed: groupId,
  onStart, onEnd, onCancel,
  onSegment, onSegmentEnd
});

speakJapanese(text, settings, notify, { key, bank, seed });
hush(); // 同时停止文件、系统语音和待完成播放请求
```

`turn.keys` 可以表示一个显示段落对应的多句源键。解析器先尝试精确键，并比较清单文本与当前文字；不一致时不会把旧录音当成新句播放。没有可用键时按规范化文本匹配。听力对话还限定场景和说话人，避免同一句话被错误配给另一角色；动态词汇选项可复用已加载的同词词头录音。听写从原对话继承源键及说话人。

英语和日语系统语音同样忽略正文的 `[1]`–`[4]` 插入位置标记；纯标记片段直接完成而不创建空 `SpeechSynthesisUtterance`，日期、金额、型号、其他数字及显示原文保持不变。

iOS 的首次播放必须由用户动作触发。现实现分两条路径：

1. 元数据已准备：在点击调用栈中直接 `audio.play()` 或 `speechSynthesis.speak()`。
2. 元数据尚未准备：先在点击中对共享 HTMLAudio 播放本地短静音以解锁，再异步取包，确认播放请求仍有效后开始对应文件。期间离开页面、换声或再次点击会使旧请求失效，下载完成后不会突然补播。

若首次异步取包后仍找不到录音，不假定 iOS 还保留系统语音授权；界面提示“请再点一次使用设备语音”。下一次点击同步尝试系统语音。元数据失败有短期重试冷却，避免离线时每次点击都重复等待下载。已有文件播放失败也会尝试系统后备；设备不允许异步后备启动时显示再次点击提示。浏览器模拟测试不能代替每个 iOS 版本的真实声音可用性检查。

同一时刻只有一个共享文件播放器。`hush()` 也取消系统语音；播放序号与分句序号共同隔离旧回调，重复 `ended`、旧资源排队事件和迟来的网络响应都不能推进新段落。连续文件按间隔依次播放，循环逐句重听遵守相同间隔。`onSegment`／`onSegmentEnd` 驱动当前句高亮，取消和错误会清除高亮及按钮状态。

## 缓存、下载和删除

首页安装不会预缓存全库音频。设置按听力、单词、阅读、日语分组主动下载；方法卡英文点读如无对应文件则使用设备语音；正常文件播放也由 Service Worker 按需缓存。

```js
downloadAudioPack(bank, language, { signal, onProgress });
precacheAudio([{ key, bank, language }], { signal, onProgress });
audioCacheUsage();       // { bytes, files }
deleteAudioCache();      // 删除文件，保留小元数据与学习存档
```

进度为 `{status, done, total, bytes, totalBytes}`，按唯一文件 URL 去重。每次只下载一个完整文件，限制手机内存占用；已缓存文件仍验证字节数、SHA-256 和 M4A `ftyp` 标记。拒绝 HTML 错误页、206 残片和指纹不符文件。空间不足返回 `AUDIO_QUOTA`；取消或失败保留已完成文件，再下载会验证并跳过这些文件。

- 文件缓存：`toeic-island-audio-v1`。
- 小清单缓存：`toeic-island-audio-meta-v1`，联网优先，失败时使用有效缓存。
- 下载删除不修改 XP、词卡、SRS、答题记录或翻译；JSON 进度备份不含音频。换设备后重新下载音频。
- 删除会中止设置中运行的下载，并通知 worker `audio-cache-cleared`。页面和 worker 均使用代号隔离删除前的请求，避免它们在删除完成后重新填入旧文件。
- 空间统计精确读取响应正文，最多4个并发；设置页独立加载清单，不等扫描完成。统计支持取消，删除前后的代号变化会使旧扫描失效并重开当前缓存，避免旧容量覆盖删除结果。
- iOS 可能清理站点缓存；“已下载”不代表永久保存。缺失文件需要重新下载，或在设备支持时使用系统语音。

Safari 常以 `Range` 请求探测、拖动音频。worker 缓存完整 200 响应，再从完整字节合成 206（含 `Content-Range`、`Content-Length`、`Accept-Ranges`）；越界／非法范围返回 416。不会把第一次得到的局部响应当作完整离线文件。正常按需播放在 worker 层检查文件标记，显式下载还会核对清单 SHA-256。

## 模考准备和恢复

录音模式开始／继续听力时，`prepareExamAudio(exam, catalog, options)` 使用与正式播放相同的 `listeningScript` 和解析器，缓存本套听力实际需要的句子、问题和选项字母。缺少任一步录音会中止准备并提示重试或手动改系统模式，不会静默带着不完整录音开考。

准备界面显示进度，可取消；完成后显示“点击开始听力”，下载结束不会自动开播。此按钮保留新的用户手势。系统模式直接开始，不要求录音缓存；阅读阶段恢复也不下载听力。

听力在一句首次实际开始时保存检查点。保存离开／切后台停止声音，继续时跳过已经开始的那一句。`noFallbackAfterStart` 防止一句录音中途失败后又用系统语音从头重播；失败时保存到最近播放位置并退出连续播放。准备进度是临时界面状态，不改试卷题目／成绩格式。

`exam.step` 保留原来的对话回合／问题位置；可选的 `exam.sentence` 记录该回合中下一句的位置，最后一句开始后才推进 `step` 并把 `sentence` 归零。旧档缺少此字段时按 0 读取，不重播旧档已经跳过的回合，也不需要提高主存档版本。句子尚未实际开始就失败时，位置保持不变。`exam.wait` 继续保存句间停顿和原有的 5500 ms 答题等待；切换到系统语音后仍从同一句继续。`tests/exam-sentence-resume.test.mjs` 直接覆盖控制器、导出／导入校验及这两种播放方式。

交卷前没有自由点读或翻译入口；交卷后完整回顾提供英文选项／解析／文章点读和听力逐句重听。读取回顾不重新计分，不修改归档答案或既有成绩。

## 点读权限与源文本

`readable()` 把学习英文放在独立 `[lang=en]` 子节点内，朗读按钮用中文语言标记。不要从包含按钮的父元素 `textContent` 回收英文，否则“朗读”会污染翻译源或收藏文本。播放文字放在 `data-text`，源键、分类、场景分别放在 `data-key`、`data-bank`、`data-seed`；所有属性必须转义。

`playReadAloud(button, settings, notify)` 播放或再次点击停止，给最近的 `[data-read-text]` 加 `is-reading` 并维护 `aria-pressed`。`mountReadAloud()` 仅处理显式标记的容器，不往按钮、选项或隐藏区域嵌套交互控件。全局路由仍由 `app.js` 负责，并再次核对当前答题／模考状态。

- 普通练习答题前保留原题型的必要听力入口，隐藏答案、译文、解析和新增点读按钮；答后才开放相应内容。
- Part 6 若本轮同组还有未答空格，文章继续保留空白，整篇填好答案的点读及翻译延后；当前已答题的解析仍可查看。同组在本轮全部答完后才生成完整原文。
- 词库、方法卡等独立学习卡可直接点读；表达本仍遵循翻面前只显示当前面的规则。
- 隐藏区域、关闭的折叠区和未完成模考的点读动作还受 app 事件层校验。不要只靠 CSS 隐藏答案保护内容。

## 测试与交接

无构建步骤。逻辑测试直接使用 Node：

```sh
node --test tests/recorded-audio.test.mjs tests/japanese-voices.test.mjs tests/voices.mjs
```

浏览器测试需要可加载的 Playwright 与浏览器；可用 `NODE_PATH` 指定其安装目录。默认引擎为 Chromium，`PW_CHANNEL=chrome` 可指定本机 Chrome。各脚本自行启动临时静态服务器，建议串行执行：

```sh
node tests/audio.cjs
node tests/audio-app.cjs
node tests/audio-metadata.cjs
node tests/i18n-offline.cjs
node tests/shell-update.cjs
node tests/audition.cjs
```

音频契约、应用联动和清单缓存脚本也支持 `PW_ENGINE=webkit`。使用同一份 Playwright 安装提供的 CLI 安装 WebKit 后运行（`PW_CHANNEL` 只传给 Chromium）：

```sh
/tmp/island-browser-test/node_modules/.bin/playwright install webkit
NODE_PATH=/tmp/island-browser-test/node_modules PW_ENGINE=webkit node tests/audio.cjs
NODE_PATH=/tmp/island-browser-test/node_modules PW_ENGINE=webkit node tests/audio-app.cjs
NODE_PATH=/tmp/island-browser-test/node_modules PW_ENGINE=webkit node tests/audio-metadata.cjs
NODE_PATH=/tmp/island-browser-test/node_modules PW_ENGINE=webkit node tests/v6.cjs
```

`v6.cjs` 的 WebKit 场景使用各自独立的临时持久 profile，并在测试结束后删除。当前 WebKit 的非持久上下文会在最后一个 CacheStorage 连接随页面重载关闭时清空缓存；独立持久 profile 保留了普通 Safari 的跨导航存储行为，不需要修改生产缓存代码或放宽断言。

WebKit 离线场景会关闭本地 HTTP 服务器，直接验证网络中断时的缓存读取、冷重开和 Range 206／416。当前 Playwright WebKit 的 `setOffline(true)` 会连独立 Service Worker 固定返回的响应也一起阻断；这是已用最小页面隔离的测试模拟限制。测试仍保留所有离线断言，Chromium 继续使用原断网开关。真实 iPhone 的 Safari 和主屏幕模式还需用飞行模式手动验收。

`audio.cjs` 覆盖共享播放／冷点击／取消、文件校验、缓存配额、原生 M4A、离线重开与 Range；`audio-app.cjs` 覆盖首次无存档快筛在词库慢请求期间的点击解锁、真实 app 下载／删除、模考准备及开始／离开／继续／交卷后重听。它们用小音频 fixture 和真实源键生成测试清单，不依赖整库生成完成，也不冒充对全部音频的内容审听。两者覆盖 375、390 深色、430 宽度。

`audio-metadata.cjs` 使用真实 Service Worker 检查 HTML／指纹不符的清单不能覆盖已验证缓存，以及旧缓存离线恢复、有效版本更新和更新后的离线恢复。

`i18n-offline.cjs` 检查真实 worker 下翻译包按需下载与离线恢复；`shell-update.cjs` 检查更新时保留存档且不打断进行中的学习；`audition.cjs` 检查独立试听页控制、真实媒体播放及旧 shell-34 导航升级。试听页与主游戏音频使用不同清单，不应互相替换。

增删音频或调整源文本时重新生成对应分包及索引指纹；改播放器壳文件时按 `sw.js` 的壳版本发布流程更新。保留源键和场景说话人信息，尤其不要把听写的 B/C 角色统一写成 A。新增 UI 必须同时保留用户点击入口、取消清理和答前权限检查。
