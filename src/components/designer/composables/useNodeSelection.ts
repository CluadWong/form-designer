/**
 * 设计器选择态：当前选中节点、层级循环选中、结构树构建、插入槽判定。
 *
 * 从 `FormDesigner.vue` 抽出（2026-09-07 批次 1 拆分）：只管「选的是谁」，
 * 不负责改 schema（改结构在 `useSchemaEdits`），也不渲染任何 DOM。
 *
 * 选中规则：
 * - `grid-row` 只是布局容器，不进树、不可选中；
 * - `grid-cell` 可选中（仅样式可编辑、不可删除）；
 * - Table 行模板内的节点不可单独选中，点击归到所属 Table。
 */
import { computed, ref, type Ref } from "vue";
import {
  buildEditorNodeIndexV2,
  isSelectableSchemaNodeV2,
} from "@/types";
import type {
  EditorNodeV2,
  FormSchemaV2,
  GridCellV2,
  GridNodeV2,
  GridRowV2,
  SchemaIssueV2,
} from "@/types";
import { resolveCellBoxV2 } from "@/engine-v2/derivation";
import { LAYOUT_ID_ATTR, NODE_ID_ATTR } from "@/engine-v2/node-address";
import type { TreeNode } from "../NodeTreeItem.vue";

/**
 * 节点类型的用户可见中文名（面向普通用户；grid 称「网格」，grid-cell 称「格子」，
 * 与左侧组件面板的叫法保持一致）。
 */
export const NODE_TYPE_LABELS: Record<string, string> = {
  page: "页面",
  grid: "网格",
  "grid-cell": "格子",
  text: "文本",
  p: "字段",
  table: "表格",
  image: "图片列表",
  html: "HTML 模块",
};

export function nodeTypeLabel(type: string): string {
  return NODE_TYPE_LABELS[type] ?? type;
}

export function nodeLabel(node: EditorNodeV2): string {
  switch (node.type) {
    case "page":
      return "页面";
    case "grid":
      return "网格";
    case "text":
      return node.text ? `“${node.text}”` : "(空文本)";
    case "p":
      return `字段：${node.field}`;
    case "table":
      return node.field ? `表格：${node.field}` : "表格";
    case "image":
      return "图片列表";
    case "html":
      return "HTML 模块";
    default:
      return nodeTypeLabel(node.type);
  }
}

export function buildTreeNode(node: EditorNodeV2): TreeNode {
  if (node.type === "grid") return buildGridTree(node);
  if (node.type === "page")
    return {
      id: node.id,
      type: nodeTypeLabel(node.type),
      label: nodeLabel(node),
      children: node.children.map(buildTreeNode),
    };
  // 其余组件节点（text / p / table / image / html）：无独立子节点
  return { id: node.id, type: nodeTypeLabel(node.type), label: nodeLabel(node), children: [] };
}

export function buildGridTree(grid: GridNodeV2): TreeNode {
  const cellNodes: TreeNode[] = [];
  grid.rows.forEach((row, ri) => {
    row.cells.forEach((cell, ci) => {
      cellNodes.push(buildCellTree(cell, ri, ci, row.cells.length, grid.rows.length));
    });
  });
  return { id: grid.id, type: "网格", label: nodeLabel(grid), children: cellNodes };
}

export function buildCellTree(
  cell: GridCellV2,
  ri: number,
  ci: number,
  colCount: number,
  rowCount: number,
): TreeNode {
  const label =
    rowCount > 1 ? `格子 ${ri + 1}-${ci + 1}` : colCount > 1 ? `格子 ${ci + 1}` : "格子";
  return {
    id: cell.id,
    type: "格子",
    label,
    children: cell.children.map(buildTreeNode),
  };
}

/** 选择态句柄：类型由实现推断，避免手写签名与实现漂移。 */
export type NodeSelection = ReturnType<typeof useNodeSelection>;

export function useNodeSelection(
  schema: Ref<FormSchemaV2>,
  options: { editable: () => boolean },
) {
  const selectedNodeId = ref<string | null>(null);
  const selectedInsertionSlotId = ref<string | null>(null);
  const selectionPathIds = ref<string[]>([]);
  const selectionPathIndex = ref(0);

  let lastClickedLeafId: string | null = null;
  let selectionDepth = 0;

  const nodeIndex = computed(() => buildEditorNodeIndexV2(schema.value));

  /** 节点是否位于某个 Table 的行模板内（含嵌套 Grid）。 */
  function isInsideTable(id: string): boolean {
    let cursor = nodeIndex.value.get(id)?.parent ?? null;
    while (cursor) {
      if (cursor.type === "table") return true;
      cursor = nodeIndex.value.get(cursor.id)?.parent ?? null;
    }
    return false;
  }

  /** 节点是否可作为独立组件选中并配置。 */
  function isStyleEditableNodeId(id: string): boolean {
    const node = nodeIndex.value.get(id)?.node;
    if (!node) return false;
    if (isInsideTable(id)) return false;
    return isSelectableSchemaNodeV2(node) || node.type === "grid-cell";
  }

  const selectedNode = computed<EditorNodeV2 | null>(() => {
    const id = selectedNodeId.value;
    return id && isStyleEditableNodeId(id) ? (nodeIndex.value.get(id)?.node ?? null) : null;
  });
  /** 选中组件的用户可见中文名（未选择时为「未选择」）。 */
  const selectedNodeType = computed(() =>
    selectedNode.value ? nodeTypeLabel(selectedNode.value.type) : "未选择",
  );
  const selectedOwnerCell = computed(() =>
    selectedNodeId.value ? (nodeIndex.value.get(selectedNodeId.value)?.ownerCell ?? null) : null,
  );
  const selectedCell = computed(() =>
    selectedNode.value?.type === "grid-cell" ? (selectedNode.value as GridCellV2) : null,
  );
  const selectedOwnerGridOfCell = computed<GridNodeV2 | null>(() => {
    const id = selectedNodeId.value;
    if (!id) return null;
    let cursor = nodeIndex.value.get(id)?.parent ?? null;
    while (cursor && cursor.type !== "grid") {
      cursor = nodeIndex.value.get(cursor.id)?.parent ?? null;
    }
    return cursor?.type === "grid" ? (cursor as GridNodeV2) : null;
  });
  const selectedCellBox = computed(() => {
    const cell = selectedCell.value;
    const grid = selectedOwnerGridOfCell.value;
    if (!cell || !grid) return null;
    return resolveCellBoxV2(cell, grid);
  });

  /** 选中 grid-cell 时的上下文：所在行、列索引、是否可合并右侧、是否可拆分。 */
  const selectedCellContext = computed<{
    rowIndex: number;
    columnIndex: number;
    hasNextSibling: boolean;
    canSplit: boolean;
  } | null>(() => {
    const id = selectedNodeId.value;
    if (!id) return null;
    const entry = nodeIndex.value.get(id);
    if (entry?.node.type !== "grid-cell" || entry.parent?.type !== "grid-row") return null;
    const row = entry.parent as GridRowV2;
    const rowIndex = (nodeIndex.value.get(row.id)?.node as GridRowV2 | undefined)
      ? (selectedOwnerGridOfCell.value?.rows ?? []).findIndex((r) => r.id === row.id)
      : -1;
    const columnIndex = row.cells.findIndex((cell) => cell.id === id);
    if (columnIndex < 0) return null;
    return {
      rowIndex,
      columnIndex,
      hasNextSibling: columnIndex < row.cells.length - 1,
      canSplit: (entry.node.colspan ?? 1) > 1,
    };
  });

  /** 新增组件的落点：优先插入槽，其次选中格，最后所属格。 */
  const insertionSlot = computed(() => {
    const slotId = selectedInsertionSlotId.value;
    const slot = slotId ? nodeIndex.value.get(slotId)?.node : undefined;
    if (slot?.type === "grid-cell" || slot?.type === "table-cell-template") return slot;
    const sel = selectedNodeId.value ? nodeIndex.value.get(selectedNodeId.value)?.node : undefined;
    if (sel?.type === "grid-cell" || sel?.type === "table-cell-template") return sel;
    return selectedOwnerCell.value;
  });

  const nodeTree = computed(() => schema.value.pages.map((page) => buildTreeNode(page)));

  function clearSelection(): void {
    selectedNodeId.value = null;
    selectedInsertionSlotId.value = null;
    selectionPathIds.value = [];
    selectionPathIndex.value = 0;
    lastClickedLeafId = null;
    selectionDepth = 0;
  }

  /** 画布点击选中：沿 DOM 祖先链收集候选节点，重复点同一节点时逐层上跳。 */
  function selectNode(event: MouseEvent): void {
    if (!options.editable()) return;
    const target = event.target as HTMLElement;
    selectedInsertionSlotId.value =
      target.closest<HTMLElement>(`[${LAYOUT_ID_ATTR}]`)?.dataset.layoutId ?? null;
    const ids: string[] = [];
    let cursor = target.closest<HTMLElement>(`[${NODE_ID_ATTR}]`);
    while (cursor) {
      const id = cursor.dataset.nodeId;
      if (id) ids.push(id);
      cursor = cursor.parentElement?.closest<HTMLElement>(`[${NODE_ID_ATTR}]`) ?? null;
    }
    const selectableIds = ids.filter((id) => isStyleEditableNodeId(id));
    const leafId = selectableIds[0] ?? null;
    if (!leafId) {
      selectedNodeId.value = null;
      selectedInsertionSlotId.value = null;
      selectionPathIds.value = [];
      selectionPathIndex.value = 0;
      lastClickedLeafId = null;
      selectionDepth = 0;
      return;
    }
    if (leafId === lastClickedLeafId && selectionPathIds.value.join("/") === selectableIds.join("/")) {
      selectionDepth = (selectionDepth + 1) % selectableIds.length;
    } else {
      lastClickedLeafId = leafId;
      selectionDepth = 0;
      selectionPathIds.value = selectableIds;
    }
    selectionPathIndex.value = selectionDepth;
    selectedNodeId.value = selectableIds[selectionDepth] ?? leafId;
  }

  /** 从校验问题定位节点：只保留可选中的祖先（Row/Cell/Template 永不成为当前节点）。 */
  function selectIssue(issue: SchemaIssueV2): void {
    const index = nodeIndex.value;
    const selectableIds: string[] = [];
    let cursor = issue.nodeId ? index.get(issue.nodeId)?.node : undefined;
    while (cursor) {
      if (isSelectableSchemaNodeV2(cursor)) selectableIds.push(cursor.id);
      cursor = index.get(cursor.id)?.parent ?? undefined;
    }
    // Schema 级问题（无 nodeId）回退到首个 Page。
    if (selectableIds.length === 0) {
      const pageId = schema.value.pages[0]?.id;
      if (!pageId) return;
      selectableIds.push(pageId);
    }
    selectedNodeId.value = selectableIds[0];
    selectedInsertionSlotId.value = null;
    selectionPathIds.value = selectableIds;
    selectionPathIndex.value = 0;
    selectionDepth = 0;
    lastClickedLeafId = selectableIds[0];
  }

  function selectNodeById(id: string): void {
    if (!options.editable()) return;
    const ref = nodeIndex.value.get(id);
    // 允许选中单元格（grid-cell）；其余须为可独立配置组件
    if (!ref || (!isSelectableSchemaNodeV2(ref.node) && ref.node.type !== "grid-cell")) return;
    selectedNodeId.value = id;
    selectedInsertionSlotId.value = null;
    const ancestors: string[] = [];
    let cursor = ref.parent;
    while (cursor) {
      if (isSelectableSchemaNodeV2(cursor)) ancestors.unshift(cursor.id);
      cursor = nodeIndex.value.get(cursor.id)?.parent ?? null;
    }
    selectionPathIds.value = [...ancestors, id];
    selectionPathIndex.value = selectionPathIds.value.length - 1;
    selectionDepth = selectionPathIds.value.length - 1;
    lastClickedLeafId = id;
  }

  return {
    selectedNodeId,
    selectedInsertionSlotId,
    selectionPathIds,
    selectionPathIndex,
    nodeIndex,
    selectedNode,
    selectedNodeType,
    selectedOwnerCell,
    selectedCell,
    selectedOwnerGridOfCell,
    selectedCellBox,
    selectedCellContext,
    insertionSlot,
    nodeTree,
    isInsideTable,
    isStyleEditableNodeId,
    clearSelection,
    selectNode,
    selectNodeById,
    selectIssue,
  };
}
