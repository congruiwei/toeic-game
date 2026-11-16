# Kokoro 试听候选与来源

本轮仅准备并试听候选声音，使用 `Kokoro-82M v1.0`。试听后等待用户选择，不把本表中的候选当作已选定的正式声音，也不据此批量生成题库音频。

机器可读输入为 [audio-audition-source.json](../data/audio-audition-source.json)。其中 `text` 保留现有英文题库或日语译文原句，`key` 对应 [translation-source.js](../js/translation-source.js) 的句子键；`spoken` 仅用于明确金额等读法。所有试听内容都是本项目现有学习内容，未使用下面署名作品的故事正文或原始录音作为试听片段。

## 候选声音

以下等级在 2026-11-17 核对自作者的 [VOICES.md](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md)。它们估计训练数据的质量与数量，并非对每次合成效果的保证，也不代替实际听感。官方也提示短句可能较弱，因此样本同时包含短回应和完整对话、广播。

| 分组 | 官方 ID | 显示名 | 性别 | 官方整体等级 |
| --- | --- | --- | --- | --- |
| 美式英语 | `af_heart` | Heart | 女 | A |
| 美式英语 | `af_bella` | Bella | 女 | A- |
| 美式英语 | `af_nicole` | Nicole | 女 | B- |
| 美式英语 | `am_fenrir` | Fenrir | 男 | C+ |
| 美式英语 | `am_michael` | Michael | 男 | C+ |
| 美式英语 | `am_puck` | Puck | 男 | C+ |
| 英式英语 | `bf_emma` | Emma | 女 | B- |
| 英式英语 | `bf_isabella` | Isabella | 女 | C |
| 英式英语 | `bm_fable` | Fable | 男 | C |
| 英式英语 | `bm_george` | George | 男 | C |
| 日语 | `jf_alpha` | Alpha | 女 | C+ |
| 日语 | `jf_tebukuro` | Tebukuro | 女 | C |
| 日语 | `jm_kumo` | Kumo | 男 | C- |

美式、英式、日语分别对应 Kokoro 的语言代码 `a`、`b`、`j`。样本记录的语言标签则为 `en` / `ja`，声音记录使用 `en-US` / `en-GB` / `ja-JP`。显示名只是官方 ID 的可读写法。

## 英语试听内容

五个样本共 153 个英文词；计数把缩写和连字符词视为一个词。题目问句、回应选项和长听力正文均完整保留，题目解析不加入朗读。

| 样本 ID | 内容 | 原文键 | 词数 |
| --- | --- | --- | --- |
| `en-part2` | 野餐准备；一个问句和全部三个回应 | `p2-060/audio/0`；`p2-060/options/0/0`、`1/0`、`2/0` | 24 |
| `en-part3` | 预约办公室窗户测量；完整 A/B 四轮对话 | `p3-g09/turns/0/0` 至 `p3-g09/turns/3/0` | 44 |
| `en-part4` | 商店收银与网上订单取货；完整六句广播 | `p4-g01/turns/0/0` 至 `p4-g01/turns/0/5` | 55 |
| `en-vocab-receipt` | 索取收据以报销出租车费 | `v-receipt/example/0` | 13 |
| `en-vocab-fare` | 船票价格及包含项目 | `v-fare/example/0` | 17 |

Part 3 的 `speaker` 保留 A/B，便于后续试听对比两种声音搭配。Part 2 的三个回应是互斥选项，依题库原顺序播放。样本能检查问句语调、缩写、星期、`half past twelve` 和 `six-dollar` 的读法；英文原句已把时间与金额拼写出来，无需 `spoken` 覆盖。

## 日语试听内容

每个样本只有一个现有日语译句，直接关联同一英文句子的键，便于核对语气、长音和断句。

| 样本 ID | 来源包与键 | 对应英文 | 现有日语译文 |
| --- | --- | --- | --- |
| `ja-invoice` | `part2` · `p2-012/audio/0` | Could you check the invoice total? | 請求書の合計金額を確認していただけますか。 |
| `ja-receipt` | `vocab` · `v-receipt/example/0` | Could you email me the receipt so I can claim the taxi fare? | タクシー代を精算したいので、領収書をメールで送っていただけますか。 |
| `ja-announcement` | `listening` · `p4-g01/turns/0/1` | Our upstairs checkout is closed for the rest of the day. | 上階のレジは本日の営業を終了いたしました。 |
| `ja-approval` | `reading` · `read-proof/documents/0/text/3` | Printing starts only after written approval of the final proof. | 最終校正データの書面によるご承認をいただいてから、印刷を開始します。 |
| `ja-price` | `reading` · `read-proof/documents/0/text/1` | A further round requested by the customer costs $35. | お客様のご希望でさらに修正する場合は、1回 $35 です。 |

唯一的 `spoken` 覆盖是 `ja-price`：`お客様のご希望でさらに修正する場合は、いっかい三十五ドルです。`。这只把 `1回 $35` 的读法显式化；展示文本和现有译文包均不变。当前 Misaki/UniDic 会把汉字 `一回` 读成「いちかい」，因此这里用假名明确促音「いっかい」；轻量音素检查为 `iʔkai saɲʥɨːɡo`（いっかい・さんじゅうご）。其余九个样本直接朗读 `text`。

## 模型与日语训练音频署名

作者的 [Kokoro-82M 模型卡](https://huggingface.co/hexgrad/Kokoro-82M) 标明权重为 Apache-2.0，并在 Creative Commons Attribution 部分列出 Koniwa `tnc` 训练音频为 **CC BY 3.0**。官方声音表把 `jf_tebukuro`、`jm_kumo` 分别关联到下列作品。以下署名描述训练数据来源；试听输出是根据本项目学习文本合成的新语音，不是原播音员录制本题的音频。

| 声音 | 原始朗读署名 | 作者来源与原始入口 | 音频许可 |
| --- | --- | --- | --- |
| `jf_tebukuro` | テレビ西日本；朗读：四位 知加子；作品《手袋を買いに》，文本作者：新美 南吉 | [Koniwa 元数据](https://github.com/koniwa/koniwa/blob/master/data/tnc/tnc__tebukurowokaini.json)；[原始 TNC 视频](https://www.youtube.com/watch?v=XrsgPQSoMog) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| `jm_kumo` | テレビ西日本；朗读：田久保 尚英；作品《蜘蛛の糸》，文本作者：芥川 龍之介 | [Koniwa 元数据](https://github.com/koniwa/koniwa/blob/master/data/tnc/tnc__kumonoito.json)；[原始 TNC 视频](https://www.youtube.com/watch?v=0gs2UkcR84I) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |

[Koniwa 作者说明](https://github.com/koniwa/koniwa#readme)区分了音频许可与原故事文本的公有领域状态；不能把故事文本的状态当成录音许可。此处按其逐项元数据保留电视台、朗读者、作品、原始入口和许可链接。将这两个候选的试听文件移到其他页面发布时，一并保留上述出处及“学习文本合成语音”的说明。

`jf_alpha` 的官方 CC BY 一栏为空，没有将它归到上述 TNC 作品。未给它虚构特定录音者或训练音频署名。模型许可信息仍按作者模型卡记录。

## 试听完成后的停点

先比较同一文本在候选声音下的清晰度、自然度、问句语调及数字读法，再由用户选择正式声音和需要的男女组合。本轮不自动替用户确定声音，不接着生成全库音频。安装、合成命令和实际试听文件由生成流程记录；本文件只负责候选、文本与来源。
