# 阿理（Ari）契约

冻结的路由、领域操作与数据模型。前端与后端按此契约各自实现、独立启动。

## 路由

| 前端路由 | 页面 |
|---|---|
| `/` | 新建（空白 / 教程示例） |
| `/w/{id}/{stage}` | stage ∈ purpose / piece / perspective / pillar / presentation |

## 数据模型（快照 JSON）

```json
{
  "purpose": "",
  "root_id": "root",
  "active_perspective_id": null,
  "pieces": [{"id", "parent_id", "text", "order", "source", "kind", "side?"}],
  "perspectives": [{"id", "name", "reason"}],
  "pillars": [{"id", "perspective_id", "name", "order"}],
  "assignments": [{"perspective_id", "piece_id", "pillar_id"}]
}
```

- `pieces.parent_id` 树表示采集上下文；根节点 `parent_id` 为 null。
- `pieces.kind` ∈ quote（用户原话）/ inferred（AI 推测）。
- `pieces.side` ∈ left / right / null；仅主题直接子节点有效，标记双侧布局下的分侧；null 由前端按 jsMind 自动布局规则推导。
- `assignments.pillar_id` 为 null 即「待归类」；`(perspective_id, piece_id)` 至多一条。

## 领域操作（PATCH 与 AI 提案共用）

| type | 载荷 | 说明 |
|---|---|---|
| set_purpose | text | 目的 |
| add_piece | id, parent_id, text, order?, source?, kind? | 新增片段 |
| update_piece | piece_id, text, source? | 改写片段/主题；source 缺省不改，传字符串（含空）则写入 |
| remove_piece | piece_id | 删子树 + 各视角归属；禁删根 |
| move_piece | piece_id, parent_id, before_piece_id?, side? | 重挂父节点 + 同级排序；before 为 null 追加末尾；禁根/自挂/环/锚点非法；side 仅主题直接子节点 |
| add_perspective | id, name, reason? | 新增视角 |
| update_perspective | id, name?, reason? | 改名/理由 |
| set_active_perspective | id | 选中视角 |
| add_pillar | id, perspective_id, name, order? | 新增支柱 |
| rename_pillar | id, name | 改名 |
| remove_pillar | id | 其归属归「待归类」 |
| assign_piece | perspective_id, piece_id, pillar_id? | 归属；null=待归类 |

非法引用 → 422；版本不符 → 409（携带 current_revision）；同 request_id 不同载荷 → 409。

## API（相对 `/api/workspaces`）

| 方法与路径 | 输入 | 返回 |
|---|---|---|
| POST `/` | `{template}`（空或 `tutorial`） | `{id, revision, snapshot}` |
| GET `/{id}` | — | `{id, revision, snapshot, proposals[]}` |
| PATCH `/{id}` | `{request_id, base_revision, operations[]}` | `{revision, snapshot}` |
| POST `/{id}/messages` | `{request_id, stage, question, base_revision, piece_id?}` | `{reply, proposal_id, revision, proposal?}` |
| GET `/{id}/messages` | `?limit=30&before=<cursor>` | `{messages[], next_before?}`（页面内正序） |
| POST `/{id}/proposals/{pid}/resolve` | `{request_id, base_revision, action, operations?}` | `{revision, snapshot, status}` |
| GET `/{id}/export` | `?revision&perspective_id&format=outline\|table` | `{revision, format, content}` |
| POST `/{id}/recommend-chart` | `{base_revision, perspective_id}` | `{revision, chart, reason, existing_charts[]}` |

`action` ∈ accept / edit / ignore。`edit` 需携带 `operations`（改写后的变更集）。

多轮上下文：发送时服务端读同工作区最近 6 轮已完成问答注入提示词；`piece_id` 引用须属于该工作区且存在于当前快照。

旧提案：accept/edit 要求提案自身 `base_revision` 与当前 `revision` 一致，否则 409（`reason="proposal_stale"`）；ignore 对过期提案仍允许。重复 resolve 按 `request_id` 幂等返回原结果。

## 导出格式

- outline：`# {purpose}` → `视角 · {name}` → 各支柱 `## {name}` + `- {片段}`，空组显示「暂无材料」，最后「待归类」。
- table：`| 支柱 | 材料 |` 表格；竖线转义为 `\|`，换行折叠为空格。
- 前端预览与下载都用后端同一文本。

## 幂等与并发

写请求带 `request_id` + `base_revision`。服务端在事务内：查幂等收据 → 校验版本 → 应用操作 → 写快照与收据 → 提交。重复请求返回原结果；版本不符返回 409。
