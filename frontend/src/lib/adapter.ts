// 领域 pieces 树 ↔ jsMind node_array 互转。
// jsMind node_array 的根节点用 isroot:true 标记，其余节点用 parentid 指向父。
// jsMind 加载时先 reverse 再倒序遍历（两者抵消），故同级顺序 = 数组相对顺序。

import type { Operation, Piece, Snapshot } from "./types";

export interface JsMindNodeData {
  id: string;
  topic: string;
  parentid?: string;
  isroot?: boolean;
  direction?: string; // 仅主题直接子节点："left" | "right"
}

// 复刻 jsMind 0.8.7 calculate_next_child_direction 的自动布局规则（full 双侧模式）：
// 右偏平衡 → R, R, L, L, R, L, R, L, …。用于旧快照（side 缺省）补齐左右分侧。
function autoLayoutSides(ids: string[]): Record<string, "left" | "right"> {
  const sides: Record<string, "left" | "right"> = {};
  let count = 0;
  let total = 0; // right=+1，left=-1
  for (const id of ids) {
    const side: "left" | "right" = count > 1 && total > 0 ? "left" : "right";
    sides[id] = side;
    total += side === "right" ? 1 : -1;
    count += 1;
  }
  return sides;
}

// 按 order 稳定排序，返回 parent_id 的直接子节点。
function sortedChildren(snapshot: Snapshot, parentId: string): Piece[] {
  return snapshot.pieces
    .filter((p) => p.parent_id === parentId)
    .sort((a, b) => a.order - b.order);
}

export function piecesToNodeArray(snapshot: Snapshot): JsMindNodeData[] {
  const nodes: JsMindNodeData[] = [];
  const rootChildren = sortedChildren(snapshot, snapshot.root_id);
  const auto = autoLayoutSides(rootChildren.map((p) => p.id));

  // 深度优先，兄弟按 order 排序后逐层展开。
  const emit = (pieceId: string) => {
    const p = snapshot.pieces.find((x) => x.id === pieceId);
    if (!p) return;
    if (p.id === snapshot.root_id) {
      nodes.push({ id: p.id, isroot: true, topic: p.text });
    } else {
      const node: JsMindNodeData = {
        id: p.id,
        parentid: p.parent_id ?? undefined,
        topic: p.text,
      };
      if (p.parent_id === snapshot.root_id) {
        node.direction = p.side ?? auto[p.id] ?? "right";
      }
      nodes.push(node);
    }
    for (const child of sortedChildren(snapshot, p.id)) emit(child.id);
  };

  emit(snapshot.root_id);
  return nodes;
}

// 移除被拖节点后，目标父下的首个同级锚点（用于 _first_）。
function firstSiblingAfterMove(
  snapshot: Snapshot,
  parentId: string,
  movedId: string,
): string | null {
  const siblings = sortedChildren(snapshot, parentId).filter((p) => p.id !== movedId);
  return siblings.length ? siblings[0].id : null;
}

// jsMind edit 事件 → 领域操作（由 Piece 页驱动提交）。
// jsMind 的 edit 事件 data 形状：
//   add_node:    data[0]=parentId, data[1]=newId, data[2]=topic
//   update_node: data[0]=id, data[1]=topic
//   remove_node: data[0]=removedId
//   move_node:   data[0]=nodeId, data[1]=beforeId, data[2]=parentId, data[3]=direction
export function editEventToOperation(
  evt: string,
  data: unknown[],
  snapshot?: Snapshot | null,
): Operation | null {
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
    case "move_node": {
      const pieceId = String(data[0]);
      const beforeId = String(data[1] ?? "_last_");
      const parentId = String(data[2]);
      const direction = Number(data[3]);
      let beforePieceId: string | null;
      if (!beforeId || beforeId === "_last_") {
        beforePieceId = null;
      } else if (beforeId === "_first_") {
        beforePieceId = snapshot ? firstSiblingAfterMove(snapshot, parentId, pieceId) : null;
      } else {
        beforePieceId = beforeId;
      }
      // side 仅主题直接子节点有效：非根目标的 direction 是继承值，不写 side。
      const side: "left" | "right" | null =
        snapshot && parentId === snapshot.root_id
          ? direction === -1
            ? "left"
            : direction === 1
              ? "right"
              : null
          : null;
      return {
        type: "move_piece",
        piece_id: pieceId,
        parent_id: parentId,
        before_piece_id: beforePieceId,
        side,
      };
    }
    default:
      return null;
  }
}
