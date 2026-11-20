// 领域类型：与后端 Pydantic 模型一一对应。

export type PieceKind = "quote" | "inferred";

export interface Piece {
  id: string;
  parent_id: string | null;
  text: string;
  order: number;
  source: string;
  kind: PieceKind;
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
  | { type: "update_piece"; piece_id: string; text: string }
  | { type: "remove_piece"; piece_id: string }
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
    };

export function newId(): string {
  return crypto.randomUUID();
}
