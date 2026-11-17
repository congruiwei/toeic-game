# 逐选项释义与我的单词本

答后面板展示每一个实际选项的中文、日文、词性和中文选择理由。题目还未作答，或模考仍在进行时，主界面的 `reviewedAnswer` 门禁不会提供这些内容。模考提交后，只有打开的复查面板才触发加载。单词题沿用生成器已经决定的四个选项，不重新抽取或改变正确答案。

## 文件与数据结构

- `js/option-details.js`：按需加载、签名检查、动态词汇选项映射与逐项面板。
- `js/personal-vocab.js`：收藏快照、FSRS 同步、备份验证、四方向翻卡与个人本界面。
- `option-details.css`：答后面板和个人本样式，进入相关界面时加载。
- `data/options/{part1,part2,grammar,listening,reading}.json`：静态题的每个选项及理由。
- `data/options/vocab.json`：每张词卡的正确词头和三个填空干扰项的理由。
- `data/options/lexicon/{a..z,other}.json`：按规范化选项的首字母分片的词典。
- `data/options/authoring/*.json`：人工词典和复审后的逐项理由。
- `scripts/build-options.mjs`、`scripts/validate-options.mjs`：派生数据生成与完整覆盖校验。

静态包格式为：

```json
{
  "version": 1,
  "entries": {
    "question-id": {
      "signature": "source-signature",
      "context": "原题的英文句子或材料",
      "options": [
        {
          "text": "原样英文选项",
          "kind": "word",
          "lexical": "规范化词典键",
          "reasonZh": "具体解释该选项的词义、形式和题目中的依据。"
        }
      ]
    }
  }
}
```

`kind` 为 `word`、`phrase`、`sentence` 或 `position`。词典键是 NFKC、转小写、合并空格后的选项；题面拼写不改变。已有句子或短语译文用 `translationKeys` 指向现有双语包，短语另外记录 `pos`。`position` 是插入题的 `[1]` 等位置标记，不作为单词收藏。

词典中的每项有 `pos/zh/ja/lexemes`。`lexemes` 的每个义项包含 `id/word/pos/zh/ja`，已有词卡还带精确的 `wordId`、音标、原例句和可选的 `sense`。同词不同义项分别保留原词卡 ID；词性不同而释义也不同的库外词可以分别成条。屈折形式在显示时解释当前形式，收藏时可指向相应原形。`to applying / to enrolling / to trying` 的选项保留介词与不定式的区别说明，收藏目标则为 `apply / enroll / try`，避免把语法说明当作词义来背。非规范语法干扰项说明其问题并设置空 `lexemes`，不会收藏成错误词汇。

词汇填空包的每项为 `{signature,reasons:{exactOption:reasonZh}}`。其余六种词汇题型根据实际选项反查中文、日文、英文词头或 paraphrase，以精确词义作对照。日语词汇题只加载 `ja/vocab-meanings.json` 小包，不为选项释义下载完整词汇例句译包。

## 加载、版本与重试

`loadOptionDetails(ref,q,{vocab})` 只获取当前题型包、需要的词典字母分片以及相关已有译包。它返回 `context` 和有序 `options`；每项有 `text/kind/correct/reasonZh/pos/zh/ja/lexemes/collectible`，并提供 `spokenEnglish`。中文或日文释义选项的英文朗读使用对应词头，不能把中文题面交给英语声音。

选项包版本为 `1`。`optionSourceSignature(ref,q)` 将解析绑定到当前题干、选项、答案、依据和相关阅读／听力材料；源题发生改变时旧签名会被拒绝，不能静默套用旧解析。版本表示结构，签名表示内容，两者各自检查。

加载成功的包保存在内存和浏览器 Cache API 的 `toeic-island-option-details-v1` 中。网络读取失败时可复用已访问的离线包。合法但过期的离线包也可能与现题签名不符，因此可见“重试”必须调用 `invalidateOptionDetails()`，或使用 `loadOptionDetails(...,{refresh:true})`。失效操作清空内存并让下一次请求重新读取网络，但保留离线包和每个包的写入队列。旧请求尚未写入时按代号跳过；已开始的 `Cache.put` 不能取消，新代写入排在它完成之后，避免旧写入晚到覆盖新结果。失败写入不清空原缓存，也不阻断后续写入。Service Worker 只负责联网读取及离线回退，不独立写选项缓存，HTML或无效包不会借此覆盖已有数据。没有读过的释义包仍需首次联网下载。

## 新增词义与逐项理由

1. 保持既有英文题目与 ID 不变。需要词汇释义时，在 `authoring` 的词典数组加入 `{word,pos,zh,ja}`。实际词性不能从目标词或题目主题照抄。若名词和动词含义不同，分别写出，避免将 handle 的“把手”名词义用到 handling 的动词形式上。
2. 规则无法安全推导的新词形或多词性用法应补明确条目／推导规则，不能填空白或通用占位释义。仍缺少实际选项时生成器会失败。
3. 在 `authoring/reasons-static.json` 或 `authoring/reasons-vocab.json` 写 `{questionId:{"原样选项":"具体中文理由"}}`。说明选项表达什么、原文或句式需要什么、为何相合或不相合；插入题解释实际指代和信息顺序，NOT 题区分“有依据”与“题目要找的例外”。若既有源题有合理第二读法，应明确记录，不能把可成立的句子解释成语法错误。
4. 运行生成器。它保留人工逐项修订并补充其他既有解释；不要只修改生成文件，否则下次重建会覆盖。
5. 运行校验，并人工代入每一个被修改的干扰项。结构校验不能替代语义检查。

```sh
node scripts/build-options.mjs
node scripts/validate-options.mjs
node --test tests/option-details.test.mjs tests/option-personal.test.mjs
```

`--inspect` 只将缺词和词典预览写到临时目录，方便排查，不输出有缺项的运行时包。校验器导出 `validateOptionsFiles(root)`，供主校验调用，返回 `{errors,summaries,questionCount,optionCount,lexicalCount}`。它覆盖全部静态选项、所有词汇填空和易混词、精确义项映射、现有译文键以及源签名。缺整包或缺一项都报错。

覆盖测试实际生成七种词汇题型，并为每题的每个实际选项加载解析；还检查多义词准确映射、离线缓存、过期缓存显式刷新、逆序网络响应、失效时已进行中的持久写入、写入失败后的恢复、初次失败后的重试和 HTML 转义。`tests/options-offline.cjs` 使用真实 Service Worker 与服务器延迟的旧响应，核对刷新后的包不被覆盖、HTML错误页回退及离线冷重开；支持 Chromium 和 `PW_ENGINE=webkit`。个人本测试检查重复收藏、旧档与非法导入、退役 ID、断点、共享 FSRS、客观统计不变和安全删除。

## 存档与 FSRS

游戏存档版本为 `6`，新增字段自身采用版本 `1`：

```js
personalVocab: {
  version: 1,
  items: [{
    key, wordId: null, word, pos, zh, ja,
    // 可选：sense、ipa、example
    source: { id, mode, context, option },
    addedAt,
    fsrs
  }],
  run: null // 或 {direction, keys, index, flipped}
}
```

已知词卡的 `wordId` 为精确原 ID，`key` 与它相同；个人简卡的 `wordId` 为 `null`，使用稳定词条键。快照保存收藏时的英文、双语释义、词性、原例句及来源上下文；它不依赖原题再次出现在目录中。每本最多 10,000 条，单次翻卡最多 20 条。

列表首次显示 50 条，点「再显示」增加最多 50 条；搜索始终匹配整个词本，搜索条件改变或重新进入时重置显示数。展示数量只保存在当前界面内存，不改变收藏、统计或 FSRS 队列。中日输入法组合输入期间保留同一个输入节点，等 `compositionend` 后才筛选，避免候选词尚未确认时重绘输入框。

`collectPersonalWord` 对已有收藏保持幂等。新收藏创建未评分的 FSRS New 卡，到期时间为当前时间；收藏本身不等于正确回答或 Easy。已知词卡保留原复习状态，个人简卡独立调度。

`beginPersonalVocab` 按到期时间取卡，优先取到期项；没有到期项时允许自由练习。四个方向为英→中、中→英、英→日、日→英。未翻面不能评分，刷新或导入后保留方向、序号和翻面状态。`ratePersonalWord` 使用共用 FSRS 调度器及当前目标记忆率，已知词卡同步 `fsrs/due/box`，但自评不增加 `tries/right`、客观题正确率、XP 或估分；这与做客观选择题是不同记录。

保存和导出之前调用 `syncPersonalVocab(s)`，也必须在清理退役题目 ID 之前调用。这样，正常词汇练习更新的 FSRS 会先同步进收藏快照。原 ID 退役后，个人本使用自己的快照继续复习，不在普通词汇进度中重新创建这个退役 ID。

旧备份只有在 `personalVocab` 字段确实不存在时，才补入空本。已经存在但版本、字段、重复键、来源、FSRS 或断点格式错误的个人本会使导入失败，不会悄悄清空。JSON 导出包含完整收藏快照和复习断点，换设备后不依赖旧题仍然存在。删除收藏只删除个人本条目及相关断点键，不删除已有词卡的学习进度。
