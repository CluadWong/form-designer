/**
 * 节点地址契约（C2 / A5 分层重构）
 *
 * 渲染内核（renderer-v2）为每个可被设计器交互的节点输出两类定位属性，
 * 设计表面层（designer/CanvasSurface 及 FormDesigner 的拖拽/选中逻辑）据此反查节点与所属格。
 * 内核负责"暴露稳定地址"，表面层负责"交互"——这是内核与表面层之间唯一可接受的边界
 * （分层约束见 docs/design.md）。
 *
 * 约定：
 * - `data-node-id`：每个可交互节点的唯一 id（page / grid / row? 否 / cell / p / text / table / html / image）。
 *   注意 row 本身不挂 data-node-id（行是 Grid 的内部布局结构，不可独立选中），但其父 Grid 与子 cell 均挂。
 * - `data-layout-id`：Grid 的 Row 与 Cell、以及 Table 单元格模板的布局定位 id，用于拖拽落点判定
 *   （`closest("[data-layout-id]")` 命中目标格 / 行）。
 *
 * 消费方应使用下方常量与选择器辅助函数，避免在多处硬编码属性名字符串导致静默失效。
 */
export const NODE_ID_ATTR = "data-node-id" as const;
export const LAYOUT_ID_ATTR = "data-layout-id" as const;
/**
 * 物理页所属的**逻辑页** id（2026-10-23）。
 *
 * 分页后一张逻辑页会切成多张物理纸，`data-node-id` 是合成 id（首张复用逻辑页 id，
 * 其余 `${pageId}__pp1`…），schema 里查不到 → 点第 2 页起选不中「页面」。
 * 纸张上额外输出本属性，让表面层能直接把「哪张纸」映射回「哪个逻辑页」。
 */
export const SOURCE_PAGE_ID_ATTR = "data-source-page-id" as const;
/** 模板面板拖拽到画布时写入 dataTransfer 的 MIME（设计器侧源）。 */
export const PALETTE_DRAG_MIME = "application/x-ticket-node-kind" as const;

/** 选中某节点的 CSS 选择器，如 `[data-node-id="unit-field"]`。 */
export function nodeIdSelector(id: string): string {
  return `[${NODE_ID_ATTR}="${id}"]`;
}

/** 命中某布局格/行的 CSS 选择器，如 `[data-layout-id="cell-u-l"]`。 */
export function layoutIdSelector(id: string): string {
  return `[${LAYOUT_ID_ATTR}="${id}"]`;
}

/** 命中某逻辑页的所有物理纸的 CSS 选择器，如 `[data-source-page-id="page-1"]`。 */
export function sourcePageIdSelector(pageId: string): string {
  return `[${SOURCE_PAGE_ID_ATTR}="${pageId}"]`;
}
