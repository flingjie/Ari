// 领域类型：与后端 Pydantic 模型一一对应。

export type PieceKind = "quote" | "inferred";

export interface Piece {
  id: string;
  parent_id: string | null;
  text: string;
  order: number;
  source: string;
  kind: PieceKind;
  side: "left" | "right" | null;
}

export interface Perspective {
  id: string;
  name: string;
  reason: string;
}

export interface Pillar {
  id: string;
  perspective_id: string;
  name: string;
  order: number;
}

export interface Assignment {
  perspective_id: string;
  piece_id: string;
  pillar_id: string | null;
}

export interface Snapshot {
  purpose: string;
  root_id: string;
  active_perspective_id: string | null;
  pieces: Piece[];
  perspectives: Perspective[];
  pillars: Pillar[];
  assignments: Assignment[];
  visualizations: Visualization[];
}

// 分组结果（与后端 domain/grouping.py 的 GroupedView 对齐）。
export interface GroupedPiece {
  id: string;
  text: string;
}

export interface GroupedPillar {
  id: string;
  name: string;
  order: number;
  pieces: GroupedPiece[];
}

export interface GroupedPerspective {
  id: string;
  name: string;
}

export interface GroupedView {
  purpose: string;
  perspective: GroupedPerspective;
  pillars: GroupedPillar[];
  unassigned: GroupedPiece[];
}

// —— 可视化关系结构（与后端 models.py 对齐）——

export type VisualizationType = "flow" | "sets" | "matrix" | "pyramid" | "logic_tree";

export interface FlowStep {
  id: string;
  text: string;
  pillar_id: string | null;
}

export interface FlowBranch {
  id: string;
  from_step_id: string;
  to_step_id: string;
  condition: string;
}

export interface FlowFeedback {
  id: string;
  from_step_id: string;
  to_step_id: string;
  meaning: string;
}

export interface Flow {
  type: "flow";
  perspective_id: string;
  steps: FlowStep[];
  branches: FlowBranch[];
  feedback: FlowFeedback[];
}

export interface VennSet {
  id: string;
  name: string;
}

export interface SetMember {
  piece_id: string;
  region: "a" | "b" | "both";
}

export interface SetsStructure {
  type: "sets";
  perspective_id: string;
  set_a: VennSet;
  set_b: VennSet;
  members: SetMember[];
}

export interface MatrixAxisValue {
  id: string;
  name: string;
}

export interface MatrixAxis {
  id: string;
  name: string;
  values: MatrixAxisValue[];
}

export interface MatrixCoordinate {
  piece_id: string;
  x_value_id: string;
  y_value_id: string;
}

export interface MatrixStructure {
  type: "matrix";
  perspective_id: string;
  x_axis: MatrixAxis;
  y_axis: MatrixAxis;
  coordinates: MatrixCoordinate[];
}

export interface PyramidPoint {
  id: string;
  text: string;
  pillar_id: string | null;
  evidence: string[];
}

export interface Pyramid {
  type: "pyramid";
  perspective_id: string;
  conclusion: string;
  points: PyramidPoint[];
}

export interface LogicTreeNode {
  id: string;
  text: string;
  parent_id: string | null;
  materials: string[];
}

export interface LogicTree {
  type: "logic_tree";
  perspective_id: string;
  nodes: LogicTreeNode[];
}

export type Visualization =
  | Flow
  | SetsStructure
  | MatrixStructure
  | Pyramid
  | LogicTree;

export type ChartType =
  | "classification"
  | "flow"
  | "cycle"
  | "venn"
  | "matrix"
  | "pyramid"
  | "logic_tree";

export type RecommendChart =
  | "flow"
  | "venn"
  | "matrix"
  | "pyramid"
  | "logic_tree";

export interface RecommendChartResult {
  revision: number;
  chart: RecommendChart;
  reason: string;
  existing_charts: RecommendChart[];
}

export type FillTarget = "perspective" | "pillar";

export interface MissingField {
  code: string;
  message: string;
  target: FillTarget | null;
}

export interface ChartStatus {
  chart: ChartType;
  status: "ready" | "available" | "missing";
  missing: MissingField[];
}

export interface VisualizationView {
  purpose: string;
  perspective: GroupedPerspective;
  charts: ChartStatus[];
  flow: Flow | null;
  sets: SetsStructure | null;
  matrix: MatrixStructure | null;
  pyramid: Pyramid | null;
  logic_tree: LogicTree | null;
}

export type Stage =
  | "purpose"
  | "piece"
  | "perspective"
  | "pillar"
  | "presentation";

export const STAGES: Stage[] = [
  "purpose",
  "piece",
  "perspective",
  "pillar",
  "presentation",
];

export const STAGE_NAMES: Record<Stage, string> = {
  purpose: "目的",
  piece: "片段",
  perspective: "视角",
  pillar: "支柱",
  presentation: "表达",
};

// 领域操作（与后端 discriminated union 对齐）。
export type Operation =
  | { type: "set_purpose"; text: string }
  | {
      type: "add_piece";
      id: string;
      parent_id: string;
      text: string;
      order?: number;
      source?: string;
      kind?: PieceKind;
    }
  | { type: "update_piece"; piece_id: string; text: string; source?: string }
  | { type: "remove_piece"; piece_id: string }
  | {
      type: "move_piece";
      piece_id: string;
      parent_id: string;
      before_piece_id: string | null;
      side?: "left" | "right" | null;
    }
  | { type: "add_perspective"; id: string; name: string; reason?: string }
  | {
      type: "update_perspective";
      id: string;
      name?: string | null;
      reason?: string | null;
    }
  | { type: "set_active_perspective"; id: string }
  | {
      type: "add_pillar";
      id: string;
      perspective_id: string;
      name: string;
      order?: number;
    }
  | { type: "rename_pillar"; id: string; name: string }
  | { type: "remove_pillar"; id: string }
  | {
      type: "assign_piece";
      perspective_id: string;
      piece_id: string;
      pillar_id: string | null;
    }
  | { type: "set_flow"; structure: Flow }
  | { type: "remove_flow"; perspective_id: string }
  | { type: "set_sets"; structure: SetsStructure }
  | { type: "remove_sets"; perspective_id: string }
  | { type: "set_matrix"; structure: MatrixStructure }
  | { type: "remove_matrix"; perspective_id: string }
  | { type: "set_pyramid"; structure: Pyramid }
  | { type: "remove_pyramid"; perspective_id: string }
  | { type: "set_logic_tree"; structure: LogicTree }
  | { type: "remove_logic_tree"; perspective_id: string };

export function newId(): string {
  return crypto.randomUUID();
}
