/**
 * Schema V2 分页引擎（DOM 无关、确定性）。
 *
 * 背景：原 `GridFormRenderer` 用纸张 `min-height` 渲染单个逻辑页，内容超高时只是
 * 在单页内继续向下撑开，看不出「超出纸张高度应换页」的效果。本引擎在** Schema 层**
 * 把每个逻辑 `PageSchemaV2` 的内容流切成若干「物理页」——每页只承载能在纸张正文区
 * （纸张高 − 上/下边距）内放下的节点/网格片段，超高部分流向下一页。
 *
 * 为什么在 Schema 层而不是 DOM 测量层：
 * 固定版式表单里 Grid 的每一行高度是确定性值（`row.height × baseRowHeight` mm，
 * cell.rowHeight 可覆盖所在行高），无需渲染后测量即可得到精确行高。因此本引擎对 Grid
 * 做**精确、可测试**的逐行切分；对 Text/Image/Html/Table 这类内容高度不确定的节点，
 * 用启发式估算（并可注入 DOM 测量回调 `measureNode` 提升精度），整块落页或整体换页。
 *
 * 自动分页（2026-09-03 二十续）：纯确定性估算可能误判——多行字段、换行文本、超大图片等
 * 实际渲染高度会高于 `row.height × baseRowHeight` 的估算值，导致引擎认为「放得下」的页
 * 实际却溢出纸张。为此本引擎支持注入**真实测量高度** `measureRow`（逐 Grid 行）与
 * `measureNode`（原子节点），由渲染层在浏览器里测量实际渲染高度后二次校正分页，
 * 保证「内容超高 → 自动换页、永不溢出纸外」（设计态与渲染态共用同一修正通道）。
 *
 * 旧版 v1 引擎（`src/engine`，基于 DOM 测量 + FormSchema/Component 旧模型）已于
 * 2026-09-02 十八续删除；本文件是全项目**唯一**的分页实现。
 *
 * 切分语义：
 * - Grid 可跨页：按行边界切；首个片段保留上边框、末片段保留下边框，中间片段用
 *   `suppressBorders` 抑制上/下边框，使多页连起来像一张被「拆开」的连续表格。
 * - 其它节点为原子块：当前页放得下就放，放不下（且本页已有内容）就换页；单个节点比整页还高
 *   则强制放入并产出 warning（渲染层 overflow 兜底）。
 *
 * 输出 `PhysicalPage[]` 直接喂给渲染层：每个物理页对应一个 `<main class="grid-form-paper">`
 * ，其 `children` 是要渲染的节点/网格片段（`FormNodeV2`，片段即裁剪了 rows 的 GridNodeV2）。
 */

import type {
  EdgeInsetsV2,
  FormDataV2,
  FormNodeV2,
  FormSchemaV2,
  GridNodeV2,
  GridRowV2,
  PageSchemaV2,
  ResolvedPaperSizeV2,
} from "@/types";
import { resolveGridGapV2, resolvePaperSizeV2 } from "@/types";
import {
  DEFAULT_TEXT_FONT_SIZE_PX,
  DEFAULT_TEXT_LINE_HEIGHT,
  resolveBaseFontSizeV2,
  resolveImageSourceV2,
  resolveTableRowCount,
} from "@/engine-v2/derivation";

/** 1px（96DPI 下）换算成 mm，用于外框边框占用的高度。 */
const ONE_PX_MM = 1 / (96 / 25.4); // ≈ 0.264583mm

/** 该 Grid 是否绘制外框（all / outer 才有容器边框）。 */
function drawsOuterFrame(grid: GridNodeV2): boolean {
  return grid.border === "all" || grid.border === "outer";
}

/**
 * 单行高度（mm）。行高 = `max(row.height, 该行任意 cell.rowHeight 覆盖值) × baseRowHeight`，
 * 与 `GridSchemaNode.gridRowStyle` 的 `min-height: row.height * baseRowHeight` 以及
 * cell 的 `min-height: cell.rowHeight * baseRowHeight`（行容器按最高单元格撑开）一致。
 */
export function gridRowHeightMm(
  baseRowHeight: number,
  row: GridRowV2,
  measureRow?: (row: GridRowV2) => number | undefined,
): number {
  // 渲染层注入真实测量高度时优先使用：解决「多行字段 / 换行文本使实际行高高于 row.height 估算」的误判，
  // 让分页按真实渲染高度切分，避免本应换页的页被判定为放得下而溢出纸外。
  if (measureRow) {
    const measured = measureRow(row);
    if (typeof measured === "number" && Number.isFinite(measured) && measured > 0) {
      return measured;
    }
  }
  let factor = row.height;
  for (const cell of row.cells) {
    if (
      typeof cell.rowHeight === "number" &&
      Number.isFinite(cell.rowHeight) &&
      cell.rowHeight > factor
    ) {
      factor = cell.rowHeight;
    }
  }
  return factor * baseRowHeight;
}

/**
 * 一段连续 Grid 行的渲染高度（mm），含行间距与（未抑制的）外框上下边框。
 * @param rows 该片段包含的行（连续）
 * @param suppressTop 是否抑制上边框（非首片段时连续外观用）
 * @param suppressBottom 是否抑制下边框（非末片段时连续外观用）
 * @param measureRow 可选逐行真实测量高度（mm），优先级高于确定性估算。
 */
export function gridFragmentHeightMm(
  baseRowHeight: number,
  grid: GridNodeV2,
  rows: GridRowV2[],
  suppressTop: boolean,
  suppressBottom: boolean,
  measureRow?: (row: GridRowV2) => number | undefined,
): number {
  const gap = resolveGridGapV2(grid);
  let h = 0;
  rows.forEach((row, idx) => {
    if (idx > 0) h += gap;
    h += gridRowHeightMm(baseRowHeight, row, measureRow);
  });
  if (drawsOuterFrame(grid)) {
    if (!suppressTop) h += ONE_PX_MM;
    if (!suppressBottom) h += ONE_PX_MM;
  }
  return h;
}

/**
 * Text 节点估算高度（mm）：按内容宽度估算每行字符数，逐段统计行数 × 行高。
 * @param baseFontSize 全局基础字号（px）：节点未显式设 `style.fontSize` 时的字号基准，
 *   与渲染层纸张上的 `--v2-base-font-size` 同源，保证「屏幕多大字、分页按多大字算高」。
 */
function textHeightMm(
  node: Extract<FormNodeV2, { type: "text" }>,
  contentWidthMm: number,
  baseFontSize?: number,
): number {
  const fontSize = node.style?.fontSize ?? resolveBaseFontSizeV2({ baseFontSize });
  const lineHeight = node.style?.lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT;
  const lineHeightMm = (fontSize * lineHeight) / (96 / 25.4);
  const avgCharMm = Math.max(0.1, (fontSize * 0.6) / (96 / 25.4));
  const charsPerLine = Math.max(1, Math.floor(contentWidthMm / avgCharMm));
  let lines = 0;
  for (const seg of node.text.split("\n")) {
    lines += Math.max(1, Math.ceil(seg.length / charsPerLine));
  }
  return lines * lineHeightMm;
}

/** Image 节点估算高度（mm）：有 height 用 height；仅有 width 时按正方形兜底；都没有用一行基准高。 */
function imageHeightMm(node: Extract<FormNodeV2, { type: "image" }>, baseRowHeight: number): number {
  if (typeof node.height === "number" && Number.isFinite(node.height) && node.height > 0) {
    return node.height;
  }
  if (typeof node.width === "number" && Number.isFinite(node.width) && node.width > 0) {
    return node.width;
  }
  return baseRowHeight;
}

/** Table 节点估算高度（mm）：表头 1 行 + 数据行（minRows 或 data 推导，受 _paginateMaxRows 限制）× baseRowHeight + 外框。 */
export function tableHeightMm(
  node: Extract<FormNodeV2, { type: "table" }>,
  baseRowHeight: number,
  data: FormDataV2 | null | undefined,
): number {
  const totalRows = resolveTableRowCount(node, data);
  // 分页片段可能限制行数（_paginateMaxRows），高度按实际渲染行数算
  const dataRows = typeof node._paginateMaxRows === "number" && node._paginateMaxRows > 0
    ? Math.min(totalRows, node._paginateMaxRows)
    : totalRows;
  let h = (1 + dataRows) * baseRowHeight;
  if (node.border === "all" || node.border === "outer") h += 2 * ONE_PX_MM;
  return h;
}

/** 单个原子节点（非 Grid）的估算高度（mm）。 */
function atomicNodeHeightMm(
  node: FormNodeV2,
  ctx: PaginateContext,
): number {
  if (ctx.measureNode) {
    const measured = ctx.measureNode(node);
    if (typeof measured === "number" && Number.isFinite(measured)) return measured;
  }
  switch (node.type) {
    case "grid":
      // 整 Grid 高度（无抑制边框）
      return gridFragmentHeightMm(ctx.baseRowHeight, node, node.rows, false, false, ctx.measureRow);
    case "image":
      // 与渲染层同口径（`resolveImageSourceV2`）：没配地址、数据也没给图的图片，
      // 屏幕上是占位灰框、**打印时不占版面**，故此处按 0 高度计——否则会算出
      // 一张实际不存在内容的物理页（打印多出空白纸）。
      return resolveImageSourceV2(node, { data: ctx.data }) === null
        ? 0
        : imageHeightMm(node, ctx.baseRowHeight);
    case "text":
      return textHeightMm(node, ctx.contentWidthMm, ctx.baseFontSize);
    case "table":
      return tableHeightMm(node, ctx.baseRowHeight, ctx.data);
    case "html":
      // Html 内容高度不可知，按一行基准高估算并提示（可注入 measureNode 提升精度）
      return ctx.baseRowHeight;
    case "p":
      // 字段 P 在 Grid 外通常占一行；按基准行高估算
      return ctx.baseRowHeight;
  }
}

/** 分页上下文（高度计算所需的一切）。 */
export interface PaginateContext {
  /** 表单基准行高（mm）。 */
  baseRowHeight: number;
  /**
   * 全局基础字号（px）：用于 Text 高度估算的字号基准（未显式设 `style.fontSize` 时）。
   * 与渲染层纸张上的 `--v2-base-font-size` 同源（都由 `resolveBaseFontSizeV2` 解出）。
   * 缺省 / 非法 → 引擎默认 13。
   */
  baseFontSize?: number;
  /** 正文内容区宽度（mm）= 纸张宽 − 左/右边距，用于 Text 折行估算。 */
  contentWidthMm: number;
  /** 正文可用高（mm）= 纸张高 − 上/下边距。 */
  bodyHeightMm: number;
  /** 填写数据（Table 行数推导用），缺省为 null。 */
  data?: FormDataV2 | null;
  /** 可选 DOM 测量回调：返回节点精确高度（mm）或 undefined 走启发式。 */
  measureNode?: (node: FormNodeV2) => number | undefined;
  /** 可选逐 Grid 行测量回调：返回该行真实渲染高度（mm）或 undefined 走确定性估算。
   *  用于自动分页——真实行高（多行字段/换行文本）高于估算值时，按真实高度切分，避免溢出纸外。 */
  measureRow?: (row: GridRowV2) => number | undefined;
}

/** 物理页中的一个子项（节点，或裁剪了 rows 的 Grid 片段）。 */
export interface PhysicalPageChild {
  node: FormNodeV2;
  /** 该片段需抑制的边框侧（Grid 跨页连续外观用）。 */
  suppressBorders?: { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean };
}

/** 一个物理页（对应渲染层一个 `<main class="grid-form-paper">`）。 */
export interface PhysicalPage {
  /** 物理页稳定 id（基于来源逻辑页 id + 序号）。 */
  id: string;
  /** 来源逻辑页 id。 */
  sourcePageId: string;
  /** 在来源逻辑页内的序号（0-based）。 */
  sourceIndex: number;
  /** 整篇文档内的全局物理页序号（1-based，由 paginateSchema 回填）。 */
  index: number;
  /** 该物理页使用的页边距（等于来源逻辑页边距）。 */
  margin: EdgeInsetsV2;
  /** 需渲染的节点/片段。 */
  children: PhysicalPageChild[];
}

/** 分页告警（内容超高被裁剪等）。 */
export interface PaginateWarning {
  nodeId: string;
  message: string;
}

/** 分页结果。 */
export interface PaginateResult {
  pages: PhysicalPage[];
  warnings: PaginateWarning[];
}

/**
 * 分页单个逻辑页，得到 0..N 个物理页。
 * @param page 逻辑页
 * @param opts 分页上下文
 */
export function paginatePage(page: PageSchemaV2, opts: PaginateContext): PaginateResult {
  const warnings: PaginateWarning[] = [];
  const bodyH = Math.max(1, opts.bodyHeightMm);
  const pages: PhysicalPage[] = [];

  // 当前正在构建的物理页（用闭包变量持有，避免对象引用重赋值陷阱）
  let curChildren: PhysicalPageChild[] = [];
  let curUsed = 0;

  const flush = (): void => {
    if (curChildren.length > 0) {
      // 首个物理页复用逻辑页 id（保证 1:1 场景下与旧渲染结构逐字节一致，兼容快照/选择）；
      // 后续片段用合成 id，避免与首个或下一逻辑页冲突。
      const isFirstPhysical = pages.length === 0;
      pages.push({
        id: isFirstPhysical ? page.id : `${page.id}__pp${pages.length}`,
        sourcePageId: page.id,
        sourceIndex: pages.length,
        index: 0,
        margin: page.margin,
        children: curChildren,
      });
      curChildren = [];
      curUsed = 0;
    }
  };

  /** 当前页能否放下高度 h 的块（空页时只要 h≤bodyH 即可）。 */
  const fits = (h: number): boolean => curUsed + h <= bodyH + 1e-6;

  const push = (child: PhysicalPageChild): void => {
    curChildren.push(child);
    curUsed += atomicNodeHeightMm(child.node, opts);
  };

  const paginateAtomic = (node: FormNodeV2): void => {
    const h = atomicNodeHeightMm(node, opts);
    if (!fits(h)) {
      flush();
      if (!fits(h)) {
        warnings.push({
          nodeId: node.id,
          message: `节点（${node.type}）高度约 ${h.toFixed(1)}mm 超过单页可用高 ${bodyH.toFixed(1)}mm，已溢出裁剪`,
        });
      }
    }
    push({ node });
  };

  const paginateGrid = (grid: GridNodeV2): void => {
    const fullH = gridFragmentHeightMm(opts.baseRowHeight, grid, grid.rows, false, false, opts.measureRow);
    // 额外检查：cell 内的 Table 可能使实际高度远超行高估算（2026-09-03 廿一续）。
    // 例如 Grid(1行×8mm) 内含 Table(50数据行×8mm=400mm)，确定性估算只有 8mm 但实际 400+mm。
    // 此时必须走 splitGrid（即使行高估算「放得下」），由 splitGrid 内部检测到 Table 并按数据行切分。
    let hasTallTables = false;
    for (const row of grid.rows) {
      for (const cell of row.cells) {
        for (const child of cell.children) {
          if (child.type === "table") {
            const tableH = tableHeightMm(child, opts.baseRowHeight, opts.data);
            if (tableH > opts.bodyHeightMm * 0.8) { // Table 高度超过正文区 80% → 视为「超高」
              hasTallTables = true;
              break;
            }
          }
        }
        if (hasTallTables) break;
      }
      if (hasTallTables) break;
    }

    // 整 Grid 能放进当前页剩余空间 且无超高Table → 直接放
    if (fits(fullH) && !hasTallTables) {
      push({ node: grid });
      return;
    }
    // ★ 短网格（整格高度 ≤ 单页可用高）且当前页已放不下 → 整格移到下一页，不逐行拆碎。
    //   否则 splitGrid 会逐行填满当前页剩余空间、再在片段之间无条件 flush，把一个本可整页
    //   放下的短网格拆成「首行留在页尾 / 余行被甩到更后一页」的断裂外观（分页异常）。
    //   只有整格高于一页（fullH > bodyH）或含超高 Table 时，才需要跨页逐行切分。
    if (!hasTallTables && fullH <= bodyH + 1e-6) {
      if (curChildren.length > 0) flush();
      push({ node: grid });
      return;
    }
    // 整格高于一页 / 含超高Table → 跨页逐行切分：首个片段先填满当前页剩余空间，余下行流转到后续物理页。
    // （即便当前页已有内容，也优先把能塞下的前几行留在当前页，避免长网格被整体推到下一页而留白。）
    splitGrid(grid);
  };

  /**
   * Table 按数据行跨页切分（2026-09-03 廿一续）。
   *
   * 与 Grid 的 splitGrid 对称：Table 的每一数据行高度均为 baseRowHeight（均匀），
   * 表头固定 1 行（仅首片段保留）。当整 Table 放不下当前页时，按数据行边界切分为
   * 多个片段，每个片段是一个带 `_paginateMaxRows` 限制的 Table 副本。
   *
   * 切分语义：
   * - 首片段：表头(1行) + 数据行 1..N
   * - 后续片段：仅数据行 N+1..M（不重复表头；需要时后续可加表头重复选项）
   * - 单数据行比可用高还高 → 强制放入并告警（与 Grid 单行超高处理一致）
   */
  const paginateTable = (table: Extract<FormNodeV2, { type: "table" }>): void => {
    const totalDataRows = resolveTableRowCount(table, opts.data);
    const rowH = opts.baseRowHeight; // 每数据行高度 = 基准行高
    const headerH = opts.baseRowHeight; // 表头高度 = 基准行高
    const bordered = table.border === "all" || table.border === "outer";
    const borderH = bordered ? ONE_PX_MM : 0;

    // 整 Table 高度 = 表头 + 全部数据行 + 外框
    const fullH = headerH + totalDataRows * rowH + (bordered ? 2 * borderH : 0);

    // 整 Table 放得下 → 直接作为原子块放入（不走切分）
    if (fits(fullH)) {
      push({ node: table });
      return;
    }

    // 放不下 → 按数据行逐行切分
    let remainingRows = totalDataRows;
    let startRow = 0; // 当前片段起始数据行号（0-based）
    let isFirstFragment = true;

    while (remainingRows > 0) {
      const avail = bodyH - curUsed;

      // 当前片段可用的数据行高度预算（扣去表头/边框占用）
      const reserveHeader = isFirstFragment ? headerH + borderH : borderH;
      const budgetForRows = Math.max(0, avail - reserveHeader);

      // 本片段能放的数据行数
      let rowsInFragment = budgetForRows > 0 ? Math.floor(budgetForRows / rowH) : 0;

      // 至少放 1 行数据（即使超出可用高——与 Grid 单行强制放入一致）
      if (rowsInFragment === 0 && remainingRows > 0) {
        rowsInFragment = 1;
        // 如果本页已有内容且连 1 行都放不下 → 先换页
        if (curChildren.length > 0 && reserveHeader + rowH > avail + 1e-6) {
          flush();
          // 换页后重新计算（新页面有完整可用高度）
          continue;
        }
      }

      // 取实际行数（不超过剩余行数）
      rowsInFragment = Math.min(rowsInFragment, remainingRows);

      // 本片段是否为末片段
      const isLastFragment = startRow + rowsInFragment >= totalDataRows;

      // 构建片段 Table 节点（携带 _paginateMaxRows 限制渲染行数）
      const fragmentNode: Extract<FormNodeV2, { type: "table" }> = {
        ...table,
        _paginateMaxRows: rowsInFragment,
      };

      push({
        node: fragmentNode,
        suppressBorders: {
          top: !isFirstFragment, // 后续片段抑制上外框（连续外观）
          bottom: !isLastFragment, // 非末片段抑制下外框
        },
      });

      remainingRows -= rowsInFragment;
      startRow += rowsInFragment;
      isFirstFragment = false;

      // 还有剩余行 → 先 flush 再继续
      if (remainingRows > 0) flush();
    }
  };

/**
 * 从 Grid 行的所有 cell 子节点中收集 Table 节点（2026-09-03 廿一续）。
 * 用于检测单行超高是否由内部 Table 引起，从而触发 Table 级别的跨页切分。
 */
function collectTablesInRow(row: GridRowV2): Extract<FormNodeV2, { type: "table" }>[] {
  const tables: Extract<FormNodeV2, { type: "table" }>[] = [];
  for (const cell of row.cells) {
    for (const child of cell.children) {
      if (child.type === "table") tables.push(child);
    }
  }
  return tables;
}

/**
 * 深拷贝节点树，将其中每个 Table 按 mapFn 替换为带 _paginateMaxRows 限制的版本（2026-09-03 廿一续）。
 * 用于在 Grid 单行跨页切分时，把行内的 Table 同步切成片段。
 */
function mapTablesInNodeTree(
  nodes: FormNodeV2[],
  mapFn: (table: Extract<FormNodeV2, { type: "table" }>) => number | undefined,
): FormNodeV2[] {
  return nodes.map((node) => {
    if (node.type === "grid") {
      return {
        ...node,
        rows: node.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => ({
            ...cell,
            children: mapTablesInNodeTree(cell.children, mapFn),
          })),
        })),
      };
    }
    if (node.type === "table") {
      const maxRows = mapFn(node);
      if (typeof maxRows === "number" && maxRows > 0) {
        return { ...node, _paginateMaxRows: maxRows };
      }
    }
    return node;
  });
}

/** 统计节点树中所有 Table 的数据行总数（用于验证切分行数不丢）。 */
function totalTableDataRowsInRow(row: GridRowV2, data: FormDataV2 | null | undefined): number {
  let total = 0;
  for (const cell of row.cells) {
    for (const node of cell.children) {
      if (node.type === "table") {
        total += resolveTableRowCount(node, data);
      }
    }
  }
  return total;
}

  const splitGrid = (grid: GridNodeV2): void => {
    const rows = grid.rows;
    const gap = resolveGridGapV2(grid);
    const bordered = drawsOuterFrame(grid);
    const mr = opts.measureRow;
    let i = 0;
    let isFirstFragment = true;

    while (i < rows.length) {
      const suppressTop = !isFirstFragment;
      // 当前页可用高
      let avail = bodyH - curUsed;

      // ★ 提前检测：当前行是否包含超高 Table（2026-09-03 廿一续）
      // 若单行内的 Table 总高度超过可用空间，正常行放置循环会把整行「放得下」，
      // 但实际渲染时 Table 内容远超页边界。此时跳过正常循环，直接走 Table 数据行切分。
      const tablesInRow = collectTablesInRow(rows[i]);
      let rowTableH = 0;
      for (const t of tablesInRow) {
        rowTableH += tableHeightMm(t, opts.baseRowHeight, opts.data);
      }
      const rowH = gridRowHeightMm(opts.baseRowHeight, rows[i], mr);
      const gridOverhead = (bordered ? ONE_PX_MM : 0) + rowH; // Grid 行自身 + 外框

      if (tablesInRow.length > 0 && rowTableH > avail - gridOverhead && rows.length - i === 1) {
        // === Table 切分路径：最后一行（或唯一行）内含超高 Table ===
        if (curChildren.length > 0) flush();

        let remaining = 0;
        for (const t of tablesInRow) {
          remaining += resolveTableRowCount(t, opts.data);
        }
        let offset = 0;
        let tblFirst = true;

        while (remaining > 0) {
          const pageAvail = bodyH - curUsed;
          const tableBudget = Math.max(0, pageAvail - gridOverhead);
          let chunk = tableBudget > 0 ? Math.floor(tableBudget / opts.baseRowHeight) : 0;
          if (chunk === 0 && remaining > 0) chunk = 1;
          chunk = Math.min(chunk, remaining);

          const isLast = offset + chunk >= remaining;
          const fragmentCells = rows[i].cells.map((cell) => ({
            ...cell,
            children: mapTablesInNodeTree(cell.children, (tbl) => {
              const total = resolveTableRowCount(tbl, opts.data);
              const ratio = total / Math.max(1, remaining + offset);
              return Math.round(chunk * ratio);
            }),
          }));
          push({
            node: { ...grid, rows: [{ ...rows[i], cells: fragmentCells }] },
            suppressBorders: { top: !tblFirst, bottom: !isLast },
          });

          remaining -= chunk;
          offset += chunk;
          tblFirst = false;
          if (remaining > 0) flush();
        }

        isFirstFragment = false;
        i = i + 1;
        if (i < rows.length) flush();
        continue;
      }

      // === 正常 Grid 行放置循环（无超高 Table 或多行可正常切分）===

      let j = i;
      let acc = suppressTop || !bordered ? 0 : ONE_PX_MM; // 片段上边框（首片段且带框时计入）
      let placed = 0;
      while (j < rows.length) {
        const rowH = gridRowHeightMm(opts.baseRowHeight, rows[j], mr);
        const add = (placed > 0 ? gap : 0) + rowH;
        // 若该片段到此为止（j 是最后一行）→ 末片段需留底边框；否则中间片段无底边框
        const wouldBeLastFragment = j + 1 >= rows.length;
        const reserve = wouldBeLastFragment && bordered ? ONE_PX_MM : 0;
        if (acc + add + reserve <= avail + 1e-6) {
          acc += add;
          placed++;
          j++;
        } else {
          break;
        }
      }

      // 一行都放不下（该行比可用高还高，或本页剩余空间极小）→ 强制换页放至少一行
      // 注：含超高 Table 的单行已在循环入口处提前检测并切分（见上方「Table 切分路径」），
      //       此处仅处理无 Table 的普通超高行（如超大图片/超长文本等原子节点）。
      if (placed === 0) {
        if (curChildren.length > 0) flush();
        const st = !isFirstFragment;
        const sb = i + 1 < rows.length; // 还有后续行 → 抑制底边框（连续）
        const fragH = gridFragmentHeightMm(opts.baseRowHeight, grid, rows.slice(i, i + 1), st, sb, mr);
        if (fragH > bodyH + 1e-6) {
          warnings.push({
            nodeId: grid.id,
            message: `Grid 第 ${i + 1} 行高度约 ${fragH.toFixed(1)}mm 超过单页可用高，已溢出裁剪`,
          });
        }
        push({ node: { ...grid, rows: rows.slice(i, i + 1) }, suppressBorders: { top: st, bottom: sb } });
        isFirstFragment = false;
        i = i + 1;
        if (i < rows.length) flush();
        continue;
      }

      const moreRemain = j < rows.length;
      const st = suppressTop;
      const sb = moreRemain; // 后续还有片段 → 抑制底边框（连续外观）
      push({
        node: { ...grid, rows: rows.slice(i, j), id: grid.id },
        suppressBorders: { top: st, bottom: sb },
      });
      isFirstFragment = false;
      i = j;
      if (moreRemain) flush();
    }
  };

  for (const node of page.children) {
    if (node.type === "grid") paginateGrid(node);
    else if (node.type === "table") paginateTable(node);
    else paginateAtomic(node);
  }
  flush();

  // 兜底：空逻辑页（无子节点）也至少产出一张物理纸，保证纸张元素与 @page 注入始终存在。
  if (pages.length === 0) {
    pages.push({
      id: page.id,
      sourcePageId: page.id,
      sourceIndex: 0,
      index: 0,
      margin: page.margin,
      children: [],
    });
  }

  return { pages, warnings };
}

/**
 * 分页整篇 Schema：逐逻辑页分页后拼接，回填全局物理页序号。
 * @param schema 表单 Schema
 * @param extra 额外上下文（data / measureNode）；baseRowHeight 取自 schema
 */
export function paginateSchema(
  schema: FormSchemaV2,
  extra?: {
    data?: FormDataV2 | null;
    measureNode?: PaginateContext["measureNode"];
    measureRow?: PaginateContext["measureRow"];
  },
): PaginateResult {
  const paper: ResolvedPaperSizeV2 = resolvePaperSizeV2(schema.paper);
  const all: PhysicalPage[] = [];
  const warnings: PaginateWarning[] = [];
  for (const page of schema.pages) {
    const bodyHeightMm = paper.heightMm - page.margin.top - page.margin.bottom;
    const contentWidthMm = paper.widthMm - page.margin.left - page.margin.right;
    const r = paginatePage(page, {
      baseRowHeight: schema.baseRowHeight,
      // 全局基础字号（页面属性配置）参与 Text 高度估算；未设时 resolve 回退 13。
      baseFontSize: resolveBaseFontSizeV2(schema),
      bodyHeightMm,
      contentWidthMm,
      data: extra?.data ?? null,
      measureNode: extra?.measureNode,
      measureRow: extra?.measureRow,
    });
    all.push(...r.pages);
    warnings.push(...r.warnings);
  }
  all.forEach((p, idx) => (p.index = idx + 1));
  return { pages: all, warnings };
}
