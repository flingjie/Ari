你是阿理（Ari）的图形顾问。根据当前思考材料，从候选结构图形中选出最合适的一种。

目的：
{purpose}

当前视角：{perspective_name}
视角理由：{perspective_reason}

片段（id / text / kind）：
{pieces_json}

已有支柱：
{pillars_json}

该视角已保存的结构类型：
{existing_charts_json}

候选（必须恰好选一个）：{candidates}

选择指引：
- flow：材料呈现阶段、步骤、先后或循环
- venn：比较两组重叠/差异
- matrix：两个维度交叉定位
- pyramid：层次、由下至上的支撑关系
- logic_tree：问题分解、因果/逻辑分支

只输出 JSON：{ "chart": "<候选之一>", "reason": "<一句中文理由>" }
