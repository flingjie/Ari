# 阿理主动引导（Nudge）设计

日期：2026-11-22（评审后修订）
状态：修订版待确认

## 背景与目标

当前侧边栏（`ChatPanel`）是纯被动的：用户提问 → 阿理回复 + 可选提案卡。本设计让阿理基于用户交互**主动**开口引导。

核心原则：**规则决定何时检查，LLM 决定是否发言，沉默是合法结果。** 最大的产品风险不是功能失效，而是阿理在不合适的时候开口——所有设计决策向「宁可少说」倾斜。

### 范围（第一版）

- **上线**：`stage_entry`（进入阶段）、`structure_issue`（结构信号）。
- **延后**：`idle`（停顿）只做轻量入口，不自动生成对话（见「分触发表现」）。

## 架构（方案 A）

前端规则触发 + 后端 nudge 端点，后端复核触发条件。

```
前端 useProactiveTrigger（候选信号 + 冷却 + 同轮只选一个触发）
  → POST /workspaces/{id}/nudges { request_id, stage, trigger, rule_id, revision }
    → 后端复核：request_id 去重、并发抑制、触发条件重查
    → build_context + recent_actions + nudge 提示词 + 结构化输出（含 speak）
      → speak=false：204，不落库，记录沉默缓存
      → speak=true：materialize + validate → 持久化消息（question=""，trigger 标记来源）+ 可选提案
  → 前端收到响应时若 revision 已前进 → 丢弃，不展示（保守策略）
  → ChatPanel 渲染为阿理气泡（带「主动建议」标识），提案卡复用采纳/忽略/stale 逻辑
```

## 1. 触发层（前端）

新增 `frontend/src/lib/useProactiveTrigger.ts` + 独立的规则模块（纯函数，可单测）。

### 候选信号（不是「问题认定」）

规则只产生**候选信号**——阈值命中说明值得检查，不代表用户需要帮助（未归类片段多可能正在集中收集；没有支柱可能在自下而上整理）。是否开口由 LLM 结合上下文判断。

- **`stage_entry`**：路由进入阶段页。
  - 该阶段为空且**前面阶段也没有内容**：显示固定文案的起步引导（纯 UI，不调模型、不写聊天历史）。
  - 该阶段为空但**前面阶段已有内容**：发起 nudge，让 LLM 基于已有内容生成个性化引导（如基于目的推荐候选视角）。
- **`structure_issue`**：订阅 snapshot 变化，初始信号清单：
  - 未归类片段 ≥ 5（`rule_id: unassigned_pieces`）；
  - 激活视角下支柱数为 0 且片段 ≥ 3（`rule_id: no_pillars`）；
  - 目的为空但片段 ≥ 5（`rule_id: purpose_empty`）。
- **`idle`**（轻提示，第一版不接 LLM）：页面**可见且窗口聚焦**时累计 90 秒无操作且阶段内容不完整，侧边栏显示一条轻量入口「需要一起梳理下一步吗？」；用户点击展开后才发起正常对话流程。90 秒是实验值，不解释为「用户遇到困难」。

### 冷却与抑制

- **同一轮只选一个触发**：多个信号同时满足时按优先级（structure_issue > stage_entry）只发起一次检查。
- **触发源冷却**：同一 `(rule_id, 阶段)` 5 分钟。
- **workspace 级发言冷却**：阿理任何一条主动消息发出后，全局 N 分钟（初始 3 分钟）内不再发起 nudge。
- `sending` 为 true 时不触发；存在**同阶段** pending 提案时不触发（其他阶段的遗留提案不阻止；用户可随时「忽略」提案解除抑制）。
- 用户正在输入框打字时不触发。
- AI 未配置（纯手工路径）时不发请求。

### 最近操作上下文

维护当前会话最近若干条（如 8 条）**语义操作**的环形缓冲（「新增片段×5」「把 3 个片段从支柱 X 移回待归类」「修改了目的」），随 nudge 请求发给后端。不建事件日志，不持久化。快照相似但动作不同时（刚收集完 vs 刚拆散分组），引导方向应不同——最近 6 条聊天历史不能替代编辑动作。

## 2. 后端端点

`POST /workspaces/{workspace_id}/nudges`

请求体：`{ request_id, stage, trigger, rule_id, revision, recent_actions: string[] }`。

### 后端复核（不信任前端判断）

- **幂等去重**：相同 `request_id` 直接返回首次结果，不重复调用 LLM、不重复落库（沿用现有收据模式）。
- **并发抑制**：同一 workspace 同时只允许一个 in-flight nudge，后到的直接 204。
- **条件复核**：按 `rule_id` 在当前快照上重查触发条件；不成立则 204（防多标签页、过期请求绕过前端冷却）。
- **沉默缓存**：`speak=false` 时记录 `(rule_id, 阶段, 相关内容指纹)`（内存即可）；相关内容未变化时同一信号再触发直接 204，不重复调用 LLM。

### 生成

- 复用 `build_context` + 最近 6 条聊天历史 + `recent_actions`。
- 新增提示词 `prompts/nudge.md`，注入 `trigger / rule_id / observed_values / recent_actions / stage` 的自然语言描述。
- 输出模型 = 各阶段现有输出模型 + `speak: bool`：
  - `speak=false` → HTTP 204；
  - `speak=true` → 现有 `materialize` + `validate_operations`，持久化消息 + 可选提案，响应结构同 `MessageResponse`。
- **消息存储**：`question` 存空串（列保持 NOT NULL，不重建表），新增可空 `trigger` 列作为主动消息判别字段（ALTER TABLE 补列，沿用现有迁移模式）。
- 阶段操作权限沿用 `STAGE_ALLOWED_OPS`。
- LLM 未配置时直接 204。

### 提示词质量约束（写入 nudge.md）

- 一次最多提出一个主要问题。
- 必须引用具体内容或最近操作，说明建议依据。
- 不推断用户情绪、能力或心理状态。
- 优先帮助用户澄清判断，其次才是结构修改提案。
- 素材不足时先询问，不生成看似真实的经历或证据。
- 没有明确增益时输出 `speak=false`。信号只是「值得看一眼」，不是「必须说点什么」。

## 3. 前端渲染与过时丢弃

- `ChatPanel` 对 `trigger` 非空的消息只渲染阿理气泡，加「主动建议」小标识；提案卡复用采纳/忽略/stale 逻辑；历史随 `listMessages` 恢复。
- **过时响应丢弃（保守策略）**：nudge 响应到达时，若本地 revision 已不等于请求时的 revision，**丢弃不展示**（消息已落库，历史中可见但不打断当前）。提案 stale 机制只保护操作，不保护文字内容的准确性——建议所依据的条件可能已不成立。细粒度的「条件是否仍成立」判断留给后续版本。
- nudge 请求失败静默丢弃，仅控制台记日志。
- nudge 进行中用户开始提问：用户消息正常发送，nudge 响应到达后按上述 revision 检查多半被丢弃；即使展示也排在用户轮次之后，不插入打断。

## 4. 测试

后端（pytest）：

- 204 沉默路径；speak=true 落库路径（消息 + 提案）。
- 相同 `request_id` 重试不重复调用 LLM、不重复落库。
- 后端条件复核：快照不满足 `rule_id` 条件时 204。
- 并发抑制：同 workspace 第二个 in-flight nudge 得到 204。
- 沉默缓存：内容指纹未变时不再调用 LLM。
- 阶段权限校验；LLM 未配置时 204。
- `trigger` 列迁移（旧库补列后读写正常）。

前端：

- 规则清单纯函数单测；三种信号同时满足只发起一次检查（优先级）。
- 触发源冷却 + workspace 级发言冷却。
- revision 前进后丢弃过时响应。
- nudge 生成期间用户提问，不被打断。
- `document.visibilityState` 为 hidden 或窗口失焦时 idle 计时暂停。
- `npm run build` 类型检查。

## 不做的事（YAGNI）

- 不做后端事件日志 / SSE 推送（方案 B）。
- 不做「主动程度」用户设置开关。
- 不做跨会话的冷却/沉默缓存持久化。
- 不做细粒度「建议条件是否仍成立」判断（第一版用 revision 变化一刀切丢弃）。
- 第一版 idle 不接 LLM，只做轻量入口。
- 不重建 messages 表（question 保持 NOT NULL，主动消息存空串）。
