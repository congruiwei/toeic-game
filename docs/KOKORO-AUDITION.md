# Kokoro 本地合成试听

这是音频升级的第1步：先发布试听，再由使用者选择3–4个英语声音，以及日语采用Kokoro还是设备系统语音。尚未替换游戏的正式朗读，也未开始全题库音频生成、点读或选项释义功能。

入口为根目录 `audition.html`。10个英语候选各朗读相同的5段材料；3个日语候选各朗读相同的5句译文。声音等级和日语训练素材署名见 [KOKORO-VOICES.md](KOKORO-VOICES.md)。所有音频是模型合成，不是真人录音。

## 文件与数据

- `data/audio-audition-source.json`：现有题库或日语包的逐句key与原文、候选声音、官方资料链接。`spoken`仅在必要时明确合成读法，不修改题库原文。
- `data/audio-audition-manifest.json`：每个声音、每段材料的完整试听，以及逐句文件的路径、时长、字节数、SHA256；包含生成配方、模型与声音包摘要、工具版本。
- `audio/audition/<voice>/`：AAC-LC、单声道、24kHz、约48kbps的`.m4a`。单句材料复用片段文件；多句材料另有连读版。
- `scripts/generate-audition.py`：CPU ONNX本地合成、保守裁剪首尾静音、双遍响度归一化至约−16 LUFS、AAC编码；所有WAV与发音缓存放在外部工作目录。
- `audition.html`、`audition.css`、`js/audition.js`：独立静态试听页。单个播放器按点击下载，设备日语也需点击触发。试听选择使用独立存储键，不改游戏进度。

SW应用壳版本为35。试听页面、脚本、样式和两份对象JSON有专用网络优先分支，防止已有SW把试听导航替换成游戏首页，或把试听清单误当成数组题库。它们仅在访问时下载；试听音频不加入应用壳预缓存。完整音频离线下载属于后续第3步。

## 在仓库外安装

本批使用Intel CPU的ONNX版本。网页本身仍然纯静态，无Python、模型下载或构建要求。下面的路径是通用示例；不要把模型、虚拟环境或WAV提交进仓库。

```sh
TOEIC_TTS_DIR="$HOME/.local/share/toeic-kokoro"
mkdir -p "$TOEIC_TTS_DIR/models" "$TOEIC_TTS_DIR/tmp" "$TOEIC_TTS_DIR/cache"
uv venv --python 3.12 "$TOEIC_TTS_DIR/venv"
uv pip install --python "$TOEIC_TTS_DIR/venv/bin/python" -r scripts/requirements-kokoro.txt
uv pip install --python "$TOEIC_TTS_DIR/venv/bin/python" 'https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl'
"$TOEIC_TTS_DIR/venv/bin/python" -m unidic download
curl -fL --retry 3 -o "$TOEIC_TTS_DIR/models/kokoro-v1.0.onnx" 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.onnx'
curl -fL --retry 3 -o "$TOEIC_TTS_DIR/models/voices-v1.0.bin" 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin'
"$TOEIC_TTS_DIR/venv/bin/python" scripts/generate-audition.py --workdir "$TOEIC_TTS_DIR"
```

另需本地`ffmpeg`／`ffprobe`。这次使用UniDic 3.1.0+2021-08-31；安装器曾遇到TLS传输中断，重试同一词典地址后成功，将内容解压至专用环境的`unidic/dicdir`。没有关闭TLS验证。

可用`--voices af_heart bf_emma`只重生成指定声音。相同模型、配方和音素的WAV缓存会复用；输出仍重新编码及测量。清单以临时文件原子替换逐段保存，`generation.sourceSha256`绑定整份已审文本；仅同源版本允许保留其他候选，完整生成后才写`complete: true`和最终统计。在覆盖校验通过前不要发布半份清单。英语使用Misaki词典及eSpeak音素后备，日语使用Misaki与UniDic；eSpeak只负责文字转音素，发声仍由Kokoro模型完成。

日语五句的轻量发音核对发现「一回」自动解析为「いちかい」，已在`ja-price.spoken`明确为「いっかい」，原译文保持不变。請求書、精算、領収書、上階、書面、最終校正、承認等词的音素也逐项核对；此检查不等同于对生成音频做ASR转写。

模型来源：[hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)，Apache-2.0。CPU封装：[kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx)，MIT。这里只发布原创题库文本的合成试听，不发布模型或依赖代码。日语素材署名保留在页面和声音文档中。

## 校验与测试

```sh
node scripts/validate.mjs
node scripts/validate-audition.mjs
"$TOEIC_TTS_DIR/venv/bin/python" scripts/check-audition-audio.py
node --test tests/*.test.mjs
NODE_PATH=/path/to/node_modules PW_CHANNEL=chrome node tests/audition.cjs
NODE_PATH=/path/to/node_modules PW_CHANNEL=chrome node tests/shell-update.cjs
```

试听校验覆盖原文精确对应、候选分组与等级、语音文件覆盖、文件类型及字节数；生成器用ffprobe核对实际AAC编码、声道、采样率和时长。浏览器测试覆盖三档手机宽度、深色模式、单播放器切换、速率、日语系统声音点击触发、复制后备、原进度不变及真实音频播放。

本批最终输出：13个声音（10英语／3日语），10份源样本，65个整段试听版本，175个逐句条目，205个不同的M4A文件。合计6,711,713字节（6.40 MiB）。65个整段版本共624.14秒（10分24秒）；所有不同文件共1034.27秒（17分14秒），后者包括整段与逐句的重复内容，不表示独立文本量。

模型推理与发音均在本机完成。原始AAC解码发现13个文件峰值超过满幅，已统一用3 dB前置余量重新编码，并逐文件进行4倍采样解码检测；其中8个文件另外保留不超过1.469 dB的余量。最终峰值范围0.6384–0.9436，无满幅溢出；一个原始模型片段略高于满幅，已使用浮点临时WAV保留信号到响度处理，避免提前削波。

响度目标为约−16 LUFS。最终65个整段版本实测−19.63至−15.97 LUFS，中位数−17.11 LUFS；最轻的是Nicole的receipt例句。试听阶段优先保留音色和峰值余量，并不宣称所有候选精确等响；正式批量生成时还需对轻柔、短句材料进一步标定。全库ASR逐条转写与重生成属于选声后的第2步，以上文件和发音检查不能代替识别审计或实际听感选择。

本步验收结果：

```text
node scripts/validate.mjs: PASS — 2548 unique IDs; 7699 ZH + 7699 JA units
node --test tests/*.test.mjs: 81 tests, 81 pass, 0 fail
Audition: 13 voices (10 EN / 3 JA), 10 samples, 65 full clips, 175 segments, 205 M4A files, 6.40 MiB
PASS audition source, coverage and local audio integrity
PASS: decoded all 205 M4A files; AAC-LC / mono / 24000 Hz; exact duration/bytes; no decoder errors, empty or silent waveform; 4x reconstruction peak <= 0.95.
Audition: 13 voices (10 EN / 3 JA), 10 samples, 65 full clips, 175 segments, 205 M4A files, 6.40 MiB
PASS audition validator rejects incomplete/stale generation, duplicate IDs, source drift, group limits, unsafe paths, hash drift and inconsistent totals
PASS audition controls at 375px
PASS audition controls at 390px (dark)
PASS audition controls at 430px
PASS native M4A metadata/playback af_heart/en-part2 (8.00s)
PASS native M4A metadata/playback jf_alpha/ja-invoice (3.70s)
PASS installed service-worker audition navigation
PASS legacy shell-34 → toeic-island-shell-35 audition navigation after one open (progress preserved)
node tests/e2e.cjs: 9 PASS
node tests/shell-update.cjs: 4 PASS
```

旧SW34→35测试使用`tests/fixtures/sw-shell-34.txt`，固定为`7c8fb5b`的原始worker，运行测试无需Git历史。测试先安装旧worker，再只打开一次试听网址，由应用自身完成更新和重载，且保留旧练习、模考和经验。手机布局使用375／390／430px（390深色）；未替代真iPhone声音与触控验收。

正式音频改造前的加载基线，`node tests/performance.cjs`退出0；2 Mbps下载／1 Mbps上传／80 ms延迟、冷缓存、禁用SW，测量时没有模型推理或转码任务并行。首页中位数1879 ms、首题中位数2515 ms。正式游戏此时仍使用原朗读；后续完成音频集成后以同样设置复测，不把试听页的测试当作完整改造后的性能结果。

```json
{
  "network": "2 Mbps down / 1 Mbps up / 80 ms latency, cold cache, SW blocked",
  "rows": [
    {
      "home": 1891,
      "first": 2502,
      "translations": 0
    },
    {
      "home": 1849,
      "first": 2519,
      "translations": 0
    },
    {
      "home": 1914,
      "first": 2522,
      "translations": 0
    },
    {
      "home": 1879,
      "first": 2515,
      "translations": 0
    },
    {
      "home": 1855,
      "first": 2499,
      "translations": 0
    }
  ],
  "median": {
    "home": 1879,
    "first": 2515
  }
}
```

## 选声后的实施顺序

1. 记录明确选定的3–4个英语声音，以及日语使用系统或具体Kokoro声音；再批量合成听力、词汇、阅读和Part 5。逐句key清单、场景内角色一致、数字／日期等规范化，以及本地ASR转写复核和重生成必须同时完成。
2. 正式播放器优先本地生成音频，缺失才使用系统语音；语速保持音调，模考提前下载本套，设置中按听力／词汇／阅读分类下载和删除离线音频，展示实际容量。
3. 英文点读只在答后或学习卡／方法卡／表达本可用，模考答题时保持原规则。
4. 独立按需加载每个选项的中日释义、词性和中文判断理由；支持已有词卡与自定义简易词卡进入个人单词本和FSRS，并保持旧存档迁移兼容。
5. 获授权替换`read-samples-01`的since与`read-badge-01`的collect干扰项，核对已有选项避免重复，同步解析和相关翻译。其他题目原文与所有ID保留。

每步校验、相关手机测试、提交及推送；最终提供全库音频数量／时长／大小、ASR复核记录、正式游戏加载前后对比与真机确认清单。第1步发布后暂停，等待选声回复。
