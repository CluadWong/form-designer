/**
 * 复合表头的矩阵编辑算子（2026-10-27）。
 *
 * 面板把表头画成网格后，所有结构操作都在「带绝对格位的矩阵」上进行，
 * 再转回 `headerRows` 提交。本文件锁住三件事：
 * 1. 矩阵 ⇄ 行序列互为逆运算（往返不丢 span、不丢文字、不写冗余 span=1）；
 * 2. 增删列同步矩阵（加列向右扩最右格、删列收缩并把右侧左移）；
 * 3. 任何操作后**每行每列都被占用** —— 面板不可能产出「缺格」这种非法布局。
 */
import { describe, expect, it } from "vitest";

import type { FormSchemaV2, TableHeaderRowV2, TableNodeV2 } from "@/types/schema-v2";
import { resolveTableHeaderLayoutV2 } from "@/types/schema-v2-header";
import {
  appendHeaderRowV2,
  deleteHeaderCellV2,
  deleteHeaderRowV2,
  growHeaderCellV2,
  headerCellsToRowsV2,
  insertHeaderColumnV2,
  removeHeaderColumnV2,
  repairHeaderCellsV2,
  shrinkHeaderCellV2,
} from "@/types/schema-v2-header-edit";
import {
  addTableColumnV2,
  removeTableColumnV2,
  resetTableHeaderRowsV2,
} from "@/types/schema-v2-operations";

/**
 * 4 列 × 2 行：收工时间(colspan 2) + 工作负责人(rowspan 2) + 时(rowspan 2) / 月 + 日。
 * 「时」必须跨行 —— 否则第 2 行第 4 列空着，布局求解会判 "缺格"（这正是旧面板手填 span 的常态）。
 */
const COMPOSITE: TableHeaderRowV2[] = [
  {
    cells: [
      { text: "收工时间", colspan: 2 },
      { text: "工作负责人", rowspan: 2 },
      { text: "时", rowspan: 2 },
    ],
  },
  { cells: [{ text: "月" }, { text: "日" }] },
];

function makeTable(overrides: Partial<TableNodeV2> = {}): TableNodeV2 {
  return {
    id: "table-1",
    type: "table",
    columns: [
      { key: "month", title: "月", width: "1fr" },
      { key: "day", title: "日", width: "1fr" },
      { key: "owner", title: "工作负责人", width: "1fr" },
      { key: "hour", title: "时", width: "1fr" },
    ],
    minRows: 1,
    rowTemplate: ["month", "day", "owner", "hour"].map((columnKey) => ({
      id: `template-${columnKey}`,
      type: "table-cell-template" as const,
      columnKey,
      children: [],
    })),
    headerRows: COMPOSITE,
    ...overrides,
  };
}

function makeSchema(table: TableNodeV2): FormSchemaV2 {
  return {
    version: 2,
    paper: { size: "A4" },
    rows: [],
    pages: [
      {
        id: "page-1",
        type: "page",
        mode: "fixed",
        margin: { top: 10, right: 10, bottom: 10, left: 10 },
        children: [table],
      },
    ],
  } as unknown as FormSchemaV2;
}

/** 窄表：只保留前 N 列，供「合并会与邻格高度冲突」这类小场景使用。 */
function narrowTable(headerRows: TableHeaderRowV2[], columnCount = 2): TableNodeV2 {
  const columns = Array.from({ length: columnCount }, (_, i) => ({
    key: `c${i + 1}`,
    title: `C${i + 1}`,
  }));
  return {
    ...makeTable({ headerRows }),
    columns,
    rowTemplate: columns.map((column) => ({
      id: `template-${column.key}`,
      type: "table-cell-template" as const,
      columnKey: column.key,
      children: [],
    })),
  };
}

/** 求解 + 断言：布局必须合法（每行占满、无重复占用）。 */
function layoutOf(node: TableNodeV2) {
  const layout = resolveTableHeaderLayoutV2(node);
  expect(layout.issues).toEqual([]);
  expect(layout.valid).toBe(true);
  return layout;
}

describe("矩阵 ⇄ 行序列", () => {
  it("往返不丢 span / 文字，且 span=1 不写属性", () => {
    const node = makeTable();
    const layout = layoutOf(node);
    const rows = headerCellsToRowsV2(layout.cells, layout.rowCount);
    expect(rows).toEqual(COMPOSITE);
  });

  it("repair 补齐空洞后每行占满", () => {
    const node = makeTable();
    const layout = layoutOf(node);
    // 人为造一个洞：抽掉第 2 行第 2 列的表头格（模拟手写 JSON 缺格）
    const dropped = layout.cells.filter(
      (cell) => !(cell.rowStart === 2 && cell.colStart === 2),
    );
    const repaired = repairHeaderCellsV2(dropped, layout.rowCount, layout.columnCount);
    const rows = headerCellsToRowsV2(repaired, layout.rowCount);
    const relayout = resolveTableHeaderLayoutV2({ ...node, headerRows: rows });
    expect(relayout.valid).toBe(true);
    expect(rows[1].cells).toEqual([{ text: "月" }, { text: "" }]);
  });
});

describe("合并 / 拆分 / 删格", () => {
  it("向右合并：吞掉右邻格，span 累加", () => {
    const node = makeTable();
    const layout = layoutOf(node);
    const index = layout.cells.findIndex((cell) => cell.text === "月");
    const grown = growHeaderCellV2(layout.cells, layout.rowCount, layout.columnCount, index, "col")!;
    const rows = headerCellsToRowsV2(grown, layout.rowCount);
    expect(rows[1].cells).toEqual([{ text: "月", colspan: 2 }]);
    expect(resolveTableHeaderLayoutV2({ ...node, headerRows: rows }).valid).toBe(true);
  });

  it("向下合并：吞掉下方同列范围的格，rowspan+1", () => {
    const node = narrowTable([
      { cells: [{ text: "A" }, { text: "B" }] },
      { cells: [{ text: "C" }, { text: "D" }] },
    ]);
    const layout = layoutOf(node);
    const index = layout.cells.findIndex((cell) => cell.text === "A");
    const grown = growHeaderCellV2(layout.cells, layout.rowCount, layout.columnCount, index, "row")!;
    const rows = headerCellsToRowsV2(grown, layout.rowCount);
    expect(rows[0].cells[0]).toEqual({ text: "A", rowspan: 2 });
    // C 被吞掉，B / D 保留 → 两行仍占满
    expect(rows[0].cells.map((cell) => cell.text)).toEqual(["A", "B"]);
    expect(rows[1].cells.map((cell) => cell.text)).toEqual(["D"]);
    expect(resolveTableHeaderLayoutV2({ ...node, headerRows: rows }).valid).toBe(true);
  });

  it("不可合并：已在最右列 / 右邻高度不一致", () => {
    // 2 列 2 行：A 只占 1 行，右邻 B 跨 2 行 → 合并会与 B 的下半截冲突
    const node = narrowTable([
      { cells: [{ text: "A" }, { text: "B", rowspan: 2 }] },
      { cells: [{ text: "C" }] },
    ]);
    const layout = layoutOf(node);
    const a = layout.cells.findIndex((cell) => cell.text === "A");
    expect(growHeaderCellV2(layout.cells, layout.rowCount, layout.columnCount, a, "col")).toBeNull();
    const b = layout.cells.findIndex((cell) => cell.text === "B");
    expect(growHeaderCellV2(layout.cells, layout.rowCount, layout.columnCount, b, "col")).toBeNull();
  });

  it("拆分跨列格：让出的列补空格，布局仍合法", () => {
    const node = makeTable();
    const layout = layoutOf(node);
    const index = layout.cells.findIndex((cell) => cell.text === "收工时间");
    const shrunk = shrinkHeaderCellV2(layout.cells, index, "col")!;
    const rows = headerCellsToRowsV2(
      repairHeaderCellsV2(shrunk, layout.rowCount, layout.columnCount),
      layout.rowCount,
    );
    expect(rows[0].cells[0]).toEqual({ text: "收工时间" });
    expect(resolveTableHeaderLayoutV2({ ...node, headerRows: rows }).valid).toBe(true);
  });

  it("span 已是 1 时不可再拆", () => {
    const node = makeTable();
    const layout = layoutOf(node);
    const index = layout.cells.findIndex((cell) => cell.text === "月");
    expect(shrinkHeaderCellV2(layout.cells, index, "col")).toBeNull();
    expect(shrinkHeaderCellV2(layout.cells, index, "row")).toBeNull();
  });

  it("删格：占地并入同行左邻，行仍占满", () => {
    const node = makeTable();
    const layout = layoutOf(node);
    const index = layout.cells.findIndex((cell) => cell.text === "日");
    const next = deleteHeaderCellV2(layout.cells, index)!;
    const rows = headerCellsToRowsV2(next, layout.rowCount);
    expect(rows[1].cells).toEqual([{ text: "月", colspan: 2 }]);
    expect(resolveTableHeaderLayoutV2({ ...node, headerRows: rows }).valid).toBe(true);
  });

  it("右邻高度不一致时不可删格（否则会错位）", () => {
    const node = makeTable();
    const layout = layoutOf(node);
    const index = layout.cells.findIndex((cell) => cell.text === "收工时间");
    expect(deleteHeaderCellV2(layout.cells, index)).toBeNull();
  });
});

describe("增删行", () => {
  it("追加一行：新行逐列补满", () => {
    const node = makeTable();
    const layout = layoutOf(node);
    const next = appendHeaderRowV2(layout.cells, layout.rowCount, layout.columnCount);
    expect(next.rowCount).toBe(3);
    const rows = headerCellsToRowsV2(next.cells, next.rowCount);
    expect(rows[2].cells).toHaveLength(4);
    expect(resolveTableHeaderLayoutV2({ ...node, headerRows: rows }).valid).toBe(true);
  });

  it("删除首行：跨行格随起始行一并删除，其余行上移并补满", () => {
    const node = makeTable();
    const layout = layoutOf(node);
    const next = deleteHeaderRowV2(layout.cells, layout.rowCount, layout.columnCount, 1)!;
    const rows = headerCellsToRowsV2(next.cells, next.rowCount);
    expect(rows).toHaveLength(1);
    // 第 1 行三格（含 rowspan=2 的「工作负责人」）随该行删除；第 2 行的「月 / 日」上移，
    // 剩下两列由空格补满 —— 面板不会留下"缺格"。
    expect(rows[0].cells.map((cell) => cell.text)).toEqual(["月", "日", "", ""]);
    expect(resolveTableHeaderLayoutV2({ ...node, headerRows: rows }).valid).toBe(true);
  });

  it("只剩一行时不可删行", () => {
    const node = makeTable();
    const layout = layoutOf(node);
    expect(deleteHeaderRowV2(layout.cells, 1, layout.columnCount, 1)).toBeNull();
  });
});

describe("增删列同步矩阵", () => {
  it("insertHeaderColumnV2：触及最右列的格向右扩一格", () => {
    const node = makeTable();
    const layout = layoutOf(node);
    const rows = headerCellsToRowsV2(
      insertHeaderColumnV2(layout.cells, layout.columnCount),
      layout.rowCount,
    );
    // 只有真正触及最右列（第 4 列）的格才扩展：第 1 行的「时」→ colspan 2，第 2 行的「日」不触及
    expect(rows[0].cells.at(-1)).toEqual({ text: "时", colspan: 2, rowspan: 2 });
    expect(rows[1].cells.at(-1)).toEqual({ text: "日" });
  });

  it("removeHeaderColumnV2：覆盖该列的格收缩，右侧左移", () => {
    const node = makeTable();
    const layout = layoutOf(node);
    const pruned = removeHeaderColumnV2(layout.cells, layout.rowCount, layout.columnCount, 1);
    expect(pruned.colCount).toBe(3);
    const rows = headerCellsToRowsV2(pruned.cells, layout.rowCount);
    expect(rows[0].cells.map((cell) => cell.text)).toEqual(["收工时间", "工作负责人", "时"]);
    expect(rows[0].cells[0].colspan).toBeUndefined();
    // 「月」随该列删除，「日」左移；第 2 行其余列由两张跨行格继续占位
    expect(rows[1].cells.map((cell) => cell.text)).toEqual(["日"]);
  });

  it("addTableColumnV2：列与表头一次到位，布局保持合法", () => {
    const node = makeTable();
    const schema = makeSchema(node);
    const next = addTableColumnV2(schema, node.id) as FormSchemaV2;
    const table = (next.pages[0].children[0] as TableNodeV2);
    expect(table.columns).toHaveLength(5);
    expect(table.rowTemplate).toHaveLength(5);
    const layout = layoutOf(table);
    expect(layout.columnCount).toBe(5);
  });

  it("removeTableColumnV2：删列后表头不缺格", () => {
    const node = makeTable();
    const schema = makeSchema(node);
    const next = removeTableColumnV2(schema, node.id, "day") as FormSchemaV2;
    const table = next.pages[0].children[0] as TableNodeV2;
    expect(table.columns.map((column) => column.key)).toEqual(["month", "owner", "hour"]);
    layoutOf(table);
  });

  it("未配矩阵（单行投影）时增删列不写入 headerRows", () => {
    const node = makeTable({ headerRows: undefined });
    const schema = makeSchema(node);
    const added = addTableColumnV2(schema, node.id) as FormSchemaV2;
    const table = added.pages[0].children[0] as TableNodeV2;
    expect(table.headerRows).toBeUndefined();

    const removed = removeTableColumnV2(schema, node.id, "day") as FormSchemaV2;
    expect((removed.pages[0].children[0] as TableNodeV2).headerRows).toBeUndefined();
  });
});

describe("恢复单行表头", () => {
  it("把首行文字摊平回列标题，再移除矩阵（字不丢）", () => {
    const node = makeTable();
    const schema = makeSchema(node);
    const next = resetTableHeaderRowsV2(schema, node.id) as FormSchemaV2;
    const table = next.pages[0].children[0] as TableNodeV2;
    expect(table.headerRows).toBeUndefined();
    // 收工时间 跨 2 列：文字落到第 1 列，第 2 列留空（与渲染的视觉一致）
    expect(table.columns.map((column) => column.title)).toEqual([
      "收工时间",
      "",
      "工作负责人",
      "时",
    ]);
  });

  it("未配矩阵时是空操作", () => {
    const node = makeTable({ headerRows: undefined });
    const schema = makeSchema(node);
    expect(resetTableHeaderRowsV2(schema, node.id)).toEqual(schema);
  });
});
