// 领域 pieces 树 ↔ jsMind node_array 互转。
// jsMind node_array 的根节点用 isroot:true 标记，其余节点用 parentid 指向父。

import type { Snapshot } from "./types";

export interface JsMindNodeData {
  id: string;
  topic: string;
  parentid?: string;
  isroot?: boolean;
}

export function piecesToNodeArray(snapshot: Snapshot): JsMindNodeData[] {
  return snapshot.pieces.map((p) => {
    if (p.id === snapshot.root_id) {
      return { id: p.id, isroot: true, topic: p.text };
    }
    return { id: p.id, parentid: p.parent_id ?? undefined, topic: p.text };
  });
}

// jsMind edit 事件 → 领域操作（由 Piece 页驱动提交）。
// jsMind 的 edit 事件 data 形状：
//   add_node:    data[0]=parentId, data[1]=newId, data[2]=topic
//   update_node: data[0]=id, data[1]=topic
//   remove_node: data[0]=removedId
export function editEventToOperation(
  evt: string,
  data: unknown[],
): import("./types").Operation | null {
  switch (evt) {
    case "add_node":
      return {
        type: "add_piece",
        id: String(data[1]),
        parent_id: String(data[0]),
        text: String(data[2]),
      };
    case "update_node":
      return { type: "update_piece", piece_id: String(data[0]), text: String(data[1]) };
    case "remove_node":
      return { type: "remove_piece", piece_id: String(data[0]) };
    default:
      return null;
  }
}
