import { useState } from "react";
import type { LogicTree, LogicTreeNode } from "../lib/types";

export function LogicTreeGraph({
  tree,
  pieces,
}: {
  tree: LogicTree;
  pieces: { id: string; text: string }[];
}) {
  const text = new Map(pieces.map((p) => [p.id, p.text]));
  const root = tree.nodes.find((n) => n.parent_id === null);
  const childrenOf = (id: string) => tree.nodes.filter((n) => n.parent_id === id);

  if (!root) {
    return <div className="card">树结构不完整</div>;
  }
  return (
    <div className="tree">
      <TreeNode node={root} childrenOf={childrenOf} text={text} depth={0} />
    </div>
  );
}

function TreeNode({
  node,
  childrenOf,
  text,
  depth,
}: {
  node: LogicTreeNode;
  childrenOf: (id: string) => LogicTreeNode[];
  text: Map<string, string>;
  depth: number;
}) {
  const [open, setOpen] = useState(true);
  const kids = childrenOf(node.id);
  return (
    <div className="tree-node" style={{ marginLeft: depth * 20 }}>
      <div className="tree-node__head">
        {kids.length ? (
          <button type="button" className="tree-node__toggle" onClick={() => setOpen((v) => !v)}>
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="tree-node__toggle" />
        )}
        <b>{node.text}</b>
      </div>
      {node.materials.length ? (
        <div className="tree-node__materials">
          {node.materials.map((m) => (
            <span key={m} className="graph-card">
              {text.get(m) ?? m}
            </span>
          ))}
        </div>
      ) : null}
      {open
        ? kids.map((k) => (
            <TreeNode key={k.id} node={k} childrenOf={childrenOf} text={text} depth={depth + 1} />
          ))
        : null}
    </div>
  );
}
