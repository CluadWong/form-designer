import type {
  FormNodeV2,
  FormSchemaV2,
  GridCellV2,
  GridNodeV2,
  GridRowV2,
  GridTrackV2,
  PageSchemaV2,
  EditorNodeV2,
  TableCellTemplateV2,
  TableColumnV2,
  TableNodeV2,
  BorderModeV2,
  HtmlNodeV2,
  ImageNodeV2,
} from "./schema-v2";
import { FONT_SIZE_MAX_PX, FONT_SIZE_MIN_PX } from "./schema-v2";
import { buildEditorNodeIndexV2 } from "./schema-v2-index";

export function createSchemaNodeIdV2(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function cloneWithFreshIds(node: EditorNodeV2): EditorNodeV2 {
  const nextId = (prefix: string) => createSchemaNodeIdV2(prefix);
  if (node.type === "grid-row") {
    return {
      ...node,
      id: nextId("row"),
      cells: node.cells.map(cell => cloneWithFreshIds(cell) as GridCellV2),
    };
  }
  if (node.type === "grid-cell") {
    return {
      ...node,
      id: nextId("cell"),
      children: node.children.map(cloneWithFreshIds) as FormNodeV2[],
    };
  }
  if (node.type === "table-cell-template") {
    return {
      ...node,
      id: nextId("template"),
      children: node.children.map(cloneWithFreshIds) as FormNodeV2[],
    };
  }
  if (node.type === "page") {
    return { ...node, id: nextId("page"), children: node.children.map(cloneWithFreshIds) as FormNodeV2[] };
  }
  if (node.type === "grid") {
    return {
      ...node,
      id: nextId("grid"),
      rows: node.rows.map(row => ({
        ...row,
        id: nextId("row"),
        cells: row.cells.map(cell => ({
          ...cell,
          id: nextId("cell"),
          children: cell.children.map(cloneWithFreshIds) as FormNodeV2[],
        })),
      })),
    };
  }
  if (node.type === "table") {
    return {
      ...node,
      id: nextId("table"),
      rowTemplate: node.rowTemplate.map(template => ({
        ...template,
        id: nextId("template"),
        children: template.children.map(cloneWithFreshIds) as FormNodeV2[],
      })),
    };
  }
  return { ...node, id: nextId(node.type) };
}

export function cloneNodeWithFreshIdsV2<T extends EditorNodeV2>(node: T): T {
  return cloneWithFreshIds(node) as T;
}

type NodeUpdater = (node: EditorNodeV2) => EditorNodeV2;

function updateNode(node: FormNodeV2, id: string, updater: NodeUpdater): FormNodeV2 {
  const updated = node.id === id ? (updater(node) as FormNodeV2) : node;
  if (updated.type === "grid") {
    return {
      ...updated,
      rows: updated.rows.map(row => updateRow(row, id, updater)),
    };
  }
  if (updated.type === "table") {
    return {
      ...updated,
      rowTemplate: updated.rowTemplate.map(template => updateTemplate(template, id, updater)),
    };
  }
  return updated;
}

function updateRow(row: GridRowV2, id: string, updater: NodeUpdater): GridRowV2 {
  const updated = row.id === id ? (updater(row) as GridRowV2) : row;
  return {
    ...updated,
    cells: updated.cells.map(cell => updateCell(cell, id, updater)),
  };
}

function updateCell(cell: GridCellV2, id: string, updater: NodeUpdater): GridCellV2 {
  const updated = cell.id === id ? (updater(cell) as GridCellV2) : cell;
  return {
    ...updated,
    children: updated.children.map(child => updateNode(child, id, updater)),
  };
}

function updateTemplate(
  template: TableCellTemplateV2,
  id: string,
  updater: NodeUpdater,
): TableCellTemplateV2 {
  const updated = template.id === id ? (updater(template) as TableCellTemplateV2) : template;
  return {
    ...updated,
    children: updated.children.map(child => updateNode(child, id, updater)),
  };
}

function updatePage(page: PageSchemaV2, id: string, updater: NodeUpdater): PageSchemaV2 {
  const updated = page.id === id ? (updater(page) as PageSchemaV2) : page;
  return {
    ...updated,
    children: updated.children.map(child => updateNode(child, id, updater)),
  };
}

export function updateSchemaNodeV2(
  schema: FormSchemaV2,
  id: string,
  updater: NodeUpdater,
): FormSchemaV2 {
  return {
    ...schema,
    pages: schema.pages.map(page => updatePage(page, id, updater)),
  };
}

export function insertGridRowV2(
  schema: FormSchemaV2,
  gridId: string,
  row: GridRowV2,
  at?: number,
): FormSchemaV2 {
  return updateSchemaNodeV2(schema, gridId, node => {
    if (node.type !== "grid") return node;
    const index = Math.max(0, Math.min(at ?? node.rows.length, node.rows.length));
    const rows = [...node.rows];
    rows.splice(index, 0, row);
    return { ...node, rows };
  });
}

export function appendTableRowsV2(
  schema: FormSchemaV2,
  tableId: string,
  count = 1,
): FormSchemaV2 {
  return updateSchemaNodeV2(schema, tableId, node => {
    if (node.type !== "table") return node;
    return { ...node, minRows: Math.max(0, node.minRows + count) };
  });
}

export function updateGridBorderV2(
  schema: FormSchemaV2,
  gridId: string,
  border: GridNodeV2["border"],
): FormSchemaV2 {
  return updateSchemaNodeV2(schema, gridId, node =>
    node.type === "grid" ? { ...node, border } : node,
  );
}

export function updateTableBorderV2(
  schema: FormSchemaV2,
  tableId: string,
  border: BorderModeV2,
): FormSchemaV2 {
  return updateSchemaNodeV2(schema, tableId, node =>
    node.type === "table" ? { ...node, border } : node,
  );
}

export function updateGridRowHeightV2(
  schema: FormSchemaV2,
  rowId: string,
  height: number,
): FormSchemaV2 {
  return updateSchemaNodeV2(schema, rowId, node =>
    node.type === "grid-row" ? { ...node, height } : node,
  );
}

export function updateCellWidthV2(
  schema: FormSchemaV2,
  cellId: string,
  width: GridCellV2["width"],
): FormSchemaV2 {
  return updateSchemaNodeV2(schema, cellId, node =>
    node.type === "grid-cell" ? { ...node, width } : node,
  );
}

/** 设置单元格内边距（mm，非负）。用于「单元格仅覆盖」模式。 */
export function updateCellPaddingV2(
  schema: FormSchemaV2,
  cellId: string,
  padding: number,
): FormSchemaV2 {
  const value = Number.isFinite(padding) && padding > 0 ? padding : 0;
  return updateSchemaNodeV2(schema, cellId, node =>
    node.type === "grid-cell" ? { ...node, padding: value } : node,
  );
}

/** 设置单元格水平对齐（或传 undefined 清除覆盖，回归 Grid 默认）。 */
export function updateCellAlignV2(
  schema: FormSchemaV2,
  cellId: string,
  align: "left" | "center" | "right" | undefined,
): FormSchemaV2 {
  return updateSchemaNodeV2(schema, cellId, node =>
    node.type === "grid-cell" ? { ...node, align } : node,
  );
}

/** 设置单元格垂直对齐（或传 undefined 清除覆盖，回归 Grid 默认）。 */
export function updateCellVerticalAlignV2(
  schema: FormSchemaV2,
  cellId: string,
  verticalAlign: "top" | "middle" | "bottom" | undefined,
): FormSchemaV2 {
  return updateSchemaNodeV2(schema, cellId, node =>
    node.type === "grid-cell" ? { ...node, verticalAlign } : node,
  );
}

/** 设置 Grid 级单元格默认（padding / 对齐），供所有未单独覆盖的 cell 继承。 */
export function updateGridCellDefaultsV2(
  schema: FormSchemaV2,
  gridId: string,
  patch: Partial<
    Pick<GridNodeV2, "cellPadding" | "cellAlign" | "cellVerticalAlign">
  >,
): FormSchemaV2 {
  return updateSchemaNodeV2(schema, gridId, node =>
    node.type === "grid" ? { ...node, ...patch } : node,
  );
}

/**
 * 单元格间距（mm）。同时作用于行间距与列间距，等价于 CSS `gap`；
 * 传 0 / 负数 / 非数字均视为「无间距」（清除该字段）。
 */
export function updateGridGapV2(
  schema: FormSchemaV2,
  gridId: string,
  gap: number | undefined,
): FormSchemaV2 {
  const value =
    typeof gap === "number" && Number.isFinite(gap) && gap > 0 ? gap : undefined;
  return updateSchemaNodeV2(schema, gridId, node =>
    node.type === "grid" ? { ...node, gap: value } : node,
  );
}

/**
 * 解析 Grid 的单元格间距（mm）。渲染层与设计器共用，缺省 / 非法值返回 0
 * （旧数据无 gap 字段时保持「单元格紧贴」的原始版式）。
 */
export function resolveGridGapV2(grid: GridNodeV2): number {
  const gap = grid.gap;
  return typeof gap === "number" && Number.isFinite(gap) && gap > 0 ? gap : 0;
}

export function updateTableMinRowsV2(
  schema: FormSchemaV2,
  tableId: string,
  minRows: number,
): FormSchemaV2 {
  return updateSchemaNodeV2(schema, tableId, node =>
    node.type === "table" ? { ...node, minRows: Math.max(0, Math.floor(minRows)) } : node,
  );
}

/**
 * 新增一列：同时向 columns 追加列定义，并向 rowTemplate 追加一个对应的单元格模板
 * （默认放入一个字段 P），保证渲染层 tableTemplate() 能按 columnKey 命中。
 * 列 key 自动避免与现有 key 冲突。
 */
export function addTableColumnV2(
  schema: FormSchemaV2,
  tableId: string,
  column?: Partial<TableColumnV2>,
): FormSchemaV2 {
  return updateSchemaNodeV2(schema, tableId, node => {
    if (node.type !== "table") return node;
    const existingKeys = new Set(node.columns.map(col => col.key));
    let index = node.columns.length + 1;
    let key = `col${index}`;
    while (existingKeys.has(key)) {
      index += 1;
      key = `col${index}`;
    }
    const newColumn: TableColumnV2 = {
      key,
      title: column?.title ?? "新列",
      width: column?.width ?? "1fr",
      align: column?.align,
    };
    const template: TableCellTemplateV2 = {
      id: createSchemaNodeIdV2(`${node.id}-${key}`),
      type: "table-cell-template",
      columnKey: key,
      children: [
        {
          id: createSchemaNodeIdV2(`${node.id}-${key}-p`),
          type: "p",
          mode: "field",
          // 字段名由渲染期按「列key_行号」自动派生（见 schema-v2-table-rows.ts），
          // 行模板内不手写 field；校验层对表格内字段跳过命名检查。
          field: "",
          underline: true,
        },
      ],
    };
    return {
      ...node,
      columns: [...node.columns, newColumn],
      rowTemplate: [...node.rowTemplate, template],
    };
  });
}

/** 删除一列：同步移除 columns 定义与对应 rowTemplate。至少保留 1 列，避免退化表格。 */
export function removeTableColumnV2(
  schema: FormSchemaV2,
  tableId: string,
  columnKey: string,
): FormSchemaV2 {
  return updateSchemaNodeV2(schema, tableId, node => {
    if (node.type !== "table" || node.columns.length <= 1) return node;
    return {
      ...node,
      columns: node.columns.filter(col => col.key !== columnKey),
      rowTemplate: node.rowTemplate.filter(template => template.columnKey !== columnKey),
    };
  });
}

/** 重命名列 key（同步更新 columns 与 rowTemplate）。 */
export function renameTableColumnKeyV2(
  schema: FormSchemaV2,
  tableId: string,
  oldKey: string,
  newKey: string,
): FormSchemaV2 {
  const trimmed = newKey.trim();
  if (!trimmed || trimmed === oldKey) return schema;
  return updateSchemaNodeV2(schema, tableId, node => {
    if (node.type !== "table") return node;
    // 防止与已有 key 冲突
    if (node.columns.some(c => c.key === trimmed)) return node;
    return {
      ...node,
      columns: node.columns.map(col =>
        col.key === oldKey ? { ...col, key: trimmed } : col,
      ),
      rowTemplate: node.rowTemplate.map(tpl =>
        tpl.columnKey === oldKey
          ? { ...tpl, columnKey: trimmed, id: `${tableId}-${trimmed}` }
          : tpl,
      ),
    };
  });
}

/** 编辑列属性（标题 / 宽度 / 对齐）。 */
export function updateTableColumnV2(
  schema: FormSchemaV2,
  tableId: string,
  columnKey: string,
  patch: Partial<TableColumnV2>,
): FormSchemaV2 {
  return updateSchemaNodeV2(schema, tableId, node => {
    if (node.type !== "table") return node;
    return {
      ...node,
      columns: node.columns.map(col =>
        col.key === columnKey ? { ...col, ...patch } : col,
      ),
    };
  });
}

/** Updates the global base row height (mm). Clamped to 0.1–99, 保留 0.1mm 粒度（1 位小数）。 */
export function updateBaseRowHeightV2(
  schema: FormSchemaV2,
  baseRowHeight: number,
): FormSchemaV2 {
  const rounded = Math.round(baseRowHeight * 10) / 10;
  return { ...schema, baseRowHeight: Math.max(0.1, Math.min(99, rounded)) };
}

/**
 * Updates the global base font size (px) — 页面属性里的「基础字号」，即全局默认字号。
 * 取整并钳制到 6–72；写入 `schema.baseFontSize`（渲染层经 CSS 变量、分页估算经
 * `resolveBaseFontSizeV2` 共用同一值）。
 */
export function updateBaseFontSizeV2(
  schema: FormSchemaV2,
  baseFontSize: number,
): FormSchemaV2 {
  const rounded = Math.round(baseFontSize);
  return {
    ...schema,
    baseFontSize: Math.max(FONT_SIZE_MIN_PX, Math.min(FONT_SIZE_MAX_PX, rounded)),
  };
}

/** Updates the paper size (方向自 P11-3 起由纸张尺寸派生，不再单独维护 orientation). */
export function updatePaperConfigV2(
  schema: FormSchemaV2,
  paper: FormSchemaV2["paper"],
): FormSchemaV2 {
  return { ...schema, paper };
}

export function createEmptyFormSchemaV2(): FormSchemaV2 {
  return {
    version: 2,
    paper: { size: "A4" },
    baseRowHeight: 8,
    pages: [
      {
        id: createSchemaNodeIdV2("page"),
        type: "page",
        mode: "fixed",
        margin: { top: 12, right: 12, bottom: 12, left: 12 },
        children: [],
      },
    ],
  };
}

export function createGridRowV2(
  cellCount = 1,
  height = 1,
): GridRowV2 {
  const count = Math.max(1, Math.floor(cellCount));
  return {
    id: createSchemaNodeIdV2("row"),
    type: "grid-row",
    height: Math.max(1, Math.floor(height)),
    cells: Array.from({ length: count }, (_, index) => ({
      id: createSchemaNodeIdV2(`cell-${index + 1}`),
      type: "grid-cell" as const,
      width: "1fr" as const,
      children: [],
    })),
  };
}

export function appendNodeToCellV2(
  schema: FormSchemaV2,
  cellId: string,
  child: FormNodeV2,
): FormSchemaV2 {
  return updateSchemaNodeV2(schema, cellId, node =>
    node.type === "grid-cell" || node.type === "table-cell-template"
      ? { ...node, children: [...node.children, child] }
      : node,
  );
}

export function mergeGridCellsV2(
  schema: FormSchemaV2,
  firstCellId: string,
  secondCellId: string,
): FormSchemaV2 {
  const index = buildEditorNodeIndexV2(schema);
  const first = index.get(firstCellId);
  const second = index.get(secondCellId);
  if (first?.node.type !== "grid-cell" || second?.node.type !== "grid-cell") return schema;
  if (first.parent?.type !== "grid-row" || first.parent.id !== second.parent?.id) return schema;
  const rowId = first.parent.id;
  return updateSchemaNodeV2(schema, rowId, node => {
    if (node.type !== "grid-row") return node;
    const firstIndex = node.cells.findIndex(cell => cell.id === firstCellId);
    const secondIndex = node.cells.findIndex(cell => cell.id === secondCellId);
    if (firstIndex < 0 || secondIndex < 0 || firstIndex === secondIndex) return node;
    const left = node.cells[firstIndex];
    const right = node.cells[secondIndex];
    const merged = {
      ...left,
      colspan: (left.colspan ?? 1) + (right.colspan ?? 1),
      children: [...left.children, ...right.children],
    };
    return {
      ...node,
      cells: node.cells.filter(cell => cell.id !== secondCellId).map(cell =>
        cell.id === firstCellId ? merged : cell,
      ),
    };
  });
}

/** Splits a horizontally merged cell (colspan > 1) back into `colspan` cells.
 *  All original children are kept in the first split cell; the remaining cells
 *  are empty. Column alignment is preserved by the shared `grid.columns` track. */
export function splitGridCellV2(
  schema: FormSchemaV2,
  cellId: string,
): FormSchemaV2 {
  const index = buildEditorNodeIndexV2(schema);
  const entry = index.get(cellId);
  if (entry?.node.type !== "grid-cell") return schema;
  const span = entry.node.colspan ?? 1;
  if (span <= 1) return schema;
  const row = entry.parent;
  if (!row || row.type !== "grid-row") return schema;
  return updateSchemaNodeV2(schema, row.id, node => {
    if (node.type !== "grid-row") return node;
    const targetIndex = node.cells.findIndex(cell => cell.id === cellId);
    if (targetIndex < 0) return node;
    const original = node.cells[targetIndex];
    const { colspan: _omit, ...first } = original;
    const rest: GridCellV2[] = Array.from({ length: span - 1 }, () => ({
      id: createSchemaNodeIdV2("cell"),
      type: "grid-cell",
      children: [],
    }));
    return {
      ...node,
      cells: [
        ...node.cells.slice(0, targetIndex),
        first,
        ...rest,
        ...node.cells.slice(targetIndex + 1),
      ],
    };
  });
}

export function wrapCellChildrenWithGridV2(schema: FormSchemaV2, cellId: string): FormSchemaV2 {
  return updateSchemaNodeV2(schema, cellId, node => {
    if (node.type !== "grid-cell" || node.children.length === 0) return node;
    const nested = createGridBySizeV2({ rows: 1, columns: 1, border: "none" });
    nested.rows[0].cells[0].children = node.children;
    return { ...node, children: [nested] };
  });
}

/** 从 schema 中拆下指定节点，返回拆下后的 schema 与被拆下的节点（找不到则返回原 schema + undefined）。 */
function detachNodeV2(
  schema: FormSchemaV2,
  nodeId: string,
): { schema: FormSchemaV2; node?: FormNodeV2 } {
  let moved: FormNodeV2 | undefined;
  const detach = (node: FormNodeV2): FormNodeV2 => {
    if (node.type === "grid") {
      return {
        ...node,
        rows: node.rows.map(row => ({
          ...row,
          cells: row.cells.map(cell => ({
            ...cell,
            children: cell.children.filter(child => {
              if (child.id === nodeId) { moved = child; return false; }
              return true;
            }).map(detach),
          })),
        })),
      };
    }
    if (node.type === "table") {
      return {
        ...node,
        rowTemplate: node.rowTemplate.map(template => ({
          ...template,
          children: template.children.filter(child => {
            if (child.id === nodeId) { moved = child; return false; }
            return true;
          }).map(detach),
        })),
      };
    }
    return node;
  };
  const detached = {
    ...schema,
    pages: schema.pages.map(page => ({
      ...page,
      children: page.children.filter(child => {
        if (child.id === nodeId) { moved = child; return false; }
        return true;
      }).map(detach),
    })),
  };
  return { schema: detached, node: moved };
}

export function moveNodeV2(
  schema: FormSchemaV2,
  nodeId: string,
  targetCellId: string,
): FormSchemaV2 {
  const index = buildEditorNodeIndexV2(schema);
  const source = index.get(nodeId);
  const target = index.get(targetCellId);
  if (!source || !target || (target.node.type !== "grid-cell" && target.node.type !== "table-cell-template")) return schema;
  if (source.node.type === "page" || source.node.type === "grid-row" || source.node.type === "grid-cell" || source.node.type === "table-cell-template") return schema;
  // 目标就是自身当前所在格：无实际位移，直接原样返回，避免「拆下再追加」把节点
  // 挪到同格末尾、反复操作后在原格堆积空位（见 P6.3c 验收反馈）。
  if (source.parent?.id === targetCellId) return schema;
  let ancestor = target.parent;
  while (ancestor) {
    if (ancestor.id === nodeId) return schema;
    ancestor = index.get(ancestor.id)?.parent ?? null;
  }
  const { schema: detached, node } = detachNodeV2(schema, nodeId);
  return node ? appendNodeToCellV2(detached, targetCellId, node) : schema;
}

/** 拖拽已有节点重排时写入 dataTransfer 的 MIME（与模板生成用的 DRAG_MIME 区分）。 */
export const NODE_MOVE_MIME = "application/x-ticket-node-move";

/**
 * P9（拖拽重排）核心操作：把节点从当前位置拆下，插入到目标格（grid-cell / table-cell-template）
 * 的任意下标 `atIndex`，同时覆盖「格内排序」与「跨格 / 跨 Grid 移动」两种场景。
 *
 * - `atIndex` 由 UI 按「可见 children + 指针命中」计算：同格时相对含该节点的当前数组，
 *   跨格时相对目标格当前数组；函数内部对同格情形做偏移修正（拆下后下标 -1）。
 * - 拒绝：目标非格/列模板、节点自身为非可选容器（page/row/cell/template）、目标位于节点自身或其内部。
 * - 原位（同格且 atIndex === 原下标）或非法时返回原 schema 引用，避免产生无意义撤销记录。
 * - `atIndex` 越界自动 clamp 到 [0, 目标格 children 长度]。
 */
export function moveNodeToIndexV2(
  schema: FormSchemaV2,
  nodeId: string,
  targetCellId: string,
  atIndex: number,
): FormSchemaV2 {
  const index = buildEditorNodeIndexV2(schema);
  const source = index.get(nodeId);
  const target = index.get(targetCellId);
  if (!source || !target) return schema;
  if (target.node.type !== "grid-cell" && target.node.type !== "table-cell-template") return schema;
  if (source.node.type === "page" || source.node.type === "grid-row" || source.node.type === "grid-cell" || source.node.type === "table-cell-template") return schema;
  // 目标位于被移动节点自身或其内部（移入自身后代）→ 拒绝。
  let ancestor = target.parent;
  while (ancestor) {
    if (ancestor.id === nodeId) return schema;
    ancestor = index.get(ancestor.id)?.parent ?? null;
  }
  const fromCell = source.parent;
  const fromCellChildren =
    fromCell && (fromCell.type === "grid-cell" || fromCell.type === "table-cell-template")
      ? fromCell.children
      : null;
  const fromIndex = fromCellChildren ? fromCellChildren.findIndex(c => c.id === nodeId) : -1;
  const sameCell = fromCell?.id === targetCellId;
  // 同格原位：无位移，直接返回原 schema 引用。
  if (sameCell && fromIndex >= 0 && atIndex === fromIndex) return schema;
  const { schema: detached, node } = detachNodeV2(schema, nodeId);
  if (!node) return schema;
  let idx = Number.isFinite(atIndex) ? Math.trunc(atIndex) : 0;
  // 同格重排：UI 传入的 atIndex 相对含该节点的当前数组，拆下后需把偏移修正一位。
  if (sameCell && fromIndex >= 0 && idx > fromIndex) idx -= 1;
  return updateSchemaNodeV2(detached, targetCellId, cell => {
    if (cell.type !== "grid-cell" && cell.type !== "table-cell-template") return cell;
    const i = Math.max(0, Math.min(idx, cell.children.length));
    return { ...cell, children: [...cell.children.slice(0, i), node, ...cell.children.slice(i)] };
  });
}

/**
 * P6.3b 格内排序：在同一父容器（grid-cell / table-cell-template / page）的子节点列表中
 * 把节点上移或下移一位，用于替代「拖动调整子节点顺序」。
 *
 * 已在边界、或父容器不属于上述三类时原样返回 schema（不产生新对象），
 * 便于 UI 侧据此判断按钮是否可点。
 */
export function moveNodeWithinParentV2(
  schema: FormSchemaV2,
  nodeId: string,
  direction: "up" | "down",
): FormSchemaV2 {
  const index = buildEditorNodeIndexV2(schema);
  const parent = index.get(nodeId)?.parent;
  if (!parent) return schema;

  /** 返回重排后的新数组；无法移动时返回 null（调用方据此保持 schema 原引用）。 */
  const reorder = (children: FormNodeV2[]): FormNodeV2[] | null => {
    const from = children.findIndex(child => child.id === nodeId);
    if (from < 0) return null;
    const to = direction === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= children.length) return null;
    const moved = children[from];
    const swapped = children[to];
    if (!moved || !swapped) return null;
    const next = [...children];
    next[from] = swapped;
    next[to] = moved;
    return next;
  };

  let reordered: FormNodeV2[] | null = null;
  const updated = updateSchemaNodeV2(schema, parent.id, node => {
    const children =
      node.type === "grid-cell" || node.type === "table-cell-template" || node.type === "page"
        ? node.children
        : null;
    if (!children) return node;
    const result = reorder(children);
    if (!result) return node;
    reordered = result;
    return { ...node, children: result } as EditorNodeV2;
  });
  // 未实际重排（边界/父容器不支持）时返回原 schema，避免产生无意义的撤销记录。
  return reordered ? updated : schema;
}

/**
 * 列出可作为跨格移动目标的所有投放点（grid-cell / table-cell-template），供配置面板下拉选择。
 *
 * 传入 `moveNodeId` 时会过滤掉两类无意义/非法的目标：
 * 1. **节点当前所在格** —— 移到自身格不产生位移，却会让节点被拆下再追加到同格末尾，
 *    反复操作会在原格堆积空位（P6.3c 验收反馈）；
 * 2. **节点自身及其后代容器** —— `moveNodeV2` 本就拒绝移入自身后代，列出来只会静默失败。
 */
export function listDropTargetsV2(
  schema: FormSchemaV2,
  moveNodeId?: string,
): Array<{ id: string; label: string }> {
  const index = buildEditorNodeIndexV2(schema);
  const currentParentId = moveNodeId ? index.get(moveNodeId)?.parent?.id : undefined;
  /** 沿父链上溯，判断该投放点是否位于被移动节点自身或其内部。 */
  const isSelfOrDescendant = (id: string): boolean => {
    let cursor: string | undefined = id;
    while (cursor) {
      if (cursor === moveNodeId) return true;
      cursor = index.get(cursor)?.parent?.id;
    }
    return false;
  };
  const accepted = (id: string): boolean =>
    id !== currentParentId && !(moveNodeId !== undefined && isSelfOrDescendant(id));

  const targets: Array<{ id: string; label: string }> = [];

  const walk = (children: FormNodeV2[], prefix: string): void => {
    children.forEach(child => {
      if (child.type === "grid") {
        const gridLabel = `${prefix}${child.id}`;
        child.rows.forEach((row, rowIndex) => {
          row.cells.forEach((cell, cellIndex) => {
            const cellLabel = `${gridLabel} · 第${rowIndex + 1}行第${cellIndex + 1}格`;
            if (accepted(cell.id)) targets.push({ id: cell.id, label: cellLabel });
            // 嵌套 Grid：递归其格内子节点
            walk(cell.children, `${cellLabel} › `);
          });
        });
      } else if (child.type === "table") {
        child.rowTemplate.forEach(template => {
          if (!accepted(template.id)) return;
          const column = child.columns.find(c => c.key === template.columnKey);
          targets.push({
            id: template.id,
            label: `${prefix}${child.id} · ${column?.title ?? template.columnKey}列`,
          });
        });
      }
    });
  };

  schema.pages.forEach(page => walk(page.children, ""));
  return targets;
}

export function insertRootGridV2(
  schema: FormSchemaV2,
  grid: GridNodeV2,
): FormSchemaV2 {
  const page = schema.pages[0];
  if (!page) return schema;
  return {
    ...schema,
    pages: schema.pages.map((current, index) =>
      index === 0 ? { ...current, children: [...current.children, grid] } : current,
    ),
  };
}

export function appendGridRowV2(
  schema: FormSchemaV2,
  gridId: string,
  row: GridRowV2,
): FormSchemaV2 {
  return insertGridRowV2(schema, gridId, row);
}

export function copyGridRowV2(schema: FormSchemaV2, rowId: string, at?: number): FormSchemaV2 {
  const copyInNode = (node: FormNodeV2): FormNodeV2 => {
    if (node.type === "grid") {
      const rowIndex = node.rows.findIndex(row => row.id === rowId);
      if (rowIndex >= 0) {
        const rows = [...node.rows];
        const clone = cloneNodeWithFreshIdsV2(node.rows[rowIndex]);
        const insertionIndex = Math.max(0, Math.min(at ?? rowIndex + 1, rows.length));
        rows.splice(insertionIndex, 0, clone);
        return { ...node, rows };
      }
      return {
        ...node,
        rows: node.rows.map(row => ({
          ...row,
          cells: row.cells.map(cell => ({ ...cell, children: cell.children.map(copyInNode) })),
        })),
      };
    }
    if (node.type === "table") {
      return {
        ...node,
        rowTemplate: node.rowTemplate.map(template => ({
          ...template,
          children: template.children.map(copyInNode),
        })),
      };
    }
    return node;
  };
  return {
    ...schema,
    pages: schema.pages.map(page => ({ ...page, children: page.children.map(copyInNode) })),
  };
}

export function removeGridRowV2(schema: FormSchemaV2, rowId: string): FormSchemaV2 {
  const removeFromNode = (node: FormNodeV2): FormNodeV2 => {
    if (node.type === "grid") {
      return {
        ...node,
        rows: node.rows
          .filter(row => row.id !== rowId)
          .map(row => ({
            ...row,
            cells: row.cells.map(cell => ({
              ...cell,
              children: cell.children.map(removeFromNode),
            })),
          })),
      };
    }
    if (node.type === "table") {
      return {
        ...node,
        rowTemplate: node.rowTemplate.map(template => ({
          ...template,
          children: template.children.map(removeFromNode),
        })),
      };
    }
    return node;
  };
  return {
    ...schema,
    pages: schema.pages.map(page => ({ ...page, children: page.children.map(removeFromNode) })),
  };
}

function removeNodeFromForm(node: FormNodeV2, id: string): FormNodeV2 | null {
  if (node.id === id) return null;
  if (node.type === "grid") {
    const rows = node.rows
      .filter(row => row.id !== id)
      .map(row => ({
        ...row,
        cells: row.cells
          .filter(cell => cell.id !== id)
          .map(cell => ({
            ...cell,
            children: cell.children
              .map(child => removeNodeFromForm(child, id))
              .filter((child): child is FormNodeV2 => child !== null),
          })),
      }))
      .filter(row => row.cells.length > 0);
    return rows.length > 0 ? {
      ...node,
      rows,
    } : null;
  }
  if (node.type === "table") {
    return {
      ...node,
      rowTemplate: node.rowTemplate
        .filter(template => template.id !== id)
        .map(template => ({
          ...template,
          children: template.children
            .map(child => removeNodeFromForm(child, id))
            .filter((child): child is FormNodeV2 => child !== null),
        })),
    };
  }
  return node;
}

export function removeNodeV2(schema: FormSchemaV2, nodeId: string): FormSchemaV2 {
  return {
    ...schema,
    pages: schema.pages
      .filter(page => page.id !== nodeId)
      .map(page => ({
        ...page,
        children: page.children
          .map(child => removeNodeFromForm(child, nodeId))
          .filter((child): child is FormNodeV2 => child !== null),
      })),
  };
}

export function moveGridRowV2(
  schema: FormSchemaV2,
  rowId: string,
  direction: "up" | "down",
): FormSchemaV2 {
  return {
    ...schema,
    pages: schema.pages.map(page => ({
      ...page,
      children: page.children.map(node => {
        if (node.type !== "grid") return node;
        const index = node.rows.findIndex(row => row.id === rowId);
        if (index < 0) return node;
        const target = direction === "up" ? index - 1 : index + 1;
        if (target < 0 || target >= node.rows.length) return node;
        const rows = [...node.rows];
        [rows[index], rows[target]] = [rows[target], rows[index]];
        return { ...node, rows };
      }),
    })),
  };
}

export function splitGridRowV2(
  schema: FormSchemaV2,
  rowId: string,
  cellCount: number,
): FormSchemaV2 {
  const count = Math.max(1, Math.floor(cellCount));
  return updateSchemaNodeV2(schema, rowId, node => {
    if (node.type !== "grid-row") return node;
    const existing = node.cells;
    const cells = Array.from({ length: count }, (_, index) => existing[index] ?? {
      id: createSchemaNodeIdV2(`cell-${index + 1}`),
      type: "grid-cell" as const,
      width: "1fr" as const,
      children: [],
    });
    return { ...node, cells };
  });
}

function createGridCellV2(width: GridTrackV2 = "1fr"): GridCellV2 {
  return {
    id: createSchemaNodeIdV2("cell"),
    type: "grid-cell",
    width,
    children: [],
  };
}

export function resizeGridRowV2(row: GridRowV2, columnCount: number): GridRowV2 {
  const cells = row.cells.slice(0, columnCount);
  while (cells.length < columnCount) cells.push(createGridCellV2());
  if (row.cells.length > columnCount && cells.length > 0) {
    const overflow = row.cells.slice(columnCount).flatMap(cell => cell.children);
    cells[cells.length - 1] = {
      ...cells[cells.length - 1],
      children: [...cells[cells.length - 1].children, ...overflow],
    };
  }
  return { ...row, cells };
}

export function resizeGridV2(
  schema: FormSchemaV2,
  gridId: string,
  rowCount: number,
  columnCount: number,
): FormSchemaV2 {
  const rowsTarget = Math.max(1, Math.floor(rowCount));
  const columnsTarget = Math.max(1, Math.floor(columnCount));
  return updateSchemaNodeV2(schema, gridId, node => {
    if (node.type !== "grid") return node;
    const rows = node.rows.slice(0, rowsTarget).map(row => resizeGridRowV2(row, columnsTarget));
    const defaultHeight = node.rows[0]?.height ?? 1;
    while (rows.length < rowsTarget) {
      rows.push(createGridRowV2(columnsTarget, defaultHeight));
    }
    if (node.rows.length > rowsTarget && rows.length > 0) {
      const overflow = node.rows
        .slice(rowsTarget)
        .flatMap(row => row.cells.flatMap(cell => cell.children));
      const lastRow = rows[rows.length - 1];
      const lastCell = lastRow.cells[lastRow.cells.length - 1];
      lastRow.cells[lastRow.cells.length - 1] = {
        ...lastCell,
        children: [...lastCell.children, ...overflow],
      };
    }
    // 同步「渲染真源」grid.columns：长度对齐首行格数，保留既有格宽，新列默认 1fr。
    // 否则改列数后 columns 长度错位/缺失，渲染层优先用 columns 会读不到或错位
    // （典型表现：改 2 列后设第 2 列宽度不生效）。
    const columns = (rows[0]?.cells ?? []).map(cell => cell.width ?? "1fr");
    return { ...node, rows, columns };
  });
}

/** Derives a canonical column-width array from a Grid's first row (expanding
 *  each cell by its colspan). Used to bootstrap `grid.columns` on legacy
 *  schemas that only store per-cell widths. */
function deriveGridColumnsV2(grid: GridNodeV2): GridTrackV2[] {
  const source = grid.rows.find(row => row.cells.length > 0) ?? grid.rows[0];
  const columns: GridTrackV2[] = [];
  if (!source) return columns;
  for (const cell of source.cells) {
    const span = cell.colspan ?? 1;
    for (let i = 0; i < span; i += 1) columns.push(cell.width ?? "1fr");
  }
  return columns;
}

/** Sets the track width for a column index across every row of a Grid.
 *  Maintains both the canonical `grid.columns` (source of truth for rendering,
 *  enables correct colspan alignment) and the legacy per-cell `cell.width`
 *  (kept in sync for backward compatibility). */
export function setGridColumnWidthV2(
  schema: FormSchemaV2,
  gridId: string,
  columnIndex: number,
  width: GridTrackV2,
): FormSchemaV2 {
  return updateSchemaNodeV2(schema, gridId, node => {
    if (node.type !== "grid") return node;
    const columns = node.columns ?? deriveGridColumnsV2(node);
    const nextColumns = columns.slice();
    if (columnIndex >= 0 && columnIndex < nextColumns.length) {
      nextColumns[columnIndex] = width;
    }
    return {
      ...node,
      columns: nextColumns,
      rows: node.rows.map(row => ({
        ...row,
        cells: row.cells.map((cell, index) =>
          index === columnIndex ? { ...cell, width } : cell,
        ),
      })),
    };
  });
}

/** Configures a Cell's internal layout through a nested Grid. */
export function resizeGridCellLayoutV2(
  schema: FormSchemaV2,
  cellId: string,
  rowCount: number,
  columnCount: number,
): FormSchemaV2 {
  const rowsTarget = Math.max(1, Math.floor(rowCount));
  const columnsTarget = Math.max(1, Math.floor(columnCount));
  return updateSchemaNodeV2(schema, cellId, node => {
    if (node.type !== "grid-cell") return node;
    const existing = node.children.length === 1 && node.children[0]?.type === "grid"
      ? node.children[0]
      : undefined;
    if (existing) {
      const rows = existing.rows.slice(0, rowsTarget).map(row => resizeGridRowV2(row, columnsTarget));
      const defaultHeight = existing.rows[0]?.height ?? 1;
      while (rows.length < rowsTarget) rows.push(createGridRowV2(columnsTarget, defaultHeight));
      if (existing.rows.length > rowsTarget) {
        const overflow = existing.rows.slice(rowsTarget).flatMap(row => row.cells.flatMap(cell => cell.children));
        const lastRow = rows[rows.length - 1];
        const lastCell = lastRow.cells[lastRow.cells.length - 1];
        lastRow.cells[lastRow.cells.length - 1] = { ...lastCell, children: [...lastCell.children, ...overflow] };
      }
      return {
        ...node,
        children: [{ ...existing, rows }],
      };
    }
    const nested = createGridBySizeV2({ rows: rowsTarget, columns: columnsTarget, border: "none" });
    nested.rows[0].cells[0].children = node.children;
    return { ...node, children: [nested] };
  });
}

export function splitGridCellRowsV2(schema: FormSchemaV2, cellId: string, rowCount: number): FormSchemaV2 {
  return resizeGridCellLayoutV2(schema, cellId, rowCount, 1);
}

export function createGridNodeV2(
  row?: GridRowV2,
  border?: GridNodeV2["border"],
): GridNodeV2;
export function createGridNodeV2(options?: GridSizeOptionsV2): GridNodeV2;
export function createGridNodeV2(
  value: GridRowV2 | GridSizeOptionsV2 = createGridRowV2(),
  border: GridNodeV2["border"] = "all",
): GridNodeV2 {
  if (!("type" in value)) return createGridBySizeV2(value);
  return {
    id: createSchemaNodeIdV2("grid"),
    type: "grid",
    border,
    rows: [value],
  };
}

export interface GridSizeOptionsV2 {
  rows?: number;
  columns?: number;
  rowHeight?: number;
  border?: GridNodeV2["border"];
  cellWidth?: GridTrackV2;
}

/** Creates a regular grid for the editor; the persisted shape remains rows/cells/children. */
export function createGridBySizeV2(options: GridSizeOptionsV2 = {}): GridNodeV2 {
  const rowCount = Math.max(1, Math.floor(options.rows ?? 1));
  const columnCount = Math.max(1, Math.floor(options.columns ?? 1));
  const rowHeight = Math.max(1, Math.floor(options.rowHeight ?? 1));
  const cellWidth = options.cellWidth ?? "1fr";

  return {
    id: createSchemaNodeIdV2("grid"),
    type: "grid",
    border: options.border ?? "all",
    columns: Array.from({ length: columnCount }, () => cellWidth),
    rows: Array.from({ length: rowCount }, () => {
      const row = createGridRowV2(columnCount, rowHeight);
      return {
        ...row,
        cells: row.cells.map(cell => ({ ...cell, width: cellWidth })),
      };
    }),
  };
}

export function createTextNodeV2(text = "固定文本"): FormNodeV2 {
  return { id: createSchemaNodeIdV2("text"), type: "text", text };
}

export function createFieldPNodeV2(field = "字段"): FormNodeV2 {
  return { id: createSchemaNodeIdV2("p-field"), type: "p", mode: "field", field, underline: true };
}

export function createTableNodeV2(): TableNodeV2 {
  const id = createSchemaNodeIdV2("table");
  const columns: TableNodeV2["columns"] = [
    { key: "col1", title: "列 1", width: "1fr" },
    { key: "col2", title: "列 2", width: "1fr" },
  ];
    return {
    id,
    type: "table",
    columns,
    minRows: 4,
    rowTemplate: columns.map(column => ({
      id: createSchemaNodeIdV2(`${id}-${column.key}`),
      type: "table-cell-template" as const,
      columnKey: column.key,
      children: [{
        id: createSchemaNodeIdV2(`${id}-${column.key}-p`),
        type: "p" as const,
        mode: "field" as const,
        // 字段名由渲染期按「列key_行号」自动派生（见 schema-v2-table-rows.ts），
        // 行模板内不手写 field；校验层对表格内字段跳过命名检查。
        field: "",
        underline: true,
      }],
    })),
    border: "all",
  };
}

export function createHtmlNodeV2(html = ""): HtmlNodeV2 {
  return {
    id: createSchemaNodeIdV2("html"),
    type: "html",
    html,
  };
}

export function createImageNodeV2(): ImageNodeV2 {
  return {
    id: createSchemaNodeIdV2("image"),
    type: "image",
    objectFit: "contain",
  };
}
