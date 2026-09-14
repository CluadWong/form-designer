import type { InjectionKey, Ref } from "vue";
import type { TreeNode } from "../NodeTreeItem.vue";

/**
 * 结构树共享信号（折叠/展开 + 定位）。
 *
 * 设计器左侧结构树是 `NodeTreeItem` 递归组件，每个节点默认持有**局部**
 * `expanded` 状态（可单独展开/折叠）。要支持全局「折叠全部 / 展开全部」，
 * 需由一个统一信号驱动所有节点重设展开态：
 *
 * - `token`：每次触发「折叠全部 / 展开全部」自增 1，挂载中的 `NodeTreeItem`
 *   通过 `watch(token)` 把自己的局部 `expanded` 同步到 `target`；
 * - `target`：`true` = 展开，`false` = 折叠。新挂载的节点以当前 `target`
 *   作为初始态（例如「折叠全部」后再新增节点，新节点也应处于折叠态）。
 *
 * 单独的节点点击仍走局部 `onToggle`，与全局信号互不干扰；随后的全局操作
 * 会再次覆盖（符合「点折叠全部后，仍可单独展开某个节点」的预期）。
 *
 * 「定位」（画布点选 → 左侧结构树定位）复用同一信号对象：
 * - `focusId`：待定位的节点 id；
 * - `focusToken`：每次定位自增 1。`NodeTreeItem` 在 `token` 变化时判断
 *   `focusId` 是否落在自己的子树内，是则展开自己（保证目标行被渲染出来）；
 *   滚动到可见由 `PaletteSidebar` 负责（只有它持有 `.v2-tree` 容器）。
 *
 * 为什么拆成两个 ref 而不是一个 payload：`watch` 需要在**每次**定位都触发，
 * 而连续两次定位可能指向同一 id —— 只看 `focusId` 会漏掉第二次。`token`
 * 单调自增保证每次都驱动一轮副作用。
 */
export interface TreeControl {
  token: Ref<number>;
  target: Ref<boolean>;
  focusId: Ref<string | null>;
  focusToken: Ref<number>;
}

export const TreeControlKey: InjectionKey<TreeControl> = Symbol(
  "TicketDesigner.TreeControl",
);

/** `node` 自身或其任一后代是否为 `id`（`id` 为空返回 false）。 */
export function treeContainsId(node: TreeNode, id: string | null): boolean {
  if (!id) return false;
  if (node.id === id) return true;
  return node.children.some((child) => treeContainsId(child, id));
}

/** 滚动容器与目标行所需的最小结构（便于单测用假对象注入尺寸）。 */
export interface ScrollableView {
  clientHeight: number;
  scrollTop: number;
  getBoundingClientRect(): { top: number; bottom: number };
}

export interface Measurable {
  getBoundingClientRect(): { top: number; bottom: number };
}

/**
 * 计算「让 `row` 在 `view` 内可见」所需的最小滚动位移（就近滚动）。
 *
 * 取 `nearest` 语义：已在视野内不动；上方越界则上移，下方越界则下移，
 * 两侧各留 `padding` 像素余量。**只返回新的 `scrollTop`，不写 DOM**，
 * 便于单测（jsdom 无布局，真实 rect 恒为 0）。
 */
export function computeRevealScrollTop(
  view: ScrollableView,
  row: Measurable,
  padding = 4,
): number {
  const viewRect = view.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const current = view.scrollTop;
  const overflowTop = viewRect.top + padding - rowRect.top;
  if (overflowTop > 0) return Math.max(0, current - overflowTop);
  const overflowBottom = rowRect.bottom + padding - viewRect.bottom;
  if (overflowBottom > 0) return current + overflowBottom;
  return current;
}

/**
 * 把 `row` 就近滚动到 `view` 可见区域。返回是否真的发生了滚动
 * （测试与调用方可用于判断「已经在视野内」）。
 */
export function scrollRowIntoView(view: ScrollableView, row: Measurable, padding = 4): boolean {
  const next = computeRevealScrollTop(view, row, padding);
  if (next === view.scrollTop) return false;
  view.scrollTop = next;
  return true;
}
