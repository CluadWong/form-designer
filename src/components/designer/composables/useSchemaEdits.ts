/**
 * 设计器结构编辑动作：节点增删、Grid/Cell 结构、Inspector 的属性更新。
 *
 * 从 `FormDesigner.vue` 抽出（2026-09-07 批次 1 拆分）：所有「改 schema」的动作集中在此，
 * 只依赖文档句柄与选择态句柄，**不直接依赖组件实例**，可脱离 UI 单测。
 *
 * 闸门：结构性编辑统一走 `ctx.editable()`（设计态才允许），避免逐处手写守卫。
 */
import { computed, type ComputedRef } from "vue";
import {
  addTableColumnV2,
  appendNodeToCellV2,
  cloneNodeWithFreshIdsV2,
  createFieldPNodeV2,
  createGridNodeV2,
  createHtmlNodeV2,
  createImageNodeV2,
  createTableNodeV2,
  createTextNodeV2,
  insertRootGridV2,
  mergeGridCellsV2,
  moveNodeToIndexV2,
  removeNodeV2,
  removeTableColumnV2,
  renameTableColumnKeyV2,
  resizeGridV2,
  setGridColumnWidthV2,
  splitGridCellV2,
  updateBaseRowHeightV2,
  updateGridBorderV2,
  updateGridCellDefaultsV2,
  updateGridGapV2,
  updatePaperConfigV2,
  updateSchemaNodeV2,
  updateTableBorderV2,
  updateTableColumnV2,
  updateTableMinRowsV2,
} from "@/types";
import type {
  BorderModeV2,
  EditorNodeV2,
  FormNodeV2,
  FormSchemaV2,
  GridCellV2,
  GridNodeV2,
  GridRowV2,
  GridTrackV2,
  HeaderFooterV2,
  NodeParamsV2,
  TableColumnV2,
  TextStyleV2,
} from "@/types";
import type { SchemaDocument } from "./useSchemaDocument";
import type { NodeSelection } from "./useNodeSelection";

export type NodeKind = "text" | "field" | "table" | "html" | "image" | "grid";

export interface SchemaEditsContext {
  document: SchemaDocument;
  selection: NodeSelection;
  /** 是否允许结构性编辑（设计态）。 */
  editable: () => boolean;
  /** 结构变化后清空选中（删除 / 撤销等场景）。 */
  clearSelection: () => void;
}

export type SchemaEdits = ReturnType<typeof useSchemaEdits>;

/**
 * 解析「非负数值」输入（padding / gap 等，单位 mm）：
 * 空串 / 非数字 / NaN → `undefined`（移除覆盖，**不静默兜底成 0**）；
 * 合法有限数 → 向下收敛到 0（padding/gap 允许为 0，表示无间距）。
 *
 * 与项目既有金标准 `updateSelectedLineHeight`（`Number.isFinite(value)&&value>0?value:undefined`）
 * 保持一致：空/非法绝不写垃圾进 schema。
 */
function parseNonNegativeMm(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.max(0, n) : undefined;
}

export function useSchemaEdits(ctx: SchemaEditsContext) {
  const { schema, commit } = ctx.document;
  const {
    selectedNodeId,
    selectedNode,
    selectionPathIds,
    selectionPathIndex,
    nodeIndex,
    selectedCellContext,
    selectedOwnerCell,
    insertionSlot,
  } = ctx.selection;

  function createNodeByKind(kind: NodeKind): FormNodeV2 {
    return kind === "text"
      ? createTextNodeV2()
      : kind === "field"
        ? createFieldPNodeV2()
        : kind === "table"
          ? createTableNodeV2()
          : kind === "html"
            ? createHtmlNodeV2()
            : kind === "grid"
              ? createGridNodeV2()
              : createImageNodeV2();
  }

  function addRootGrid(): void {
    if (!ctx.editable()) return;
    const grid = createGridNodeV2();
    commit(insertRootGridV2(schema.value, grid));
    selectedNodeId.value = grid.id;
    selectionPathIds.value = [schema.value.pages[0].id, grid.id];
    selectionPathIndex.value = 1;
  }

  /** 添加 Grid：选中格存在则嵌进该格，否则退化为根追加。 */
  function addGrid(): void {
    if (!ctx.editable()) return;
    if (insertionSlot.value) {
      addNodeToSelectedCell("grid");
    } else {
      addRootGrid();
    }
  }

  function addNodeToSelectedCell(kind: NodeKind): void {
    if (!ctx.editable()) return;
    const ownerCell = insertionSlot.value;
    if (!ownerCell) return;
    const child = createNodeByKind(kind);
    commit(appendNodeToCellV2(schema.value, ownerCell.id, child));
    selectedNodeId.value = child.id;
  }

  function removeSelectedNode(): void {
    if (
      !selectedNodeId.value ||
      selectedNode.value?.type === "page" ||
      selectedNode.value?.type === "grid-cell"
    )
      return;
    commit(removeNodeV2(schema.value, selectedNodeId.value));
    ctx.clearSelection();
  }

  // ── 复制 / 剪切 / 粘贴 / 原地复制（设计器内部内存缓冲） ──
  // 缓冲只存节点深拷贝（已刷新 ID）；粘贴时再次刷新 ID → 可重复粘贴、不与原件/历史撞 ID。
  let clipboard: FormNodeV2 | null = null;
  // 复制/剪切时的源格 id：cut 后选中被清空，作为粘贴的最终兜底落点。
  let clipboardSourceCellId: string | null = null;

  /** 选中节点是否可复制/剪切/原地复制：排除 page 与 grid-cell（无独立复制语义）。 */
  function selectedCopiableNode(): FormNodeV2 | null {
    const node = selectedNode.value;
    return node && node.type !== "page" && node.type !== "grid-cell"
      ? (node as FormNodeV2)
      : null;
  }

  /**
   * 将克隆节点落到合适位置（提交 schema 并选中新节点）：
   * - 选中单元格 → 进该格末尾；
   * - 选中普通组件且其父是格 → 插到它后面（同格、下标+1）；
   * - 否则落到「插入槽」（与新增组件同一落点）；
   * 无合法落点则丢弃克隆、不提交。
   */
  function insertCloneAfterSelectedOrIntoCell(clone: FormNodeV2): void {
    const selNode = selectedNode.value;
    // 选中单元格：粘贴进该格
    if (selNode?.type === "grid-cell") {
      commit(appendNodeToCellV2(schema.value, selNode.id, clone));
      selectedNodeId.value = clone.id;
      return;
    }
    // 选中普通组件且其父是格：插到它后面
    const ownerCell = selectedOwnerCell.value;
    if (selNode && ownerCell) {
      const idx = ownerCell.children.findIndex((c) => c.id === selectedNodeId.value);
      const at = idx >= 0 ? idx + 1 : ownerCell.children.length;
      const appended = appendNodeToCellV2(schema.value, ownerCell.id, clone);
      commit(moveNodeToIndexV2(appended, clone.id, ownerCell.id, at));
      selectedNodeId.value = clone.id;
      return;
    }
    // 落到「插入槽」（新增组件的同一落点）
    const slot = insertionSlot.value;
    if (slot && (slot.type === "grid-cell" || slot.type === "table-cell-template")) {
      commit(appendNodeToCellV2(schema.value, slot.id, clone));
      selectedNodeId.value = clone.id;
      return;
    }
    // 最终兜底：复制/剪切时的源格（cut 后选中已清空，仍能粘贴回原格）
    if (clipboardSourceCellId) {
      const src = nodeIndex.value.get(clipboardSourceCellId)?.node;
      if (src && src.type === "grid-cell") {
        commit(appendNodeToCellV2(schema.value, src.id, clone));
        selectedNodeId.value = clone.id;
        return;
      }
    }
    // 无合法落点：丢弃克隆（不 commit）
  }

  function copySelected(): void {
    if (!ctx.editable()) return;
    const node = selectedCopiableNode();
    if (!node) return;
    clipboard = cloneNodeWithFreshIdsV2(node) as FormNodeV2;
    clipboardSourceCellId = selectedOwnerCell.value?.id ?? null;
  }

  function cutSelected(): void {
    if (!ctx.editable()) return;
    const node = selectedCopiableNode();
    if (!node) return;
    clipboard = cloneNodeWithFreshIdsV2(node) as FormNodeV2;
    clipboardSourceCellId = selectedOwnerCell.value?.id ?? null;
    removeSelectedNode();
  }

  function pasteClipboard(): void {
    if (!ctx.editable()) return;
    if (!clipboard) return;
    insertCloneAfterSelectedOrIntoCell(cloneNodeWithFreshIdsV2(clipboard));
  }

  function duplicateSelected(): void {
    if (!ctx.editable()) return;
    const node = selectedCopiableNode();
    if (!node) return;
    insertCloneAfterSelectedOrIntoCell(cloneNodeWithFreshIdsV2(node) as FormNodeV2);
  }

  // ── 单元格合并 / 拆分 ──
  function mergeSelectedCellRight(): void {
    const id = selectedNodeId.value;
    const cellCtx = selectedCellContext.value;
    if (!id || !cellCtx || !cellCtx.hasNextSibling) return;
    const row = nodeIndex.value.get(id)?.parent as GridRowV2 | undefined;
    if (!row) return;
    const rightId = row.cells[cellCtx.columnIndex + 1].id;
    commit(mergeGridCellsV2(schema.value, id, rightId), `merge:${id}`);
    selectedNodeId.value = id;
  }

  function splitSelectedCell(): void {
    const id = selectedNodeId.value;
    const cellCtx = selectedCellContext.value;
    if (!id || !cellCtx || !cellCtx.canSplit) return;
    commit(splitGridCellV2(schema.value, id), `split:${id}`);
    selectedNodeId.value = id;
  }

  // ── 拖拽重排：落点判定在表面层 CanvasSurface，这里只接收语义事件并提交 schema ──
  function onCanvasNodeDragStart(id: string): void {
    selectedNodeId.value = id;
  }

  function onDropNode(detail: { moveId: string; cellId: string; index: number }): void {
    const next = moveNodeToIndexV2(schema.value, detail.moveId, detail.cellId, detail.index);
    if (next === schema.value) return; // 原位 / 非法：不产生新结构
    commit(next, "move:" + detail.moveId);
    selectedNodeId.value = detail.moveId;
  }

  function onDropPalette(detail: { kind: NodeKind; cellId: string }): void {
    const slot = nodeIndex.value.get(detail.cellId)?.node;
    if (!slot || (slot.type !== "grid-cell" && slot.type !== "table-cell-template")) return;
    const child = createNodeByKind(detail.kind);
    commit(appendNodeToCellV2(schema.value, detail.cellId, child));
    selectedNodeId.value = child.id;
  }

  function updateSelectedNode(
    updater: (node: EditorNodeV2) => EditorNodeV2,
    tag?: string,
  ): void {
    if (!selectedNodeId.value) return;
    commit(updateSchemaNodeV2(schema.value, selectedNodeId.value, updater), tag);
  }

  // ── 字段 P（含点击触发开关） ──
  function updateSelectedText(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    updateSelectedNode(
      (node) => (node.type === "text" ? { ...node, text: value } : node),
      selectedNodeId.value ? `edit:${selectedNodeId.value}` : undefined,
    );
  }

  function updateSelectedField(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    updateSelectedNode(
      (node) => (node.type === "p" && node.mode === "field" ? { ...node, field: value } : node),
      selectedNodeId.value ? `edit:${selectedNodeId.value}` : undefined,
    );
  }

  function updateSelectedPrefix(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    updateSelectedNode(
      (node) =>
        node.type === "p" && node.mode === "field"
          ? { ...node, prefix: value || undefined }
          : node,
      selectedNodeId.value ? `edit:${selectedNodeId.value}` : undefined,
    );
  }

  function updateSelectedSuffix(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    updateSelectedNode(
      (node) =>
        node.type === "p" && node.mode === "field"
          ? { ...node, suffix: value || undefined }
          : node,
      selectedNodeId.value ? `edit:${selectedNodeId.value}` : undefined,
    );
  }

  function updateSelectedWidth(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    updateSelectedNode(
      (node) =>
        node.type === "p" && node.mode === "field"
          ? { ...node, width: value.trim() || undefined }
          : node,
      selectedNodeId.value ? `edit:${selectedNodeId.value}` : undefined,
    );
  }

  function updateSelectedDefault(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    updateSelectedNode(
      (node) =>
        node.type === "p" && node.mode === "field"
          ? { ...node, default: value || undefined }
          : node,
      selectedNodeId.value ? `edit:${selectedNodeId.value}` : undefined,
    );
  }

  function updateSelectedInnerBorder(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    updateSelectedNode(
      (node) =>
        node.type === "p" && node.mode === "field"
          ? { ...node, innerBorder: checked || undefined }
          : node,
      selectedNodeId.value ? `edit:${selectedNodeId.value}` : undefined,
    );
  }

  /**
   * 点击触发开关（`interactive`）：内核只据此决定「填写态点击该字段要不要 emit
   * `field-activate`」——**控件类型不进内核**，由 `params` 承载，宿主自行消费。
   */
  function updateSelectedInteractive(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    updateSelectedNode(
      (node) =>
        node.type === "p" && node.mode === "field"
          ? { ...node, interactive: checked || undefined }
          : node,
      selectedNodeId.value ? `interactive:${selectedNodeId.value}` : undefined,
    );
  }

  // ── 通用「额外属性」（params，SchemaNodeBaseV2）：键值对 → 渲染时作为 HTML 属性插到节点标签 ──
  // 内核不解释任何键；过滤规则见 `src/utils/node-params.ts`（面板对会被丢弃的键标红提示）。
  /** 当前选中节点的 params 副本（缺省空表）。 */
  function currentParams(): NodeParamsV2 {
    const node = selectedNode.value;
    return node && "params" in node ? { ...(node.params ?? {}) } : {};
  }

  /**
   * 写回 params 全表。空表 → `undefined`（不把 `{}` 留在 schema 里，导出更干净；
   * 与 prefix / width 等「空即 undefined」口径一致）。
   *
   * 用 `Object.assign` 而非对象展开：`EditorNodeV2` 是联合类型，展开联合的推断结果
   * 可能丢失成员字段；`Object.assign({}, node, patch)` 的类型是 `EditorNodeV2 & patch`，
   * 可安全赋回。
   */
  function writeParams(next: NodeParamsV2, tag: string): void {
    const params = Object.keys(next).length ? next : undefined;
    updateSelectedNode(
      (node) => Object.assign({}, node, { params }) as EditorNodeV2,
      selectedNodeId.value ? `${tag}:${selectedNodeId.value}` : undefined,
    );
  }

  /** 生成不冲突的新键名（`param1` / `param2` …）：须为小写 ASCII，否则会被内核过滤。 */
  function nextParamKey(params: NodeParamsV2): string {
    let index = Object.keys(params).length + 1;
    while (`param${index}` in params) index += 1;
    return `param${index}`;
  }

  /** 新增一行属性（键自动取名、值留空，由用户填写）。 */
  function addSelectedParam(): void {
    const params = currentParams();
    params[nextParamKey(params)] = "";
    writeParams(params, "param");
  }

  /**
   * 重命名属性键（`change` 提交，非逐键）。
   * - 空键 / 与既有键重名 → **不提交**（记录里无法表达），输入框视觉回退到原键；
   * - 名字合法但与内核黑名单冲突（如 `onclick`）→ **照常写入**，由面板标红提示
   *   「渲染时会被丢弃」——比静默拒绝更利于用户理解规则。
   */
  function renameSelectedParam(oldKey: string, event: Event): void {
    const newKey = (event.target as HTMLInputElement).value.trim();
    if (newKey === oldKey) return;
    const params = currentParams();
    if (!(oldKey in params)) return;
    if (!newKey || newKey in params) {
      (event.target as HTMLInputElement).value = oldKey; // 未提交 → 组件不重渲染，手动回退显示
      return;
    }
    const next: NodeParamsV2 = {};
    for (const [key, value] of Object.entries(params)) {
      if (key === oldKey) next[newKey] = value;
      else next[key] = value;
    }
    writeParams(next, "param");
  }

  /** 修改属性值（逐键提交，per-node tag 在 800ms 内合并为一个撤销步）。 */
  function updateSelectedParamValue(key: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    const params = currentParams();
    if (!(key in params)) return;
    params[key] = value;
    writeParams(params, "param");
  }

  /** 删除一行属性（独立撤销步，不与相邻的值编辑合并）。 */
  function removeSelectedParam(key: string): void {
    const params = currentParams();
    if (!(key in params)) return;
    delete params[key];
    writeParams(params, "paramdel");
  }

  // ── Grid / Table 结构 ──
  function updateGridBorder(event: Event): void {
    if (selectedNode.value?.type !== "grid") return;
    commit(
      updateGridBorderV2(
        schema.value,
        selectedNode.value.id,
        (event.target as HTMLSelectElement).value as BorderModeV2,
      ),
    );
  }

  function updateTableBorder(event: Event): void {
    if (selectedNode.value?.type !== "table") return;
    commit(
      updateTableBorderV2(
        schema.value,
        selectedNode.value.id,
        (event.target as HTMLSelectElement).value as BorderModeV2,
      ),
    );
  }

  function updateGridDimensions(event: Event): void {
    if (selectedNode.value?.type !== "grid") return;
    const input = event.target as HTMLInputElement;
    const parsed = Math.floor(Number(input.value));
    // 空/非法/非正整数 → 不提交，保留现状（不静默兜底成 1）
    if (!Number.isInteger(parsed) || parsed < 1) return;
    const value = parsed;
    const rowCount =
      input.dataset.dimension === "rows" ? value : selectedNode.value.rows.length;
    const columnCount =
      input.dataset.dimension === "columns"
        ? value
        : (selectedNode.value.rows[0]?.cells.length ?? 1);
    commit(resizeGridV2(schema.value, selectedNode.value.id, rowCount, columnCount));
  }

  function updateTableRows(event: Event): void {
    if (selectedNode.value?.type !== "table") return;
    commit(
      updateTableMinRowsV2(
        schema.value,
        selectedNode.value.id,
        Number((event.target as HTMLInputElement).value),
      ),
    );
  }

  function addTableColumn(): void {
    if (selectedNode.value?.type !== "table") return;
    commit(addTableColumnV2(schema.value, selectedNode.value.id));
  }

  function removeTableColumn(columnKey: string): void {
    if (selectedNode.value?.type !== "table") return;
    commit(removeTableColumnV2(schema.value, selectedNode.value.id, columnKey));
  }

  function renameTableColumnKey(oldKey: string, event: Event): void {
    if (selectedNode.value?.type !== "table") return;
    const newKey = (event.target as HTMLInputElement).value.trim();
    if (!newKey || newKey === oldKey) return;
    commit(renameTableColumnKeyV2(schema.value, selectedNode.value.id, oldKey, newKey));
  }

  function updateTableColumn(
    columnKey: string,
    field: "title" | "width" | "align",
    event: Event,
  ): void {
    if (selectedNode.value?.type !== "table") return;
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (field === "width") {
      const parsed = parseColumnWidth(target.value);
      if (parsed === "INVALID") return; // 非法输入不提交，避免误写 24
      commit(
        updateTableColumnV2(schema.value, selectedNode.value.id, columnKey, { width: parsed }),
        `tblcol:${columnKey}:width`,
      );
      return;
    }
    const patch = { [field]: target.value || undefined } as Partial<TableColumnV2>;
    commit(
      updateTableColumnV2(schema.value, selectedNode.value.id, columnKey, patch),
      `tblcol:${columnKey}:${field}`,
    );
  }

  /** 表头样式（字号/粗细/对齐）合并写入 `node.headerStyle`，空/非法值走 undefined 移除覆盖（不静默兜底）。 */
  function updateTableHeaderStyle(patch: Partial<TextStyleV2>): void {
    if (selectedNode.value?.type !== "table") return;
    updateSelectedNode(
      (node) =>
        node.type === "table"
          ? { ...node, headerStyle: { ...node.headerStyle, ...patch } }
          : node,
      selectedNodeId.value ? `tablehdr:${selectedNodeId.value}` : undefined,
    );
  }

  function updateTableHeaderFontSize(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const value = Number(raw);
    // 金标准：非法/空 → undefined（移除覆盖），不静默成 1（对齐项目既定范式）
    updateTableHeaderStyle({ fontSize: Number.isFinite(value) && value > 0 ? value : undefined });
  }

  function updateTableHeaderFontWeight(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    updateTableHeaderStyle({
      fontWeight: (value || undefined) as "normal" | "bold" | undefined,
    });
  }

  function updateTableHeaderAlign(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    updateTableHeaderStyle({
      align: (value || undefined) as "left" | "center" | "right" | undefined,
    });
  }

  /**
   * 解析列宽输入：合法值（number / `Nfr` / `auto`）原样返回；空串视为「回到默认 1fr」；
   * 非法串（非数字、0、负、`.fr` 等）返回 `"INVALID"`，由调用方**忽略**——
   * 绝不静默兜底成 24 把错误值写进 schema（旧实现会这样，导致列宽神秘变成 24 且锁死）。
   */
  function parseColumnWidth(raw: string): GridTrackV2 | "INVALID" {
    const value = raw.trim().toLowerCase();
    if (value === "") return "1fr"; // 空 = 回到默认，而非 24
    if (value === "auto") return "auto";
    if (/^\d+(\.\d+)?fr$/.test(value)) return value as `${number}fr`;
    // 标签声明单位为 mm：允许带 `mm`/`MM` 后缀（含可选空格），剥离后按毫米数值处理，
    // 否则用户照标签输入「30mm」会被误判 INVALID 而静默丢弃（见列宽设置失效回归）。
    const mmMatch = value.match(/^(\d+(?:\.\d+)?)\s*mm$/);
    if (mmMatch) {
      const number = Number(mmMatch[1]);
      return Number.isFinite(number) && number > 0 ? number : "INVALID";
    }
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : "INVALID";
  }

  function updateGridColumnWidth(columnIndex: number, event: Event): void {
    if (selectedNode.value?.type !== "grid") return;
    const parsed = parseColumnWidth((event.target as HTMLInputElement).value);
    if (parsed === "INVALID") return; // 非法输入不提交，避免误写 24
    commit(
      setGridColumnWidthV2(schema.value, selectedNode.value.id, columnIndex, parsed),
      `col:${selectedNode.value.id}:${columnIndex}`,
    );
  }

  // ── Grid 级单元格默认 ──
  function updateGridCellDefault(
    field: "cellPadding" | "cellAlign" | "cellVerticalAlign",
    event: Event,
  ): void {
    if (selectedNode.value?.type !== "grid") return;
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    const raw = target.value;
    const patch =
      field === "cellPadding"
        ? { cellPadding: parseNonNegativeMm(raw) }
        : ({ [field]: raw === "" ? undefined : raw } as Partial<
            Pick<GridNodeV2, "cellAlign" | "cellVerticalAlign">
          >);
    commit(updateGridCellDefaultsV2(schema.value, selectedNode.value.id, patch), `gridcell:${field}`);
  }

  /** 设置 Grid 单元格间距（mm，等价于 CSS gap，同时作用于行与列）。 */
  function updateGridGap(event: Event): void {
    if (selectedNode.value?.type !== "grid") return;
    const raw = (event.target as HTMLInputElement).value;
    const gap = parseNonNegativeMm(raw);
    commit(updateGridGapV2(schema.value, selectedNode.value.id, gap), "gridgap");
  }

  // ── 单元格（grid-cell）覆盖 ──
  function updateSelectedCellPadding(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const value = parseNonNegativeMm(raw); // 空/非法 → undefined（移除覆盖，不静默写 0）
    updateSelectedNode(
      (node) => (node.type === "grid-cell" ? { ...node, padding: value } : node),
      selectedNodeId.value ? `cellpad:${selectedNodeId.value}` : undefined,
    );
  }

  function updateSelectedCellAlign(event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    updateSelectedNode(
      (node) =>
        node.type === "grid-cell"
          ? { ...node, align: (raw || undefined) as GridCellV2["align"] }
          : node,
      selectedNodeId.value ? `cellalign:${selectedNodeId.value}` : undefined,
    );
  }

  function updateSelectedCellVerticalAlign(event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    updateSelectedNode(
      (node) =>
        node.type === "grid-cell"
          ? {
              ...node,
              verticalAlign: (raw || undefined) as GridCellV2["verticalAlign"],
            }
          : node,
      selectedNodeId.value ? `cellvalign:${selectedNodeId.value}` : undefined,
    );
  }

  /** 切换单元格弹性布局（cell.flex）：自身作为水平流式 flex 容器排布子节点。 */
  function updateSelectedCellFlex(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    updateSelectedNode(
      (node) =>
        node.type === "grid-cell"
          ? { ...node, flex: checked || undefined }
          : node,
      selectedNodeId.value ? `cellflex:${selectedNodeId.value}` : undefined,
    );
  }

  function updateSelectedCellRowHeight(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const n = Number(raw);
    // 空/非法/非正 → undefined（移除覆盖，且不写 NaN）；有效才按整数行高写入
    const value = Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
    updateSelectedNode(
      (node) => (node.type === "grid-cell" ? { ...node, rowHeight: value } : node),
      selectedNodeId.value ? `cellrowh:${selectedNodeId.value}` : undefined,
    );
  }

  // ── 文本样式（text / p 共用） ──
  function updateSelectedTextStyle(patch: Partial<TextStyleV2>): void {
    updateSelectedNode(
      (node) =>
        node.type === "p" || node.type === "text"
          ? { ...node, style: { ...node.style, ...patch } }
          : node,
      selectedNodeId.value ? `style:${selectedNodeId.value}` : undefined,
    );
  }

  function updateSelectedFontSize(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const value = Number(raw);
    // 金标准：非法/空 → undefined（移除覆盖），不静默兜底成 1
    updateSelectedTextStyle({
      fontSize: Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined,
    });
  }

  function updateSelectedLineHeight(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    updateSelectedTextStyle({
      lineHeight: Number.isFinite(value) && value > 0 ? value : undefined,
    });
  }

  function updateSelectedFontWeight(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    updateSelectedTextStyle({
      fontWeight: (value || undefined) as "normal" | "bold" | undefined,
    });
  }

  function updateSelectedColor(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    updateSelectedTextStyle({ color: value || undefined });
  }

  function updateSelectedFontFamily(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    updateSelectedTextStyle({ fontFamily: value || undefined });
  }

  function updateSelectedAlign(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    updateSelectedTextStyle({
      align: (value || undefined) as "left" | "center" | "right" | undefined,
    });
  }

  function updateSelectedVerticalAlign(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    updateSelectedTextStyle({
      verticalAlign: (value || undefined) as "top" | "middle" | "bottom" | undefined,
    });
  }

  // ── HTML / Image ──
  function updateSelectedHtml(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    updateSelectedNode(
      (node) => (node.type === "html" ? { ...node, html: value } : node),
      selectedNodeId.value ? `html:${selectedNodeId.value}` : undefined,
    );
  }

  function updateSelectedCss(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    updateSelectedNode(
      (node) => (node.type === "html" ? { ...node, css: value || undefined } : node),
      selectedNodeId.value ? `css:${selectedNodeId.value}` : undefined,
    );
  }

  function updateSelectedImageSrc(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    updateSelectedNode(
      (node) => (node.type === "image" ? { ...node, src: value || undefined } : node),
      selectedNodeId.value ? `imgsrc:${selectedNodeId.value}` : undefined,
    );
  }

  function updateSelectedImageField(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    updateSelectedNode(
      (node) => (node.type === "image" ? { ...node, field: value || undefined } : node),
      selectedNodeId.value ? `imgfield:${selectedNodeId.value}` : undefined,
    );
  }

  function updateSelectedImageSize(dimension: "width" | "height", event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    updateSelectedNode(
      (node) =>
        node.type === "image"
          ? { ...node, [dimension]: Number.isFinite(value) && value > 0 ? value : undefined }
          : node,
      selectedNodeId.value ? `imgsize:${selectedNodeId.value}` : undefined,
    );
  }

  function updateSelectedImageFit(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as "contain" | "cover" | "fill";
    updateSelectedNode(
      (node) => (node.type === "image" ? { ...node, objectFit: value } : node),
      selectedNodeId.value ? `imgfit:${selectedNodeId.value}` : undefined,
    );
  }

  // ── 页面级：行高 / 纸张 ──
  function updateBaseRowHeight(event: Event): void {
    const raw = Number((event.target as HTMLInputElement).value);
    // 空/非法 → 不提交，保留现状（不静默兜底成 8）；有效正整数才写入
    if (!Number.isFinite(raw) || raw < 1) return;
    commit(updateBaseRowHeightV2(schema.value, Math.floor(raw)));
  }

  function updatePaperSize(event: Event): void {
    const size = (event.target as HTMLSelectElement).value as FormSchemaV2["paper"]["size"];
    // 方向自 P11-3 起由纸张尺寸派生（A4→纵向、A3→横向），渲染与打印均忽略 `orientation`
    // 字段（已置为可选废弃键）。仅更新 size，旧 orientation 在内存中置 undefined，序列化导出自然丢弃。
    commit(updatePaperConfigV2(schema.value, { size }));
  }

  /** 纸张边距（mm）：四边独立配置，分别读取首页对应边（缺省 12）。
   *  schema 单页（pages[0]）即唯一页面；多页未来如需分别配置再扩展。 */
  const paperMarginTop: ComputedRef<number> = computed(
    () => schema.value.pages[0]?.margin.top ?? 12,
  );
  const paperMarginRight: ComputedRef<number> = computed(
    () => schema.value.pages[0]?.margin.right ?? 12,
  );
  const paperMarginBottom: ComputedRef<number> = computed(
    () => schema.value.pages[0]?.margin.bottom ?? 12,
  );
  const paperMarginLeft: ComputedRef<number> = computed(
    () => schema.value.pages[0]?.margin.left ?? 12,
  );

  /** 单边边距（mm）：只更新指定边，其余边保持现状（不联动四边）。
   *  空/非法 → 不提交，保留现状（不静默兜底成 0）。 */
  function updatePaperMarginSide(
    side: "top" | "right" | "bottom" | "left",
    event: Event,
  ): void {
    const raw = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(raw)) return;
    const value = Math.max(0, Math.floor(raw));
    commit({
      ...schema.value,
      pages: schema.value.pages.map((page) => ({
        ...page,
        margin: { ...page.margin, [side]: value },
      })),
    });
  }

  // ── 页眉 / 页脚（paper 级全局配置，作用于所有物理页）──────────────
  /**
   * 生成一组页眉 / 页脚更新动作（header / footer 共用同一实现，避免两份重复）。
   *
   * 数值类沿用项目金标准：非法 / 空 → `undefined`（移除覆盖，不静默兜底成 1）；
   * `enabled` / `separator` 是布尔开关，显式写 true/false（未设即关闭 / 默认开启）。
   */
  function makeHeaderFooterUpdaters(kind: "header" | "footer") {
    function current(): HeaderFooterV2 | undefined {
      const paper = schema.value.paper;
      return kind === "header" ? paper?.header : paper?.footer;
    }

    function write(next: HeaderFooterV2): void {
      const paper = schema.value.paper;
      commit({
        ...schema.value,
        paper: kind === "header" ? { ...paper, header: next } : { ...paper, footer: next },
      });
    }

    /** 合并补丁到 `paper[kind]`（未配置时以 `{}` 起步）。 */
    function patch(next: Partial<HeaderFooterV2>): void {
      write({ ...(current() ?? {}), ...next });
    }

    /** 三栏文本：空串视为「未设」（移除该栏），不写入空字符串。 */
    function content(zone: "left" | "center" | "right", event: Event): void {
      const value = (event.target as HTMLInputElement).value;
      const prev = current()?.content ?? {};
      patch({ content: { ...prev, [zone]: value || undefined } });
    }

    function enabled(event: Event): void {
      patch({ enabled: (event.target as HTMLInputElement).checked });
    }

    function height(event: Event): void {
      const raw = Number((event.target as HTMLInputElement).value);
      patch({ height: Number.isFinite(raw) && raw > 0 ? raw : undefined });
    }

    function separator(event: Event): void {
      patch({ separator: (event.target as HTMLInputElement).checked });
    }

    /** 文本样式：生效子集为 `fontSize` / `fontWeight` / `color`。 */
    function style(next: Partial<TextStyleV2>): void {
      const prev = current()?.style ?? {};
      patch({ style: { ...prev, ...next } });
    }

    function fontSize(event: Event): void {
      const raw = Number((event.target as HTMLInputElement).value);
      style({ fontSize: Number.isFinite(raw) && raw > 0 ? raw : undefined });
    }

    function fontWeight(event: Event): void {
      const value = (event.target as HTMLSelectElement).value;
      style({ fontWeight: value === "bold" || value === "normal" ? value : undefined });
    }

    function color(event: Event): void {
      const value = (event.target as HTMLInputElement).value;
      style({ color: value || undefined });
    }

    return { patch, content, enabled, height, separator, style, fontSize, fontWeight, color };
  }

  const headerUpdaters = makeHeaderFooterUpdaters("header");
  const footerUpdaters = makeHeaderFooterUpdaters("footer");

  return {
    addRootGrid,
    addGrid,
    addNodeToSelectedCell,
    removeSelectedNode,
    copySelected,
    cutSelected,
    pasteClipboard,
    duplicateSelected,
    mergeSelectedCellRight,
    splitSelectedCell,
    onCanvasNodeDragStart,
    onDropNode,
    onDropPalette,
    updateSelectedNode,
    updateSelectedText,
    updateSelectedField,
    updateSelectedPrefix,
    updateSelectedSuffix,
    updateSelectedWidth,
    updateSelectedDefault,
    updateSelectedInnerBorder,
    updateSelectedInteractive,
    addSelectedParam,
    renameSelectedParam,
    updateSelectedParamValue,
    removeSelectedParam,
    updateGridBorder,
    updateTableBorder,
    updateGridDimensions,
    updateTableRows,
    addTableColumn,
    removeTableColumn,
    renameTableColumnKey,
    updateTableColumn,
    updateTableHeaderFontSize,
    updateTableHeaderFontWeight,
    updateTableHeaderAlign,
    updateGridColumnWidth,
    updateGridCellDefault,
    updateGridGap,
    updateSelectedCellPadding,
    updateSelectedCellAlign,
    updateSelectedCellVerticalAlign,
    updateSelectedCellFlex,
    updateSelectedCellRowHeight,
    updateSelectedTextStyle,
    updateSelectedFontSize,
    updateSelectedLineHeight,
    updateSelectedFontWeight,
    updateSelectedColor,
    updateSelectedFontFamily,
    updateSelectedAlign,
    updateSelectedVerticalAlign,
    updateSelectedHtml,
    updateSelectedCss,
    updateSelectedImageSrc,
    updateSelectedImageField,
    updateSelectedImageSize,
    updateSelectedImageFit,
    updateBaseRowHeight,
    updatePaperSize,
    paperMarginTop,
    paperMarginRight,
    paperMarginBottom,
    paperMarginLeft,
    updatePaperMarginSide,
    updatePaperHeader: headerUpdaters.patch,
    updatePaperHeaderContent: headerUpdaters.content,
    updatePaperHeaderEnabled: headerUpdaters.enabled,
    updatePaperHeaderHeight: headerUpdaters.height,
    updatePaperHeaderSeparator: headerUpdaters.separator,
    updatePaperHeaderFontSize: headerUpdaters.fontSize,
    updatePaperHeaderFontWeight: headerUpdaters.fontWeight,
    updatePaperHeaderColor: headerUpdaters.color,
    updatePaperFooter: footerUpdaters.patch,
    updatePaperFooterContent: footerUpdaters.content,
    updatePaperFooterEnabled: footerUpdaters.enabled,
    updatePaperFooterHeight: footerUpdaters.height,
    updatePaperFooterSeparator: footerUpdaters.separator,
    updatePaperFooterFontSize: footerUpdaters.fontSize,
    updatePaperFooterFontWeight: footerUpdaters.fontWeight,
    updatePaperFooterColor: footerUpdaters.color,
  };
}
