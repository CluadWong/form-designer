/**
 * 复合表头的**矩阵编辑**（2026-10-27）。
 *
 * 背景：面板原先让用户按「行 → 格」逐条手填 `标题 / 跨列 / 跨行`，与「列配置」两个键值表
 * 各管一半，用户既看不见合并后的落位，也不知道加一列后表头会缺格。
 *
 * 现在面板把表头画成与画布同构的网格：编辑模型就是**带绝对格位的矩阵**
 * （`PlacedTableHeaderCellV2`），用户选中格做「合并 / 拆分 / 删行 / 删格」，
 * 提交前再转回行序列（`headerRows`）。转换与修复都放在这里，面板与 operations 共用。
 *
 * 不变量：**每行每列都必须被占用**。所有操作输出前都应过一遍 `repairHeaderCellsV2`，
 * 于是「缺格 / 重复占用」这类非法态只可能来自手写 JSON，不可能由面板操作产生。
 */

import type { TableHeaderCellV2, TableHeaderRowV2 } from "./schema-v2";
import type { PlacedTableHeaderCellV2 } from "./schema-v2-header";

export type HeaderSpanAxisV2 = "col" | "row";

/** 格位 → 0-based 占用表，值为占据该格的 cell 下标。 */
function occupancy(
  cells: PlacedTableHeaderCellV2[],
  rowCount: number,
  colCount: number,
): Array<Array<number | null>> {
  const grid: Array<Array<number | null>> = Array.from({ length: rowCount }, () =>
    Array<number | null>(colCount).fill(null),
  );
  cells.forEach((cell, index) => {
    for (let r = cell.rowStart; r < cell.rowStart + cell.rowSpan; r += 1) {
      for (let c = cell.colStart; c < cell.colStart + cell.colSpan; c += 1) {
        if (grid[r - 1] && c - 1 < colCount) grid[r - 1][c - 1] = index;
      }
    }
  });
  return grid;
}

/** 补齐空洞：每行每列都必须被占用，空缺处生成空 1×1 格（文字为空）。 */
export function repairHeaderCellsV2(
  cells: PlacedTableHeaderCellV2[],
  rowCount: number,
  colCount: number,
): PlacedTableHeaderCellV2[] {
  const grid = occupancy(cells, rowCount, colCount);
  const filled = [...cells];
  for (let r = 1; r <= rowCount; r += 1) {
    for (let c = 1; c <= colCount; c += 1) {
      if (grid[r - 1][c - 1] !== null) continue;
      filled.push({
        text: "",
        rowStart: r,
        colStart: c,
        rowSpan: 1,
        colSpan: 1,
        borderRight: c < colCount,
        borderBottom: r < rowCount,
      });
    }
  }
  return filled;
}

/**
 * 格位矩阵 → `headerRows`：每行只保留**起始于本行**的格，按起始列排序。
 * 跨行格只在它的起始行出现一次，`rowspan` 由属性表达 —— 与布局求解互为逆运算。
 * span 为 1 时不写属性，导出的 JSON 保持精简（老形态的 `{ text }`）。
 */
export function headerCellsToRowsV2(
  cells: PlacedTableHeaderCellV2[],
  rowCount: number,
): TableHeaderRowV2[] {
  const buckets: Array<Array<{ colStart: number; cell: TableHeaderCellV2 }>> =
    Array.from({ length: rowCount }, () => []);
  for (const cell of cells) {
    if (cell.rowStart < 1 || cell.rowStart > rowCount) continue;
    const item: TableHeaderCellV2 = { text: cell.text };
    if (cell.colSpan > 1) item.colspan = cell.colSpan;
    if (cell.rowSpan > 1) item.rowspan = cell.rowSpan;
    buckets[cell.rowStart - 1].push({ colStart: cell.colStart, cell: item });
  }
  return buckets.map((bucket) => ({
    cells: bucket.sort((a, b) => a.colStart - b.colStart).map((item) => item.cell),
  }));
}

/**
 * 合并方向上的邻格能否被并入。
 *
 * 「每行每列都被占用」是硬不变量，所以合并**不是抢占空位，而是吞掉邻格**：
 * - 向右：右侧那一列必须由「同一行、同样高」的格占据（否则合并后会与它的下半截冲突）；
 * - 向下：下一行在目标的列跨度内必须恰好被若干「单行格」填满。
 *
 * 不满足就禁用按钮 —— 宁可不让用户合，也不产出非法矩阵（非法矩阵会让整张表头回退单行）。
 */
export function canGrowHeaderCellV2(
  cells: PlacedTableHeaderCellV2[],
  rowCount: number,
  colCount: number,
  index: number,
  axis: HeaderSpanAxisV2,
): boolean {
  return growTargets(cells, rowCount, colCount, index, axis) !== null;
}

/** 合并需要吞掉的邻格下标集合（`null` = 不可合并）。 */
function growTargets(
  cells: PlacedTableHeaderCellV2[],
  rowCount: number,
  colCount: number,
  index: number,
  axis: HeaderSpanAxisV2,
): { span: number; victims: number[] } | null {
  const cell = cells[index];
  if (!cell) return null;

  if (axis === "col") {
    const nextCol = cell.colStart + cell.colSpan;
    if (nextCol > colCount) return null;
    const victim = cells.findIndex(
      (item, i) =>
        i !== index &&
        item.rowStart === cell.rowStart &&
        item.colStart === nextCol &&
        item.rowSpan === cell.rowSpan,
    );
    return victim < 0 ? null : { span: cells[victim].colSpan, victims: [victim] };
  }

  const nextRow = cell.rowStart + cell.rowSpan;
  if (nextRow > rowCount) return null;
  const bandEnd = cell.colStart + cell.colSpan;
  const victims: number[] = [];
  let covered = 0;
  cells.forEach((item, i) => {
    if (i === index) return;
    if (item.rowStart !== nextRow || item.rowSpan !== 1) return;
    if (item.colStart < cell.colStart || item.colStart + item.colSpan > bandEnd) return;
    victims.push(i);
    covered += item.colSpan;
  });
  // 该行必须被这些格「正好」铺满目标的列跨度，多一格少一格都不能合。
  return covered === cell.colSpan ? { span: 1, victims } : null;
}

/** 向右 / 向下合并一格（吞掉邻格）；不可合并时返回 `null`（调用方据此禁用按钮）。 */
export function growHeaderCellV2(
  cells: PlacedTableHeaderCellV2[],
  rowCount: number,
  colCount: number,
  index: number,
  axis: HeaderSpanAxisV2,
): PlacedTableHeaderCellV2[] | null {
  const plan = growTargets(cells, rowCount, colCount, index, axis);
  if (!plan) return null;
  const next: PlacedTableHeaderCellV2[] = [];
  cells.forEach((cell, i) => {
    if (plan.victims.includes(i)) return;
    if (i !== index) {
      next.push(cell);
      return;
    }
    next.push(
      axis === "col"
        ? { ...cell, colSpan: cell.colSpan + plan.span }
        : { ...cell, rowSpan: cell.rowSpan + plan.span },
    );
  });
  return next;
}

/** 缩小一格（拆掉最右列 / 最下行）；已是 1 时返回 `null`。拆出的位置由 repair 补空格。 */
export function shrinkHeaderCellV2(
  cells: PlacedTableHeaderCellV2[],
  index: number,
  axis: HeaderSpanAxisV2,
): PlacedTableHeaderCellV2[] | null {
  const cell = cells[index];
  if (!cell) return null;
  if (axis === "col") {
    if (cell.colSpan <= 1) return null;
    return cells.map((item, i) =>
      i === index ? { ...item, colSpan: item.colSpan - 1 } : item,
    );
  }
  if (cell.rowSpan <= 1) return null;
  return cells.map((item, i) =>
    i === index ? { ...item, rowSpan: item.rowSpan - 1 } : item,
  );
}

/**
 * 删除一个表头格：把它的占地交给**同一行紧邻的左格**（高度一致时），否则交给右格。
 * 都不满足（整行只剩这一格）→ 返回 `null`。
 *
 * 不允许直接留空：留空就会变成「缺格」非法态，渲染与分页会整表回退单行表头 ——
 * 用户只是想删掉一个标题，不该把整张复合表头弄塌。
 */
export function deleteHeaderCellV2(
  cells: PlacedTableHeaderCellV2[],
  index: number,
): PlacedTableHeaderCellV2[] | null {
  const cell = cells[index];
  if (!cell) return null;
  const sameRow = cells.filter(
    (item) => item.rowStart === cell.rowStart && item.rowSpan === cell.rowSpan,
  );
  if (sameRow.length <= 1) return null;
  const left = cells.findIndex(
    (item) =>
      item.rowStart === cell.rowStart &&
      item.rowSpan === cell.rowSpan &&
      item.colStart + item.colSpan === cell.colStart,
  );
  if (left >= 0) {
    return cells
      .map((item, i) => (i === left ? { ...item, colSpan: item.colSpan + cell.colSpan } : item))
      .filter((_, i) => i !== index);
  }
  const right = cells.findIndex(
    (item) =>
      item.rowStart === cell.rowStart &&
      item.rowSpan === cell.rowSpan &&
      item.colStart === cell.colStart + cell.colSpan,
  );
  if (right < 0) return null;
  return cells
    .map((item, i) =>
      i === right
        ? { ...item, colStart: cell.colStart, colSpan: item.colSpan + cell.colSpan }
        : item,
    )
    .filter((_, i) => i !== index);
}

/** 末尾追加一行表头：新行全空，由 repair 逐列补满。 */
export function appendHeaderRowV2(
  cells: PlacedTableHeaderCellV2[],
  rowCount: number,
  colCount: number,
): { cells: PlacedTableHeaderCellV2[]; rowCount: number } {
  const nextRowCount = rowCount + 1;
  return {
    cells: repairHeaderCellsV2(cells, nextRowCount, colCount),
    rowCount: nextRowCount,
  };
}

/**
 * 删除一行表头：清掉起始于该行的格，跨过该行的 rowspan 收缩 1，其后各行上移。
 * 只剩一行时返回 `null`（表格至少要有一行表头）。
 */
export function deleteHeaderRowV2(
  cells: PlacedTableHeaderCellV2[],
  rowCount: number,
  colCount: number,
  rowIndex: number,
): { cells: PlacedTableHeaderCellV2[]; rowCount: number } | null {
  if (rowCount <= 1 || rowIndex < 1 || rowIndex > rowCount) return null;
  const kept = cells
    .filter((cell) => cell.rowStart !== rowIndex)
    .map((cell) => {
      let rowStart = cell.rowStart;
      let rowSpan = cell.rowSpan;
      if (rowStart + rowSpan - 1 >= rowIndex && rowStart < rowIndex) rowSpan -= 1;
      if (rowStart > rowIndex) rowStart -= 1;
      return { ...cell, rowStart, rowSpan: Math.max(1, rowSpan) };
    });
  const nextRowCount = rowCount - 1;
  return {
    cells: repairHeaderCellsV2(kept, nextRowCount, colCount),
    rowCount: nextRowCount,
  };
}

/** 末尾新增一列：**触及最右列的格向右扩一格**（每行必有一个，故新列不会留空）。 */
export function insertHeaderColumnV2(
  cells: PlacedTableHeaderCellV2[],
  colCount: number,
): PlacedTableHeaderCellV2[] {
  return cells.map((cell) =>
    cell.colStart + cell.colSpan - 1 === colCount
      ? { ...cell, colSpan: cell.colSpan + 1 }
      : cell,
  );
}

/**
 * 删除一列：覆盖该列的格收缩 1（缩到 0 就删格），右侧格左移一格。
 * 列由「列带」统一增删 —— 表头矩阵自动跟随，用户不再需要两头对齐。
 */
export function removeHeaderColumnV2(
  cells: PlacedTableHeaderCellV2[],
  rowCount: number,
  colCount: number,
  colIndex: number,
): { cells: PlacedTableHeaderCellV2[]; colCount: number } {
  const nextColCount = Math.max(1, colCount - 1);
  const kept: PlacedTableHeaderCellV2[] = [];
  for (const cell of cells) {
    const last = cell.colStart + cell.colSpan - 1;
    const covers = colIndex >= cell.colStart && colIndex <= last;
    const colSpan = covers ? cell.colSpan - 1 : cell.colSpan;
    if (colSpan <= 0) continue;
    const colStart = cell.colStart > colIndex ? cell.colStart - 1 : cell.colStart;
    kept.push({ ...cell, colStart, colSpan });
  }
  return {
    cells: repairHeaderCellsV2(kept, rowCount, nextColCount),
    colCount: nextColCount,
  };
}
