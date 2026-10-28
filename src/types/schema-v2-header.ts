/**
 * 表格复合表头的纯布局求解（2026-10-23）。
 *
 * 住在 types 层而不是 engine 层，是为了让**渲染、分页、面板、Schema 校验**四方共用同一答案：
 * 校验层（`schema-v2-validation`）算「表格最低高度」时要数表头行数，而 types 层不能反向依赖
 * `engine-v2/derivation`（那样会形成 types ⇄ engine 的循环）。
 *
 * 本模块只依赖 `./schema-v2` 的类型，无运行时依赖、无副作用。
 * `engine-v2/derivation` 原样再导出这些符号，历史引用无需改动。
 */

import type { TableNodeV2, TableHeaderRowV2 } from "./schema-v2";

/** span 归一化：非整数 / ≤0 / 缺省一律按 1（宁可画成单格，也不让布局求解抛错）。 */
function normalizeHeaderSpan(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 1;
}

/**
 * 生效的表头矩阵。
 * 未配置 `headerRows`（或配成空数组）时回落到「columns 的单行标题投影」——
 * 老模板的渲染结构与快照零变化。
 */
export function resolveTableHeaderRowsV2(node: TableNodeV2): TableHeaderRowV2[] {
  if (node.headerRows && node.headerRows.length > 0) return node.headerRows;
  return [{ cells: node.columns.map((column) => ({ text: column.title })) }];
}

/** 已定位的表头单元格：格位为 1-based，可直接落到 CSS grid 的 start / span。 */
export interface PlacedTableHeaderCellV2 {
  text: string;
  rowStart: number;
  colStart: number;
  rowSpan: number;
  colSpan: number;
  /** 右边缘是否画内部竖线（该格未触及最右一列）。 */
  borderRight: boolean;
  /** 下边缘是否画内部横线（该格未触及表头最后一行）。 */
  borderBottom: boolean;
}

export interface ResolvedTableHeaderV2 {
  /** 实际生效的矩阵（布局非法时已回退为单行，与渲染、分页保持同一答案）。 */
  rows: TableHeaderRowV2[];
  cells: PlacedTableHeaderCellV2[];
  rowCount: number;
  columnCount: number;
  /** 布局是否自洽：每行被覆盖的列数 = 列数，且无越界 / 重叠。 */
  valid: boolean;
  /** 面向面板的中文问题描述；`valid` 为 true 时为空数组。 */
  issues: string[];
}

/**
 * 求解复合表头布局：把「行 × 单元格（带 span）」摊平成带绝对格位的矩阵。
 *
 * 填格规则与 HTML 表格一致：按行、按列顺序放置，`rowspan` 会让下方若干行的对应列被占用，
 * 后续单元格顺延到下一个空位。求解结果同时给出**边框归属**（只画每格的右 / 下边），
 * 避免合并格与邻格各画一条线、叠成 2px。
 *
 * 布局非法（某行有空列 / 重复占用 / span 越界）时把 `cells` 与 `rows` 回退为单行表头，
 * 并把原因写入 `issues`。这样「当前到底画几行」在渲染、分页、面板、校验四处只有一个答案。
 */
export function resolveTableHeaderLayoutV2(node: TableNodeV2): ResolvedTableHeaderV2 {
  const columnCount = node.columns.length;
  const rawRows = resolveTableHeaderRowsV2(node);
  const issues: string[] = [];

  /** 单行投影（也是布局非法时的兜底形态）。 */
  const singleRow = (valid: boolean): ResolvedTableHeaderV2 => ({
    rows: [{ cells: node.columns.map((column) => ({ text: column.title })) }],
    cells: node.columns.map((column, index) => ({
      text: column.title,
      rowStart: 1,
      colStart: index + 1,
      rowSpan: 1,
      colSpan: 1,
      borderRight: index + 1 < columnCount,
      borderBottom: false,
    })),
    rowCount: 1,
    columnCount,
    valid,
    issues,
  });

  if (columnCount === 0) {
    issues.push("表格没有列，表头无法布局");
    return singleRow(false);
  }

  const occupied: boolean[][] = rawRows.map(() =>
    Array<boolean>(columnCount).fill(false),
  );
  const cells: PlacedTableHeaderCellV2[] = [];

  for (let r = 0; r < rawRows.length; r += 1) {
    let cursor = 0;
    for (const cell of rawRows[r].cells) {
      const colSpan = normalizeHeaderSpan(cell.colspan);
      const rowSpan = normalizeHeaderSpan(cell.rowspan);
      // 跳过被上方 rowspan 占用的列
      while (cursor < columnCount && occupied[r][cursor]) cursor += 1;
      const name = cell.text || "(空标题)";
      if (cursor + colSpan > columnCount) {
        issues.push(`第 ${r + 1} 行「${name}」跨列后超出 ${columnCount} 列`);
        return singleRow(false);
      }
      if (r + rowSpan > rawRows.length) {
        issues.push(`第 ${r + 1} 行「${name}」跨行超出 ${rawRows.length} 行表头`);
        return singleRow(false);
      }
      for (let rr = r; rr < r + rowSpan; rr += 1) {
        for (let cc = cursor; cc < cursor + colSpan; cc += 1) {
          if (occupied[rr][cc]) {
            issues.push(`第 ${rr + 1} 行第 ${cc + 1} 列被多个表头格重复占用`);
            return singleRow(false);
          }
          occupied[rr][cc] = true;
        }
      }
      cells.push({
        text: cell.text,
        rowStart: r + 1,
        colStart: cursor + 1,
        rowSpan,
        colSpan,
        borderRight: cursor + colSpan < columnCount,
        borderBottom: r + rowSpan < rawRows.length,
      });
      cursor += colSpan;
    }
  }

  // 每行都必须被占满（rowspan 占位也算）：否则该行会留出空格，视觉上是漏线的洞。
  for (let r = 0; r < rawRows.length; r += 1) {
    const missing = occupied[r]
      .map((filled, index) => (filled ? -1 : index + 1))
      .filter((index) => index > 0);
    if (missing.length > 0) {
      issues.push(`第 ${r + 1} 行缺少第 ${missing.join("、")} 列的表头格`);
      return singleRow(false);
    }
  }

  return {
    rows: rawRows,
    cells,
    rowCount: rawRows.length,
    columnCount,
    valid: true,
    issues,
  };
}

/**
 * 实际渲染的表头行数：`showHeader === false` 或续页隐藏片段（`_paginateHideHeader`）→ 0；
 * 布局非法时按回退后的单行计 1。
 * 渲染层、分页算高、Schema 校验共用本函数，避免「算着有表头、实际没画」。
 */
export function resolveTableHeaderRowCountV2(node: TableNodeV2): number {
  if (node.showHeader === false) return 0;
  if (node._paginateHideHeader === true) return 0;
  return resolveTableHeaderLayoutV2(node).rowCount;
}
