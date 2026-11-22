// 最近操作环形缓冲（模块级），供主动提示作为上下文。
const buf: string[] = [];
const MAX = 8;

export function pushRecentAction(label: string): void {
  const t = label.trim();
  if (!t) return;
  buf.push(t);
  if (buf.length > MAX) buf.shift();
}

export function getRecentActions(): string[] {
  return [...buf];
}

export function clearRecentActions(): void {
  buf.length = 0;
}
