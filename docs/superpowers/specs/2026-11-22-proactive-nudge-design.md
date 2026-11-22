# 阿理主动引导（Nudge）设计

日期：2026-11-22
状态：已确认

## 背景与目标

当前侧边栏（`ChatPanel`）是纯被动的：用户提问 → 阿理回复 + 可选提案卡。本设计让阿理基于用户交互**主动**开口引导，覆盖三类时机：

1. **进入阶段**（`stage_entry`）：进入某阶段页且该阶段内容为空时，给出该阶段引导语和起步建议。
2. **结构问题**（`structure_issue`）：快照出现结构性问题（未归类片段过多、支柱缺失等）时提醒。
3. **停顿**（`idle`）：当前页长时间无操作且阶段内容不完整时，提供破局提示。

形式：作为阿理的消息直接出现在对话流中，可附带可采纳的提案卡（复用现有提案机制）。

触发机制为**混合式**：确定性规则判断触发时机，LLM 判断「值不值得打扰」并生成内容——沉默是合法输出。

## 架构（方案 A）

前端规则触发 + 后端 nudge 端点。

```
前端 useProactiveTrigger（规则 + 冷却）
  → POST /workspaces/{id}/nudges { request_id, stage, trigger, revision }
    → build_context + nudge 提示词 + 结构化输出（含 speak 字段）
      → speak=false：204，不落库，前端静默
      → speak=true：materialize + validate → 持久化消息（无用户提问）+ 可选提案
  → ChatPanel 渲染为阿理气泡（带「主动建议」标识），提案卡复用采纳/忽略/stale 逻辑
```

## 1. 触发层（前端）

新增 `frontend/src/lib/useProactiveTrigger.ts`，在各阶段页挂载。

- **`stage_entry`**：路由进入阶段页时触发；附加条件为该阶段内容为空（视角页无视角、支柱页无支柱等），避免对已有进展的页面重复开场白。
- **`structure_issue`**：订阅 workspace snapshot 变化，确定性规则检查。初始规则清单（独立模块，纯函数，便于增删与单测）：
  - 未归类片段 ≥ 5；
  - 激活视角下支柱数为 0 且片段 ≥ 3；
  - 目的为空但片段 ≥ 5。
- **`idle`**：当前页 90 秒无操作（无输入、无快照变更、无编辑区点击）且该阶段内容不完整；用户正在输入框打字时不触发。

**冷却与抑制**：

- 同一 `(触发源, 阶段)` 组合 5 分钟冷却，记在内存（页面刷新重置，可接受）。
- `sending` 为 true、或存在 pending 未处理提案时，一律不触发。
- AI 未配置（纯手工路径）时，前端不发 nudge 请求。

## 2. 后端端点

`POST /workspaces/{workspace_id}/nudges`

请求体：`{ request_id, stage, trigger, revision }`（`trigger ∈ stage_entry | structure_issue | idle`）。

流程复用 `send_message` 骨架：

- 复用 `build_context` 装配快照上下文 + 最近 6 条历史。
- 新增提示词 `prompts/nudge.md`，模板注入触发类型的自然语言说明（如「用户刚进入视角页且还没有视角」「用户停顿了一段时间」）。
- 输出模型 = 各阶段现有输出模型 + `speak: bool`：
  - `speak=false` → HTTP 204，不落库；
  - `speak=true` → 走现有 `materialize` + `validate_operations`，持久化消息 + 可选提案，响应结构与 `MessageResponse` 一致。
- 消息表：`question` 允许为空（存空串或 NULL），新增 `trigger` 列标记来源（沿用现有 PRAGMA 迁移模式补列）。
- 阶段操作权限沿用 `STAGE_ALLOWED_OPS`，主动消息权限不大于用户提问。
- LLM 未配置时端点直接返回 204。

## 3. 前端渲染

`ChatPanel` 对 `question` 为空的消息只渲染阿理气泡，加「主动建议」小标识；提案卡的采纳/忽略/过期重新生成完全复用现有逻辑。历史加载时主动消息随 `listMessages` 一起恢复。

## 4. 错误与竞态

- nudge 请求失败**静默丢弃**，仅控制台记日志——主动建议失败不值得打扰用户。
- nudge 响应到达时 revision 已前进：照常显示；提案若基于旧内容，现有 stale 机制兜底。
- 幂等：`request_id` 语义与 `send_message` 一致。

## 5. 测试

- 后端（pytest）：204 沉默路径；speak=true 落库路径（消息 + 提案）；阶段权限校验；LLM 未配置时返回 204；`trigger` 列迁移。
- 前端：规则清单纯函数单测；冷却逻辑单测；`npm run build` 类型检查。

## 不做的事（YAGNI）

- 不做后端事件日志 / SSE 推送（方案 B）。
- 不做「主动程度」用户设置开关（先按固定冷却跑，有需要再加）。
- 不做跨会话的冷却持久化。
