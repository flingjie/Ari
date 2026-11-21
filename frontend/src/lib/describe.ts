// 把提案的 change_set 渲染成可读中文清单，用快照解析 id → 名称/文本。

import type { Operation, Snapshot } from "./types";

function pieceText(s: Snapshot, id: string): string {
  const p = s.pieces.find((x) => x.id === id);
  return p ? p.text : id;
}

function pillarName(s: Snapshot, id: string | null): string {
  if (id === null) return "待归类";
  const p = s.pillars.find((x) => x.id === id);
  return p ? p.name : id;
}

function perspectiveName(s: Snapshot, id: string): string {
  const p = s.perspectives.find((x) => x.id === id);
  return p ? p.name : id;
}

export function describeChangeSet(ops: Operation[], snapshot: Snapshot): string[] {
  return ops.map((op) => {
    switch (op.type) {
      case "set_purpose":
        return "改写目的";
      case "add_piece":
        return `新增片段「${op.text}」`;
      case "update_piece":
        return `改写片段「${pieceText(snapshot, op.piece_id)}」`;
      case "remove_piece":
        return `删除片段「${pieceText(snapshot, op.piece_id)}」`;
      case "add_perspective":
        return `新增视角「${op.name}」`;
      case "update_perspective":
        return `修改视角「${perspectiveName(snapshot, op.id)}」`;
      case "set_active_perspective":
        return `切换到视角「${perspectiveName(snapshot, op.id)}」`;
      case "add_pillar":
        return `新增支柱「${op.name}」`;
      case "rename_pillar":
        return `改名支柱「${pillarName(snapshot, op.id)}」`;
      case "remove_pillar":
        return `删除支柱「${pillarName(snapshot, op.id)}」`;
      case "assign_piece":
        return `将「${pieceText(snapshot, op.piece_id)}」移至「${pillarName(snapshot, op.pillar_id)}」`;
    }
  });
}
