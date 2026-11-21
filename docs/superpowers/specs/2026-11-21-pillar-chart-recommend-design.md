# 支柱页按内容推荐图形 — 设计

日期：2026-11-21  
状态：已通过对话确认，待实现计划

## 问题

支柱页（`PillarPage`）固定并排列出流程 / 维恩 / 矩阵 / 金字塔 / 逻辑树五个编辑器。用户需要根据当前目的、视角与片段内容，由 AI 选出合适的一种主推展示，而不是始终罗列全部。

## 目标

1. 进入支柱页（或切换视角）时，AI 从五种结构图形中推荐一种并展开对应编辑器。
2. 其余图形收入「换一种图形」，可手动切换。
3. 若已有结构与推荐不一致，提示改用推荐或继续编辑现有；不自动删除旧结构。
4. 推荐失败不阻断编辑。

## 非目标

- 不由 AI 生成结构草稿（步骤、集合、轴等仍由编辑器手写保存）。
- 不把推荐结果写入工作区快照（偏好与手动覆盖留在客户端）。
- 不改变表达页 `ChartSelector` 的七种预览模型（含 classification / cycle）；本功能只服务支柱页五种编辑器。

## 候选图形

| 推荐值 | 编辑器 | 说明 |
|--------|--------|------|
| `flow` | `FlowEditor` | 含循环（cycle）场景，不单独推 cycle |
| `venn` | `VennEditor` | 对应结构类型 `sets` |
| `matrix` | `MatrixEditor` | |
| `pyramid` | `PyramidEditor` | |
| `logic_tree` | `LogicTreeEditor` | |

`classification`（支柱板）始终在页顶，不进推荐候选。

## 后端

### 接口

`POST /api/workspaces/{id}/recommend-chart`

请求：

```json
{ "base_revision": 12, "perspective_id": "…" }
```

成功响应：

```json
{
  "revision": 12,
  "chart": "flow",
  "reason": "材料偏阶段推进",
  "existing_charts": ["matrix"]
}
```

- `chart`：五选一（见上表）。
- `reason`：一句中文，供 UI 展示。
- `existing_charts`：当前视角已持久化的结构类型，映射为推荐值集合（`sets` → `venn`；`flow` → `flow`；有 feedback 边仍记为 `flow`）。
- `base_revision` 与当前不一致 → 409（与现有写/读惯例一致）。
- 视角不存在 → 与 visualization 读取相同的错误形态。

### 提示词与输出

- 新 prompt：`backend/src/ari/prompts/recommend_chart.md`。
- 上下文：purpose、active perspective（name/reason）、pieces 摘要、pillars、已有 visualization 类型。
- 输出模型：`{ chart, reason }`；非法 chart 按现有 LLM runner 校验失败处理。
- 独立于阶段聊天（不扩展 `PillarOutput` / `STAGE_ALLOWED_OPS`），避免与支柱建议/归属提案耦合。

### 失败

LLM 或网络失败：接口返回明确错误码；前端降级（见下），不写快照。

## 前端

### 布局（已选 A：单卡堆叠）

支柱板下方仅一张结构卡：

1. 标题行：`推荐：{图形名}` + `reason`（手动选中时改为当前图形名；可保留「AI 曾推荐 X」次要文案，可选）。
2. 对应编辑器默认展开。
3. `换一种图形 ▾` 展开其余四种；点选后切换主编辑器。

不再默认渲染五个并列 `<section>`。

### `activeChart` 优先级

1. URL `?editor=`（表达页「去补全」返回；`sets` → `venn`，其余同名映射）。
2. 用户本页手动选择（`chartPrefs.manualChart`）。
3. AI 推荐 `chart`。
4. 降级：`existing_charts[0]`，若空则 `flow`。

### `chartPrefs` 扩展（localStorage，按 workspace × perspective）

在现有 `ChartPrefs` 上增加：

- `manualChart: RecommendChart | null` — 非空则压过 AI。
- `dismissedConflictAtRevision: number | null` — 「继续编辑现有」时记为当时 revision；仅当该值等于当前 revision 时视为已关闭 banner。revision 前进后可再提示。

「重新推荐」：清除该视角的推荐内存缓存与 `manualChart`，再请求（不强制清 `dismissedConflictAtRevision`）。

### 推荐请求与缓存

- 触发：进入支柱页且已有 `active_perspective_id`；或切换视角。
- 缓存键：`(workspaceId, perspectiveId, revision)`；命中则不重复请求。
- 加载中：主卡骨架 +「正在推荐合适图形…」，暂不挂载编辑器，避免闪屏。

### 冲突 banner

同时满足时显示：

- AI 已返回；
- `existing_charts` 非空；
- 推荐值不在 `existing_charts` 中（或推荐对应结构为空而存在其他结构）；
- `dismissedConflict` 为 false；
- 尚无 `manualChart`。

动作：

- **改用推荐**：`activeChart = recommended`，写入 `manualChart`；不删除旧结构。
- **继续编辑现有**：`activeChart = existing_charts[0]`（多种已有时取列表第一种），`dismissedConflict = true`。

### 失败降级

推荐失败：toast/行内提示「推荐暂时不可用」；按优先级 4 选编辑器，页面可继续编辑。

## 测试

- 后端：prompt 上下文拼装；输出 schema；revision/视角错误；`existing_charts` 映射（含 `sets`→`venn`）。
- 前端：优先级链；「换一种」写入 `manualChart`；冲突双按钮；失败降级；换视角清 pending UI 状态。

## 决策记录

| 项 | 选择 |
|----|------|
| 推荐来源 | AI（目的 / 视角 / 片段），非纯规则 |
| 候选范围 | 五种编辑器全进候选 |
| 布局 | 单卡堆叠 +「换一种」 |
| 已有结构冲突 | 仍推荐；banner 二选一 |
| 实现形态 | 独立 `recommend-chart` 接口，进页自动请求 |
| 结构草稿 | 不生成 |
