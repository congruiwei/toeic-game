# Part 6 定向独立复核

审查时间：2026-11-17（Asia/Tokyo）。审查范围仅 `read-badge`、`read-samples`、`read-labels`、`read-credit` 的全部 16 空，以及 `read-bikes-01` 的 precise 修正。以本轮开始时工作树中的 `data/reading.json` 为准；不修改题库。所有选项均实际代入原句和相邻句判断，语法成立但缺乏最佳上下文衔接的句子，与真正语法错误明确区分。

## 结论

- 16 空中发现 **1 处已确认歧义**：`read-samples-01` 的 `since` 原因义；另有 **1 处接受度边界待复核**：`read-badge-01` 的 `collect` 受益双宾语，不认定为已确证的标准书面双解。
- 其余 14 空未发现与正确答案同等自然、同等贴合当前正文的选项；证据、同义替换和中英解析总体一致。
- `read-bikes-01` 首读时仍以 `precisely` 为答案；同轮主代理已联动修正为 `precise`，本报告末尾记录二次读取验证：答案、evidence、paraphrase 及中英解析现已一致，修正通过。
- 另一审题人亦认为 `read-badge-01` 可理解为代领，但进一步语法资料核查存在相反判断，因此不以两位审题人的直觉代替标准书面可接受性的证据。其余判断均以当前上下文为限。
- 用户要求保留其他题目的英文原文和 ID，因此下面的替换写法仅作后续备选建议，本轮 **不应直接实施**；没有修改题库文件。

## read-badge：领取新工牌

### [1] `read-badge-02`

正答：**Thank you for returning yours.**

上文要求离开时把访客证放入出口旁白箱，并说明次日重复使用；`yours` 回指每位访客的 badge。

| 选项 | 实质判断 |
| --- | --- |
| The white box holds outgoing letters. | 语法成立，但把刚明确用于回收工牌的白箱改说为存放待寄信件，与当前指令的功能说明冲突，且不能衔接重复使用证件。 |
| Please keep your badge at home. | 要求把证件留在家里，直接违反离开时投入回收箱及次日复用的要求。 |
| Blue paint dries quickly. | 语法成立，但正文没有涂漆或干燥操作，blue badge 不构成 paint 的话题依据。 |
| Thank you for returning yours. | 与 return box、reuse 的动作链完全一致，以感谢归还结束本段自然。 |

一致性：evidence 精确见正文；paraphrase 的 reuse → collect for reuse 准确；中英解析均支持归还。**无歧义。**

### [2] `read-badge-03`

正答：**check**。代入：`Visitors arriving for a meeting can check in at reception.`

| 选项 | 实质判断 |
| --- | --- |
| check | `check in at reception` 是到前台登记，与接着领取证件衔接。 |
| comb | `comb in at reception` 不能表示登记；comb 若指梳理还需要可梳理的对象，文中没有。 |
| stir | `stir in` 通常要有被混入的材料及混合对象，不能表达访客登记。 |
| fold | `fold in` 通常指折入／拌入某物，不能表达访客到达登记。 |

一致性：`arriving for a meeting` 为实际到访语境；`check in → register on arrival` 准确；两种解析正确区分登记义。**无歧义。**

### [3] `read-badge-01`

登记正答：**give**。代入：`A member of the reception team will give each guest a blue badge at the front desk.`

| 选项 | 实质判断 |
| --- | --- |
| wear | `wear each guest a blue badge` 的双宾语结构不成立；wear 的穿戴者应是主语，不能直接以 each guest 作受领者。 |
| give | `give + each guest + a blue badge` 双宾语合法，表示向来宾发放证件。 |
| collect | **接受度边界，未确证双解。** 可理解为“替每位来宾领取一枚证件”，这在场景上合理；但 `collect + person + thing` 的书面构式许可存在争议，不能直接等同于 give 的常规双宾语。通常改为 `collect a blue badge for each guest` 最无争议。 |
| borrow | 标准商务英语通常需 `borrow a badge for each guest` 或明确借入来源；当前双宾语排列明显不自然，不作为已确认次解。但为严格避免受益读法，可在修改时选不涉及取得／给予的动词。 |

一致性：evidence 的 `each guest a blue badge at the front desk` 确实在正文。give → issue 的同义替换正确；当前解析证明 give 是常规双宾语的最佳答案，但未讨论 collect 的受益读法边界。**不能仅凭这份边界怀疑推翻登记正答。**

边界核查：Lapata 的学位论文检索结果把 collect 列在 benefactive alternation 一栏；但 Rosca 的会议研究明确把 collect 的双宾语例句标为不接受，区分于 gather。因此，“自然英式受益双宾语”这一初始判断过强，已向主代理更正；本题只列待母语复核风险，不计入已确认双解。参见 [Lapata 论文（Table 3.1，检索可见；直接读取返回 403）](https://era.ed.ac.uk/server/api/core/bitstreams/ac7b9143-3e66-42dd-a534-33eeafdcd2b0/content)、[Rosca，AFLiCo IV 摘要集，第 149 页](https://www.ddl.cnrs.fr/Colloques/AFLiCo_IV/PageWeb/pdf/AFLiCoIV_LIVRET.pdf)。

后续若另获改写英文选项的授权，可考虑 collect → inspect，以避开构式接受度争议；本轮依用户限制不修改。**待复核边界，非确证错误。**

### [4] `read-badge-04`

正答：**visible**。代入：`Please keep it visible while you are in the building so that staff can see it.`

| 选项 | 实质判断 |
| --- | --- |
| hidden | 与 `so that staff can see it` 明确矛盾。 |
| visible | `keep + it + adjective` 合法，且 visible 直接实现工作人员能够看到的目的。 |
| sealed | 语法上可说保持某物封闭，但正文没有容器／封装要求，封闭本身也不能达成看见证件的目的。假设额外透明封套并不是当前文字支持的解释。 |
| folded | 语法形式可接受，但折叠不构成证件可见的原因，也没有折叠操作说明；与展示证件的目的不匹配。 |

一致性：evidence 是明确目的从句；visible → in plain sight 准确；中英解析均对应。**无歧义。**

## read-samples：试用装登记

### [1] `read-samples-01`

登记正答：**before**。代入：`Please set them on the tasting table before the shop opens at nine.`

| 选项 | 实质判断 |
| --- | --- |
| since | **也能成立。** since 可作原因连词：`Please set them on the tasting table since the shop opens at nine.` = 因为商店九点开门，请把它们摆到试吃桌上。下一句要求顾客进门时准备好，进一步解释开店时间为何是布置的理由，没有排斥原因用法。不能只按 since 的时间义来判错。 |
| before | 明确指定开店前完成布置，直接满足下一句的准备要求。 |
| unless | `unless the shop opens at nine` 表示九点开店时反而无需执行摆放指令，与已经给定的九点开门和顾客入店前准备好相冲突。 |
| whereas | whereas 需要对照两个可比较事实；“请摆好”和“九点开门”没有此种对照关系，不能建立合理逻辑。 |

一致性：evidence 精确见正文，before 的时间推理与中英解析本身正确；**但解释没有排除 since 的原因义，唯一性不足。**

后续若另获改写英文选项的授权，可保留正文、ID、正答 `before`，将 `since` 改为 `despite`，因 `despite the shop opens at nine` 直接接完整分句不合语法（需名词或 despite the fact that）。本轮依用户限制不修改。**存在实际歧义，已通知主代理并保留为未修问题。**

### [2] `read-samples-03`

正答：**charge**。代入：`The supplier sent the jars free of charge so visitors can try the new jam.`

| 选项 | 实质判断 |
| --- | --- |
| interest | `free of interest` 适用于利息或兴趣等语境；当前是赠送试吃样品，没有贷款、分期或计息安排，不能自然描述试用品的价格。 |
| shipping | 免费运费通常写 `free shipping`、`free of shipping charges`；`sent the jars free of shipping` 不表示免费寄送，也不合当前赠送样品的用法。 |
| charge | `free of charge` 是无须付款的固定表达，适合供应商提供试吃样品。 |
| storage | `free of storage` 不能表示样品免费；即便想表达免仓储费，也需 storage charges／fees，且文中没有仓储服务。 |

一致性：evidence 是填空前的真实片段；free of charge → without payment 准确；两种解析准确。**无歧义。**

### [3] `read-samples-04`

正答：**flavor**。代入：`Ask visitors to note which flavor they prefer, such as peach or plum.`

| 选项 | 实质判断 |
| --- | --- |
| quantity | peach/plum 是水果口味，不是数量。 |
| temperature | peach/plum 不是温度值或冷热状态。 |
| weight | peach/plum 不是重量单位或重量。 |
| flavor | peach/plum 是果酱口味，符合后文依据偏好决定订货。 |

一致性：evidence 精确，paraphrase 和两种解析均说明口味类别。**无歧义。**

### [4] `read-samples-02`

正答：**Put the completed cards in my tray at closing time.**

| 选项 | 实质判断 |
| --- | --- |
| Put the completed cards in my tray at closing time. | completed cards 回接让顾客填写偏好的卡片，并将数据交给 Irene，直接引出她利用 results 决定订货。 |
| The jars are too heavy for the shelf. | 语法成立，但文中实际摆在 tasting table，没有 shelf 或承重问题，不能衔接偏好卡片与 results。 |
| We have already ordered every flavor. | 已订所有口味与下一句尚待根据结果决定订哪种的计划相冲突；正文未提示补订或第二轮订单。 |
| Unopened boxes should go back to the driver. | 正文没有未开箱／司机回收流程，且不能把顾客偏好记录交给 Irene，与该处信息链无关。 |

一致性：evidence 为下一句；results → preferences on completed cards 的回指准确；两种解析一致。**无歧义。**

## read-labels：仓库换标签

### [1] `read-labels-03`

正答：**display**。代入：`Beginning next week, shelf labels will display the aisle number above the item name.`

| 选项 | 实质判断 |
| --- | --- |
| erase | 标签不是执行擦除的主体；下文还明确旧标签原本缺少通道号，擦除也不能解决缺号造成的延误。 |
| subtract | subtract 是减法，需要可减去的数量或计算对象；正文是显示货架信息，没有数值运算。 |
| display | 标签将通道号显示在品名上方，补足旧标签缺失的信息，功能和位置都自然。 |
| withhold | 隐瞒／不提供通道号恰与解决缺号延误相反；`above the item name` 也描述显示位置，而非隐瞒的自然搭配。 |

一致性：evidence 的位置短语真实；display → show on the label 准确；解析符合整篇修订目的。**无歧义。**

### [2] `read-labels-01`

正答：**However**。代入：`Old labels already list the correct item names. However, their lack of aisle numbers has caused delays.`

| 选项 | 实质判断 |
| --- | --- |
| However | 前句肯定名称正确，后句指出位置数据缺失造成延误，优点与缺点形成转折。 |
| Similarly | 后句不是与前句相似的另一优点或同向事实，无法表达此处反差。 |
| For example | 缺少通道号并不是“品名已经正确”的实例。 |
| Consequently | 品名正确并不会导致通道号缺失或因此产生延误，前句不能作为后句的原因。 |

一致性：单独 evidence 只列前句，但紧邻正文提供后半转折；paraphrase 和中英解析准确概括两句关系。**无歧义。**

### [3] `read-labels-04`

正答：**Apply them only to the shelves on the enclosed list.**

| 选项 | 实质判断 |
| --- | --- |
| Remove the item name from each new label. | 与首段“通道号在品名上方”的新标签设计相悖，也无助于避免即将搬动货架的浪费。 |
| Give the unused packet back to the driver. | 指令要求整包退回，无法达成更换需要更新的货架标签；driver 亦无前文依据。 |
| Apply them to every shelf before opening. | every shelf 包含接下来明确将搬动、现在贴会浪费标签的货架，与后文例外矛盾。 |
| Apply them only to the shelves on the enclosed list. | them 回指新标签，only 限定需要贴的货架，下文解释为什么即将搬动的货架应被排除。 |

一致性：evidence 与后续 `would waste labels` 合用支撑例外；paraphrase“listed shelves only → avoid relabeling shelves about to move”是合理的段落推断；中英解析一致。**无歧义。**

### [4] `read-labels-02`

正答：**relabeling**。代入：`Several shelves are due to be moved; relabeling these shelves now would waste labels.`

| 选项 | 实质判断 |
| --- | --- |
| relabels | 有限第三人称动词不能在这里作 `would waste` 的主语，且缺少自身主语。 |
| had relabeled | 有限过去完成时短语没有主语，还会与后面的 would waste 形成未经连接的双谓语。 |
| relabeled | 不能将 `relabeled these shelves now` 当作名词性动作主语；若作过去分词修饰词，正常词序也不是如此。 |
| relabeling | 动名词短语 `relabeling these shelves now` 作主语，谓语为 would waste，语法与搬迁语境一致。 |

一致性：evidence 为即将搬动；are due to be moved → are scheduled for relocation 准确；两种解析对主谓结构判断正确。**无歧义。**

## read-credit：自愿更换取货日期

### [1] `read-credit-01`

正答：**exclusively**。代入：`This offer applies exclusively to orders originally marked for Friday.`

| 选项 | 实质判断 |
| --- | --- |
| exclusively | 明确将本次优惠限定于受周五烧制排程影响的原周五订单，与改至周一的方案一致。 |
| accidentally | 意为优惠意外／错误地适用于这些订单，和邮件主动向受影响会员公布、自愿改期奖励的安排不符；原文没有误发或错误适用。 |
| loosely | 语法外形可拼接，但“优惠大致适用于原周五订单”不给出可执行的范围，并非此种资格通知的自然商务表达；正文亦无近似关联或非严格解释优惠的情景。 |
| previously | 用过去时间副词修饰现在一般时 applies 与当前公布的新方案不合；若讨论过去适用规则，通常需 applied，且正文无此时间对比。 |

一致性：evidence 明确目标订单日期，但 exclusivity 本身由答案给出；paraphrase 是准确释义；中英解析与开头受影响排程一致。未发现有同等成立的第二答案。**无实际歧义。**

### [2] `read-credit-02`

正答：**Unchanged orders will remain on Friday's list.**

| 选项 | 实质判断 |
| --- | --- |
| We will cancel all unconfirmed orders. | 取消不回复者的订单与“只有想改日期才需回复”冲突，也与随后为这些作品保留原承诺取件时间不符。 |
| Monday orders must be collected on Friday. | 当前目标是原周五订单自愿延至周一，不是强制原周一订单提前；this offer 的范围和时间方向均不符。 |
| All replies will be published on our website. | 公开回复与改期安排没有依据，且不能自然为下句 `those pieces` 提供作品／订单的近接先行项。 |
| Unchanged orders will remain on Friday's list. | 从“只有想改期才回复”自然推出不更改者保留周五；those pieces 可回指这些不改期订单的作品。 |

一致性：evidence 精确，paraphrase no reply keeps original date 合理，中英解析一致。**无歧义。**

### [3] `read-credit-03`

正答：**instead**。代入：`Members with flexible plans can collect on Monday instead of Friday.`

| 选项 | 实质判断 |
| --- | --- |
| instead | `instead of` 表示用周一替代原周五，与自愿延后安排一致。 |
| beside | `beside of` 不是此处合法搭配，beside 通常直接接名词并表示空间旁侧。 |
| despite | `despite of` 不合标准搭配；despite 本身直接接名词，且这里需要替代关系。 |
| rather | 替代应为 `rather than Friday`，不能说 `rather of Friday`。 |

一致性：evidence 指替代日期；instead of → as a substitute for 准确；两种解析正确。**无歧义。**

### [4] `read-credit-04`

正答：**add**。代入：`If you volunteer, we will add studio credit to your account.`

| 选项 | 实质判断 |
| --- | --- |
| charge | charge a fee／amount to an account 表示记账收费；`charge studio credit to your account` 不是给予抵用额的正常说法，与自愿延后得到优惠的安排不符。 |
| add | `add credit to an account` 自然表示向账户增加可用抵用额。 |
| lend | lend 的借用／需返还义不能自然以 account 作借用人；常见对象是贷给某人 money／credit，与这里向账户发放改期优惠不同。 |
| owe | owe a person credit／owe credit to a person 可表示欠某人款项或归功，但 `owe studio credit to your account` 不是向账户发放抵用额的自然搭配。 |

一致性：evidence 是实际宾语及介词结构；add credit → increase an account balance 准确；两种解析正确说明自愿改期所得抵用额。**无歧义。**

## read-bikes-01：precise 修正

读取时正文：`When you describe the problem, be as [2] as possible.`

读取时登记正答：`precisely`。**正确答案应为选项 D：precise。**

| 选项 | 实质判断 |
| --- | --- |
| precisely | 副词不能独立作这里 be 的主语补足语；`be as precisely as possible` 不成立。前面的 describe 属于 when 从句，不是当前空格的直接修饰对象。 |
| preciseness | 名词不能在 `be as ... as possible` 中直接充当程度形容词，不能表达“尽可能准确”。 |
| precision | 同为名词；若用该词需另外改为 with as much precision as possible，不能保持当前句型。 |
| precise | 形容词作 be 的表语，`be as precise as possible` 自然表示描述时尽量准确具体。 |

证据 `A detailed description helps the mechanic select tools in advance.` 在原文中，支持准确具体的描述，**可保留**。

当前 paraphrase `describe precisely → give a detailed account` 不是当前正确填空句型；当前 en/zh 均错误地宣称空格修饰 describe，须同步修正。建议：

- `answer`: `precise`
- `paraphrase`: `be as precise as possible → give an accurate, specific description`
- `en`: `The blank follows be and needs the adjective precise. As precise as possible means as accurate and specific as possible.`
- `zh`: `空格位于系动词 be 后，需要形容词 precise 作表语；be as precise as possible 表示“尽可能准确、具体”。`

原英文正文、题干、ID 和四个选项均无须改动。本条为明确答案／解析错误，已提前通知主代理。

### 主代理修正后的二次确认

同轮再次读取工作树，`read-bikes-01` 已由主代理改为 `answer: precise`。新的 evidence 是正文完整原句 `When you describe the problem, be as [2] as possible.`，能直接定位 be 后的表语空格；paraphrase 使用 `be as precise as possible → be as exact and specific as possible`；英文解析明确 linking verb be + adjective，中文解析同步区分 precise／precisely／preciseness／precision。**四项一致，修正通过。** 上节“读取时”描述保留用于追踪修复前后，不表示当前仍未修复。
