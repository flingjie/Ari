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
  piece: "先记下事实、例子和疑问。点开卡片补来源，并问阿理：这条能说明什么、还不能说明什么。需要看层级时切换「导图总览」。",
  perspective: "选择一个能帮助你回答问题的视角，下一步按它整理材料。",
  pillar: "把素材拖进支柱。点开卡片讨论归属是否成立；用「检查缺口」看哪些组还缺证据。",
  presentation: "选择表达形式，预览后导出当前结果。",
};
