import type { Stage } from "./types";

export const STAGE_TITLES: Record<Stage, string> = {
  purpose: "这次想理清什么？",
  piece: "把手头的片段摊开",
  perspective: "从哪个角度看？",
  pillar: "给材料找到位置",
  presentation: "把思路说清楚",
};

export const STAGE_HINTS: Record<Stage, string> = {
  purpose: "写下一个具体问题，以及这次整理将帮助你做什么。",
  piece: "点选节点添加分支。双击节点可改写，手机上也可点「编辑节点」。",
  perspective: "选择一个能帮助你回答问题的视角，下一步按它整理材料。",
  pillar: "修改分组名称，用片段旁的菜单调整归属。",
  presentation: "选择表达形式，预览后导出当前结果。",
};
