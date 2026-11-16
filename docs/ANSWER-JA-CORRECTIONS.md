# 答案与日语译文修正

基线：`c7f8d04`；日期：2026-11-17。仅修正 `read-bikes-01` 的答案、解析、证据、同义说明及其明确错误答案标记；所有原题 ID、原文段落、题干及四个英文选项保持不变。其他题库英文文件与基线一致。

## read-bikes-01

原题句：**When you describe the problem, be as [2] as possible.**

- A. precisely
- B. preciseness
- C. precision
- D. precise

**答案：D. precise。** 完整句：When you describe the problem, be as precise as possible.

英文解析：The blank follows the linking verb be in the pattern be as + adjective + as possible, so precise is required. Precisely is an adverb; preciseness and precision are nouns.

中文解析：空格位于系动词 be 后，结构为 be as + 形容词 + as possible（尽可能……），所以选 precise。precisely 是副词，preciseness 和 precision 都是名词。

证据：`When you describe the problem, be as [2] as possible.`

同义说明：`be as precise as possible → be as exact and specific as possible`

普通练习、未完成模考、错题复习使用当前正答。旧已交卷模考可能持有 `precisely` 快照：新增可选 `correctedFrom` 明确标记这一错误值，仅命中该值时，回顾区、复制问Claude和问题报告改用当前正答；回顾注明原成绩保留。原模考keys、历史成绩、XP、复习记录均不回溯改写，未标记题目的原快照语义保持不变。应用壳更新为34。

## 另外四篇Part 6的复核结论

逐空代入全部64个选项，并核对证据和解析：[完整逐空报告](PART6-RECHECK.md)。

| 篇目 | 结论 |
| --- | --- |
| read-badge | 3空未发现问题；read-badge-01 的 collect 作为受益双宾语有接受度分歧，列为待母语复核，不能断言标准书面语中构成双解。 |
| read-samples | 3空未发现问题；read-samples-01 的 since 可引导原因：“因为九点开门，请把试用装摆好”，与后文不冲突，确认无法排除。 |
| read-labels | 4空均未发现另一个成立答案。 |
| read-credit | 4空均未发现另一个成立答案。 |

总计：14空未发现问题，1处确认干扰项歧义，1处构式接受度边界。根据本次“不修改其他题目英文原文”的要求，没有更改这两道题的英文选项或答案；报告里的选项替换只作为后续建议。

since 的原因义参见 [Cambridge English Grammar Today](https://dictionary.cambridge.org/grammar/british-grammar/since)。collect 的相反学术判断与具体出处列在逐空报告中，不将单一读法当作无争议结论。

## 日语修改清单

主体译文共修改 **37条日语**，另同步1条日语词义派生包；中文只同步修正自行车题的1句译文。术语表从49增至50项，新增supplier。按全部9个日文JSON统计（含词义派生重复），供給業者由21处降至0处；仕入先由26处增至43处。只统计主体七库时，对应为20→0、24→40。

分类：supplier相关27条、木箱期限5条（指定4处以及同样表示期限的标题）、敬语1条、负责人安排问句1条、tare同源2条、自行车题1条。

| 包／key | 原译文 | 新译文 | 原因 |
| --- | --- | --- | --- |
| `ja/vocab / v-specification/example/0` | 供給業者は、ふたの重量と厚みに関する当社の技術仕様を満たさなければなりません。 | 仕入先は、ふたの重量と厚みに関する当社の技術仕様を満たさなければなりません。 | 当社向け部材の購入先なので自然な「仕入先」にする；製造元とは断定しない。 |
| `ja/vocab / v-deteriorate/example/0` | 供給業者の試験によると、このゴム製シールは日光で劣化し、徐々に弾力を失います。 | 仕入先の試験によると、このゴム製シールは日光で劣化し、徐々に弾力を失います。 | ゴム部材の提供元を指すため「仕入先」とする；試験実施だけからメーカーとは推定しない。 |
| `ja/vocab / v-supplier/meaning` | 供給業者；仕入れ先 | 仕入先；納入業者 | 一般的な商取引で使う日本語の見出し語にする；購入側の呼称と納入側の役割を区別する。 |
| `ja/vocab / v-supplier/example/0` | 当社の購買契約では、その製粉所を全配送の責任を持つ小麦粉の供給業者に指定しています。 | 当社の購買契約では、その製粉所を、すべての納品を担当する小麦粉の仕入先として指定しています。 | 購買契約上の相手なので「仕入先」とし、responsible for all deliveries を自然な「すべての納品を担当する」で保持する。 |
| `ja/vocab / v-purchase-order/example/0` | 署名済みの発注書は、鋼製クリップをちょうど40個当社に販売するよう供給業者へ指示しています。 | 署名済みの発注書は、仕入先に対し、鋼製クリップをちょうど40個当社に販売するよう指示しています。 | 発注者から購入先への指示なので「仕入先」とし、当社へ販売する対象関係と40個を保持する。 |
| `ja/vocab / v-additional/example/0` | 最初の10箱に加え、当方の依頼で供給業者がさらに2箱送りました。 | 最初の10箱に加え、当方の依頼で仕入先がさらに2箱送りました。 | 購入品の追加発送であり仕入先が自然；配送専門会社とは断定しない。 |
| `ja/vocab / v-disposable/example/0` | 供給業者は内張り材に使い捨てと表示し、1回使ったら必ず廃棄するよう定めています。 | 仕入先は各内張り材に「使い捨て」と表示し、1回使ったら必ず廃棄するよう定めています。 | 商品の供給元という役割を仕入先で表し、each liner の各品への表示も保持する；製造者とは断定しない。 |
| `ja/vocab / v-price-list/example/0` | 価格表には各サイズの継手の販売価格が記載され、各コードの横にドル建ての金額が表示されています。 | 価格表には、仕入先が販売する継手の各サイズの価格が記載され、各コードの横にドル建ての金額が表示されています。 | 元訳では supplier が省略されていたため、誰の販売価格なのかを自然に明示する。 |
| `ja/vocab / v-ultimately/example/0` | 3回の入札に失敗した後、その仕入先は最終的に最後の契約を獲得し、1年にわたる不調に終止符を打ちました。 | 3回の入札に失敗した後、その業者は最終的に最後の契約を獲得し、1年にわたる不調に終止符を打ちました。 | 入札している企業であり、話者側との既存の仕入関係は示されていないため「業者」にする。 |
| `ja/vocab / v-stock-shares/example/0` | ファンドは供給業者の普通株を購入し、現在は発行済み株式の3パーセントを所有しています。 | ファンドはその納入業者の普通株を購入し、現在は発行済み株式の3パーセントを所有しています。 | ファンドの投資対象を指すため、ファンド自身の購入先という含みのある「仕入先」は避けて「納入業者」とする。 |
| `ja/part2 / p2-137/audio/0` | 間仕切りを移した後、誰が平面図を更新していますか。 | 間仕切りを移した後、平面図はどなたが更新しますか。 | 按指定译文改成询问更新负责人／后续安排的自然问句，避免机械使用「更新していますか」；保留 after 的先后关系，不改 Rosa 正在录入尺寸的答句。 |
| `ja/listening / p4-g03-q3/options/2/0` | 昼食前の配達には追加料金がかかるから | 業者が昼食前の配達に追加料金を請求するから | 省略されていた料金を課す主体を補う；配達を手配する供給側を専門配送会社に限定しない。 |
| `ja/listening / p3-g47/turns/4/0` | 正味重量を比べる前に、容器全体の重量を測るべきです。 | 正味重量を比べる前に、ふたも含めた風袋重量を測るべきです。 | tare 使用计量用语「風袋重量」；full 在本段指瓶身加瓶盖的完整空包装重量，用「ふたも含めた」明确漏扣盖重的上下文，保留先测皮重再比较净重的顺序，并与同源听写完全一致。 |
| `ja/listening / p3-g47-d/text/0` | 正味重量を比べる前に、容器全体の重量を測るべきです。 | 正味重量を比べる前に、ふたも含めた風袋重量を測るべきです。 | 听写与 p3-g47/turns/4/0 是同一英文原句，必须同步使用「風袋重量」；保留 full tare 与 net weights 的区别，不把带内容物的总重量当作皮重。 |
| `ja/listening / p3-g52-q1/options/1/0` | 基準の紙は別の供給業者のものでした。 | 基準の紙は別の仕入先のものでした。 | 同じ会話の紙材調達先と表記をそろえ、基準試料の購入先という役割を明確にする。 |
| `ja/listening / p3-g52-q2/options/2/0` | 供給業者が新しい保管施設の費用を払わなければなりません。 | 仕入先が新しい保管施設の費用を払わなければなりません。 | 紙材供給元という同一会話の役割を「仕入先」で保つ。 |
| `ja/listening / p3-g52-q3/options/1/0` | 供給業者が違約金を支払った後です。 | 仕入先が違約金を支払った後です。 | 同一会話の紙材供給元を指すため「仕入先」にする。 |
| `ja/grammar / gram-conditional-09/sentence/0` | 供給業者がその料金を免除してくれれば、修理費は現在の予算内に収まるでしょう。 | 業者がその料金を免除してくれれば、修理費は現在の予算内に収まるでしょう。 | 修理に関連する料金免除なので一般的な「業者」とし、部材の仕入先や製造会社とは限定しない。 |
| `ja/grammar / gram-relative-13/sentence/0` | 倉庫が浸水した供給業者は、今週、当社の荷積み場を使用します。 | 倉庫が浸水した仕入先は、今週、当社の荷積み場を使用します。 | 当社と物流施設を共用する取引先を「仕入先」とする；倉庫運営会社や運送会社に変えない。 |
| `ja/grammar / gram-nonfinite-12/sentence/0` | 料理長は供給業者の請求書原本を捨てたことを否定し、まだ事務所にあると言いました。 | 料理長は仕入先の請求書原本を捨てたことを否定し、まだ事務所にあると言いました。 | 料理長が扱う納入品の請求書なので「仕入先」が自然。 |
| `ja/grammar / gram-lexis-50/sentence/0` | 2社の料金が同じだったため、取引期間の長さが選定の決め手となりました。 | 業者2社の料金が同じだったため、取引期間の長さが選定の決め手となりました。 | 省略されていた供給側の立場を「業者2社」で補い、物品販売かサービス提供かは限定しない。 |
| `ja/reading / read-samples/documents/0/text/3` | 新しいジャムを来店者に試してもらうため、供給業者が瓶を無料で送ってくれました。 | 新しいジャムを来店者に試してもらうため、仕入先が試食用の瓶入りジャムを無料で送ってくれました。 | 店への仕入先として表し、前後の試食文脈から jars は空の瓶でなく瓶入りジャムであることも自然に伝える。 |
| `ja/reading / read-samples/documents/0/text/5` | 桃やプラムなど、どの味がお好みかカードに記入していただいてください。 | 桃やプラムなど、どの味がお好みかカードに記入していただくよう、お願いしてください。 | 按指定表达改为「記入していただくよう、お願いしてください」，清楚表示请员工请求客人填写，消除「いただいてください」的不自然叠用。 |
| `ja/reading / read-bikes/documents/0/text/3` | 不具合の内容は、できるだけ正確にご説明ください。 | 不具合をご説明いただく際は、できるだけ正確にお伝えください。 | 随 precise 答案同步，明确描述问题时的准确性要求。 |
| `ja/reading / read-interest-register/documents/0/text/3` | 名簿への登録は、今後の仕事に関心があることを示すだけです。 | 名簿への登録は、その業者が今後の仕事に関心を持っていることを示すだけです。 | 省略されていた supplier を自然に補う；未契約の登録希望業者なので既存の仕入先とは呼ばない。 |
| `ja/reading / read-interest-register/documents/0/text/4` | 自治体に購入義務が生じるものでも、他の入札者に対して優先権が与えられるものでもありません。 | 自治体に購入義務が生じるものでも、登録業者に他の入札者に対する優先権が与えられるものでもありません。 | どの業者にも登録だけでは優先権がないという主体を保持し、未契約である点も残す。 |
| `ja/reading / read-interest-register-02/options/2/0` | 名簿への登録は、文房具の供給業者に限られます。 | 名簿への登録は、文房具の納入業者に限られます。 | 自治体に納品する候補企業という意味なので「納入業者」とし、既存の購入先には限定しない。 |
| `ja/reading / read-refund-02/options/2/0` | 供給業者の推薦状 | 仕入先からの推薦状 | 商取引上の供給元による推薦であることを自然な「仕入先からの」で表す。 |
| `ja/reading / read-waiver/documents/0/text/3` | 保証期間は、通常使用の準備が整ったことを供給業者が書面で通知した時点から始まります。 | 保証期間は、通常使用の準備が整ったことを納入業者が書面で通知した時点から始まります。 | 評価用機器の提供側を「納入業者」とする；メーカーか販売店か、購入済みかは原文にないため決めつけない。 |
| `ja/reading / read-waiver/documents/0/text/6` | 供給業者は、機器を特定するため後日の使用準備完了通知に納品書を添付することがありますが、先の納品日を通知日の代わりに用いることはできません。 | 納入業者は、機器を特定するため後日の使用準備完了通知に納品書を添付することがありますが、先の納品日を通知日の代わりに用いることはできません。 | 同じ評価機器の提供側を前文と同じ「納入業者」に統一する。 |
| `ja/reading / read-fabric/documents/2/title` | 供給業者から Rill へ・木曜日 10:00 | 仕入先から Rill へ・木曜日 10:00 | Rill に布地を販売・交換する相手なので「仕入先」とし、運送担当者とは区別する。 |
| `ja/reading / read-banding/documents/0/text/5` | 2社のスリーブ価格を比較する際は、まず両方の見積額から送料を除いてください。 | 仕入先2社のスリーブ価格を比較する際は、まず両方の見積額から送料を除いてください。 | 省略されていた価格比較の相手を「仕入先2社」で補い、商品代と送料の区別を保持する。 |
| `ja/reading / read-crate-hire/documents/0/text/0` | レンタルした木箱はすべて、返却日の 17:00 までにお返しください。 | レンタルした木箱はすべて、返却期限日の 17:00 までにお返しください。 | due date 是归还期限日，不是实际归还日。 |
| `ja/reading / read-crate-hire/documents/0/text/1` | 遅れた木箱は、返却日を含め、各日 17:00 時点で未返却である日ごとに、1箱 $3 を請求します。 | 遅れた木箱は、返却期限日を含め、各日 17:00 時点で未返却である日ごとに、1箱 $3 を請求します。 | due date 是归还期限日，不是实际归还日。 |
| `ja/reading / read-crate-hire/documents/0/text/2` | 返却日より前に当社トラックの回収を予約・確定し、合意した場所と時刻に木箱を用意していただいた場合、延滞料金はかかりません。 | 返却期限日より前に当社トラックの回収を予約・確定し、合意した場所と時刻に木箱を用意していただいた場合、延滞料金はかかりません。 | due date 是归还期限日，不是实际归还日。 |
| `ja/reading / read-crate-hire/documents/1/title` | 注文 61・木箱6箱、火曜日返却 | 注文 61・木箱6箱、返却期限日は火曜日 | 标题 Six crates due Tuesday 同样表示期限，避免被读成已于周二归还。 |
| `ja/reading / read-crate-hire-01/options/3/0` | 返却日前に予約するという規則 | 返却期限日前に予約するという規則 | due date 是归还期限日，不是实际归还日。 |

`ja/vocab-meanings.json` 的 `v-supplier/meaning` 同步从「供給業者；仕入れ先」改为「仕入先；納入業者」，该文件是自动生成的轻量副本，不另算一个不同义项。

中文 `read-bikes/documents/0/text/3` 从「描述问题时，请尽可能准确。」改为「描述问题时，请尽可能做到准确。」。

## 全库检索与保留判断

- 日语敬语扫描覆盖9个JSON／8825个条目；重点复核95个含敬语的主体单位。`いただいてください` 仅1条需要改动。正常的「ご提示いただいても」「お持ちにならないでください」等保留。
- 进行时按7699个英文源单位与日文逐key匹配，结合完整题组检查Who’s／Who is、其他be + -ing疑问句和行程动词。原库没有精确短语What are you；p2-137改为安排问句。p2-010取货负责人、p2-060带茶安排、p2-043更新计划等已自然表达；Part 1现场动作、木工课正在安装铰链等真实进行含义保持原译。未发现第二条确定需要改为安排表达的误译。
- supplier审查覆盖59个含该源词的单位，另核对2个相关词义和派生副本。明确采购关系用仕入先、设备纳入用納入業者、尚未中标等语境用業者；原文没有确认制造商身份时不擅自改成メーカー。
- 木箱题指定4处全部明确为返却期限日；同组标题Six crates due Tuesday也从“火曜日返却”改为“返却期限日は火曜日”，实际归还记录中的返却保持原样。
- tare原对话与听写同步为風袋重量；full依同组语境明确包含瓶盖。gross weight的総重量、net weights的正味重量，以及空瓶加盖的其他表述保持区别。

## 校验与测试

机器校验验证结构、选项统计和翻译覆盖；不能证明语义唯一性。上面的人工复核疑点仍需保留。

`node scripts/validate.mjs`：退出码0，输出如下。

```text
Part 2 原词重复：干扰项 150/378 (39.7%)，正确回应 52/189 (27.5%)，仅靠排除即可作对 8/189 (4.2%)。
Part 6 插句位置 [1]/[2]/[3]/[4]：4/4/4/4
Part 7 插句位置 [1]/[2]/[3]/[4]：3/3/4/3
Part 7 专项：词义 25，NOT 16，插句 13；3–4 题单篇 30/40。插句排除于位置统计。
题型 | 最长（含并列） | 唯一最短¹ | 唯一最长¹ | 正确位置 A/B/C/D
Vocab meaning | 354/1087 (32.6%) | 178/1079 (16.5%) | 237/1079 (22.0%) | 260/273/275/279
Vocab english | 341/1087 (31.4%) | 177/1079 (16.4%) | 193/1079 (17.9%) | 281/253/269/284
Vocab sound | 330/1087 (30.4%) | 176/1082 (16.3%) | 183/1082 (16.9%) | 254/275/265/293
Vocab cloze | 306/1087 (28.2%) | 239/1078 (22.2%) | 163/1078 (15.1%) | 278/288/236/285
Vocab match | 305/1087 (28.1%) | 229/1087 (21.1%) | 259/1087 (23.8%) | 302/246/286/253
Part 1 | 15/60 (25.0%) | 15/60 (25.0%) | 15/60 (25.0%) | 15/15/15/15
Part 2 first | 4/11 (36.4%) | 3/10 (30.0%) | 3/10 (30.0%) | 4/4/3
Part 2 response | 70/189 (37.0%) | 52/188 (27.7%) | 60/188 (31.9%) | 63/63/63
Part 5 语法 | 78/240 (32.5%) | 34/238 (14.3%) | 36/238 (15.1%) | 60/60/60/60
Part 5 词汇 | 27/100 (27.0%) | 12/96 (12.5%) | 13/96 (13.5%) | 25/25/25/25
Part 3 | 53/156 (34.0%) | 44/147 (29.9%) | 35/147 (23.8%) | 39/39/39/39
Part 4 | 35/120 (29.2%) | 35/115 (30.4%) | 24/115 (20.9%) | 30/30/30/30
Part 6 | 21/64 (32.8%) | 16/62 (25.8%) | 14/62 (22.6%) | 16/16/15/17
Part 7 | 82/222 (36.9%) | 54/189 (28.6%) | 40/189 (21.2%) | 52/52/53/52
¹ 唯一最短、唯一最长的分母均排除所有选项等长的题。
i18n zh/vocab: 2181/2181 units
i18n ja/vocab: 2181/2181 units
i18n zh/part1: 240/240 units
i18n ja/part1: 240/240 units
i18n zh/part2: 803/803 units
i18n ja/part2: 803/803 units
i18n zh/listening: 2166/2166 units
i18n ja/listening: 2166/2166 units
i18n zh/grammar: 360/360 units
i18n ja/grammar: 360/360 units
i18n zh/reading: 1905/1905 units
i18n ja/reading: 1905/1905 units
i18n zh/methods: 44/44 units
i18n ja/methods: 44/44 units
Glossary: 50 rules; 7699 Chinese + 7699 Japanese units; term/cell hits 743 + 743; exact exceptions 2; quoted references 0.
Translation validation passed: 7699 Chinese + 7699 Japanese units; aligned keys and table columns.
Japanese derived meanings: 1087 exact entries; Japanese titles: 17 grammar + 22 methods.
词卡 1087 · 多义词头 44 · Part 1 60 · Part 2 200 · Part 5 340 · Part 3/4 组 92 · Part 6/7 组 76 · 解题方法卡 22
题库与方法卡通过校验，含 2548 个唯一 ID。
```

`node --test tests/*.test.mjs`：

```text
tests 81
pass 81
fail 0
cancelled 0
skipped 0
todo 0
```

独立逻辑脚本全部通过：`tests/voices.mjs`、`tests/saves.mjs`、`tests/forms.mjs`、`tests/diagnosis-logic.mjs`、`tests/prediction-logic.mjs`、`tests/v6/replay-logic.mjs`、`tests/v6/methods-logic.mjs`。组卷检查包含4套互不重复的完整200题和24次半套组合。

Playwright使用Chrome的iPhone设备模拟；375／390／430px，390px包含深色模式。新用例实际导入旧存档，检查普通练习、旧模考回顾、Claude复制和问题报告的正答更正，以及XP、原成绩、归档keys保持不变。所有浏览器脚本退出码均为0。



| 浏览器命令（均带 `PW_CHANNEL=chrome`） | 输出汇总 |
| --- | --- |
| `node tests/v6.cjs` | 18功能 × 3宽度 = 54条PASS；含新增答案更正用例 |
| `node tests/e2e.cjs` | 9条PASS；练习、模考开始／中断／继续／交卷、导入导出及离线 |
| `node tests/shell-update.cjs` | 4条PASS；冷启动更新、离线续做、进行中练习及模考保持 |
| `node tests/i18n-offline.cjs` | 12条PASS；3宽度 × 4项真实翻译缓存检查 |

功能回归的最后6条输出：

```text
PASS translations at 375px
PASS translations at 390px
PASS translations at 430px
PASS unknown at 375px
PASS unknown at 390px
PASS unknown at 430px
```

原有端到端、缓存及离线脚本输出：

```text
PASS home at 375/390/430px
PASS manual voice selection and audition
PASS vocabulary, diagrams, illustrated Part 1, Parts 2–7, dictation and mobile layout
PASS mistake book and learning report
PASS JSON export and import
PASS full exam creation, checkpoint, interruption and resume
PASS continuous listening, timed reading, jumps, score, per-item timing, exam errors and half exam
PASS reading deadline auto-submits exactly once
PASS offline reopen, offline illustration and saved answer; zero uncaught page errors
PASS: single online cold open adopted version 2; XP and answered item retained.
PASS: offline relaunch and resume; background update does not interrupt practice.
PASS: another cold window activates the update without reloading the live exercise.
PASS: live timed exam keeps its task and timer as a newer cold window activates the next shell.
PASS i18n 375px: no eager packs; Part 2 downloads exactly the requested bilingual pair
PASS i18n 375px: closed-page offline reopen restores the answer and downloaded translations
PASS i18n 375px: uncached reading reports offline status; same-page online retry succeeds
PASS i18n 375px: real shell activation removes the old shell and preserves all translation packs
PASS i18n 390px: no eager packs; Part 2 downloads exactly the requested bilingual pair
PASS i18n 390px: closed-page offline reopen restores the answer and downloaded translations
PASS i18n 390px: uncached reading reports offline status; same-page online retry succeeds
PASS i18n 390px: real shell activation removes the old shell and preserves all translation packs
PASS i18n 430px: no eager packs; Part 2 downloads exactly the requested bilingual pair
PASS i18n 430px: closed-page offline reopen restores the answer and downloaded translations
PASS i18n 430px: uncached reading reports offline status; same-page online retry succeeds
PASS i18n 430px: real shell activation removes the old shell and preserves all translation packs
```

`node tests/performance.cjs` 同样退出0。2 Mbps下载／1 Mbps上传／80 ms延迟、冷缓存、关闭SW，5次首页中位数1966 ms、首题中位数2578 ms，5次首页到首题的翻译请求均为0。本次为加载回归，运行期间另有浏览器功能测试，不作为独立的前后性能基准比较。

所有英文源文件与基线逐结构比较通过：除 `read-bikes-01` 的答案、证据、同义说明、解析及 `correctedFrom` 元数据外，原文／题干／选项／ID 无变化。修正清单37行已逐key核对，前后值与Git基线及最终文件完全一致；`git diff --check` 通过。
