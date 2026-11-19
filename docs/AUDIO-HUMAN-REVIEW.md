# 人工听审与新版回听

人工判断和自动转写分开保存。`data/audio/human-review.json` 保存用户实际评价过的 `token + SHA-256 + 原文`；“没问题”只批准那一个录音，不能传给同题的新版。原始 ASR 的 `recognized`、模型、参数、指纹与状态不会因人工批准而改写。

本批以公开复听队列 `0514db9b` 为基准，50 条逐项核对当前实际文件 SHA：42 条“没问题”、6 条“有问题”、2 条“听不出来”。42 条原录音保持不变。另 8 条换用已选 Heart 音色或清楚的独立字母读法，原题文字不改；现行媒体均与被评价的旧 SHA 不同。

8 条均有完整 `large-v3` 固定模型、CPU int8、单文件 beam size 5、无提示词的实际识别证据，结果为 4 matched、4 review；同媒体的真实识别缓存可复用，本轮实际新增 6 次识别调用。**8 条全部进入新版回听队列**，即使自动转写 matched 也不自动视为人工通过。旧意见按旧 SHA 保留，手机端不会把旧版“没问题”自动套到新版。

## 账本与刷新

```json
{
  "version": 1,
  "batches": [{"id": "batch-id", "source": "判定来源", "queueSha256": "64位SHA", "count": 1}],
  "feedback": [{"token": "en:labels:labels/am_puck/B", "sha256": "64位SHA", "text": "B.", "label": "ok", "batchId": "batch-id"}],
  "requests": [{"token": "ja:vocab:v-example/meaning", "sha256": "64位SHA", "text": "原日文", "reason": "新版日语录音，待人工复听", "origin": "manual-kana"}]
}
```

`label` 仅允许 `ok`、`problem`、`unsure`。反馈批次记录数、重复项、原文及 SHA 均校验。`requests` 用于主动要求复听已发布的新录音；不要给不可访问的失败候选或系统后备添加请求。有反馈或请求的键再换媒体后仍需复听。新一批人工反馈应追加保存，只有最新的明确批准且 SHA 完全相同才可移出队列。

作者全部停止后按顺序运行：

```sh
"$TOEIC_TTS_DIR/venv/bin/python" scripts/generate-bank-audio.py --sync-only
node scripts/archive-bank-audio-history.mjs
node scripts/archive-bank-audio-history.mjs --apply
node scripts/build-review-queue.mjs
node scripts/build-review-queue.mjs --check
node scripts/validate-bank-audio.mjs
```

`--sync-only` 不运行模型。索引的 `humanApprovedCount` 与 `forcedHumanReviewCount` 独立于 ASR 数量；默认发布校验仍要求实际 ASR 和历史版本证据齐全。严格质量模式保留所有待人工复听项。JavaScript 与 Python 使用一致的人工审核语义；新增英语句子/字母换声仅允许代码中明确列出的七个已评价来源，按键、原文、原声音三者同时匹配，未开放一般对话换声。

## 历史恢复

JavaScript JSON 写入会把 `0.0` 序列化为 `0`。修复历史引用额外保存原来被哈希的 canonical payload；恢复必须先验证原 SHA，再比较完整 JSON 语义，只允许整数与等值浮点数的表示差异。布尔值、转写、音频、声音、来源或任何其他字段变化均拒绝。归档注记只能包含与该历史 clip 精确一致的 SHA、字节数和已核验复制标记，不替代原始 ASR。完整模型补充证明同样使用已保存的 canonical/fingerprint 输入，避免正常归档使原证据失效。
