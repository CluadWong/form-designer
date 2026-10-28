/**
 * Schema 校验层的复合表头口径。
 *
 * 关注两件事：
 * 1. `minNodeHeightMm` 的表格估高必须按**实际表头行数**算，否则装了 N 行表头仍按 1 行估，
 *    「内容超高」会漏报（这里是页面级 PAPER_OVERFLOW 的唯一来源）。
 * 2. 自定义表头排不成矩阵时必须出 warning —— 渲染层会静默回退单行，不说出来用户只会看到「配了没生效」。
 */
import { describe, expect, it } from "vitest";

import type { FormSchemaV2, TableHeaderRowV2, TableNodeV2 } from "@/types/schema-v2";
import { validateFormSchemaV2 } from "@/types/schema-v2-validation";

/** 两行复合表头：4 列 → 收工时间(colspan 2) + 工作负责人(rowspan 2) + 开工时间(col 4)。 */
const COMPOSITE_HEADER: TableHeaderRowV2[] = [
  {
    cells: [
      { text: "收工时间", colspan: 2 },
      { text: "工作负责人", rowspan: 2 },
      { text: "开工时间" },
    ],
  },
  { cells: [{ text: "月" }, { text: "日" }, { text: "时" }] },
];

function makeTable(overrides: Partial<TableNodeV2> = {}): TableNodeV2 {
  return {
    id: "table-1",
    type: "table",
    columns: [
      { key: "month", title: "月" },
      { key: "day", title: "日" },
      { key: "owner", title: "工作负责人" },
      { key: "hour", title: "时" },
    ],
    minRows: 1,
    rowTemplate: ["month", "day", "owner", "hour"].map((columnKey) => ({
      id: `template-${columnKey}`,
      type: "table-cell-template" as const,
      columnKey,
      children: [],
    })),
    ...overrides,
  };
}

/**
 * A4 纵向 + 上下各 100mm 边距 → 一页可用高度 97mm。
 * 网格固定占 `gridRowHeight × 8mm`，表格占 `(表头行数 + 1) × 8mm`，
 * 于是「96mm 不超、104mm 超」这条线正好卡在 1 行表头与 2 行表头之间。
 */
function makeSchema(table: TableNodeV2, gridRowHeight = 10): FormSchemaV2 {
  return {
    version: 2,
    paper: { size: "A4" },
    baseRowHeight: 8,
    pages: [
      {
        id: "page-1",
        type: "page",
        mode: "fixed",
        margin: { top: 100, right: 10, bottom: 100, left: 10 },
        children: [
          {
            id: "grid-1",
            type: "grid",
            border: "all",
            rows: [{ id: "row-1", type: "grid-row", height: gridRowHeight, cells: [] }],
          },
          table,
        ],
      },
    ],
  };
}

function codesOf(schema: FormSchemaV2): string[] {
  return validateFormSchemaV2(schema).map((issue) => issue.code);
}

describe("Schema 校验：复合表头计高", () => {
  it("两行表头按 2 行计高，从而触发「内容超高」", () => {
    // 单行表头 = 80 + (1 + 1) × 8 = 96mm ≤ 97mm，不报
    expect(codesOf(makeSchema(makeTable()))).not.toContain("PAPER_OVERFLOW");
    // 两行表头 = 80 + (2 + 1) × 8 = 104mm > 97mm，报
    expect(codesOf(makeSchema(makeTable({ headerRows: COMPOSITE_HEADER })))).toContain(
      "PAPER_OVERFLOW",
    );
  });

  it("showHeader=false 时表头不计入高度", () => {
    const schema = makeSchema(makeTable({ headerRows: COMPOSITE_HEADER, showHeader: false }));
    expect(codesOf(schema)).not.toContain("PAPER_OVERFLOW");
  });

  it("表头布局非法时渲染回退单行，估高也按单行算（不留误报）", () => {
    // 第 1 行只填了 1 列、剩 3 列空缺 → 求解器回退单行
    const broken: TableHeaderRowV2[] = [{ cells: [{ text: "只有一个格" }] }];
    const schema = makeSchema(makeTable({ headerRows: broken }));
    const codes = codesOf(schema);
    expect(codes).toContain("INVALID_TABLE_HEADER");
    expect(codes).not.toContain("PAPER_OVERFLOW");
  });

  it("合法复合表头不产生 INVALID_TABLE_HEADER", () => {
    expect(codesOf(makeSchema(makeTable({ headerRows: COMPOSITE_HEADER })))).not.toContain(
      "INVALID_TABLE_HEADER",
    );
  });
});
