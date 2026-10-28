/**
 * ⚠️ 本文件是「测试夹具」，不是交付样例——请勿以「样例已由 full 取代」为由删除。
 *
 * 被 designer/renderer 与 types 多套测试引用。它是**唯一**覆盖复杂结构（行内多列 /
 * colspan / 合并格 / 表格动态行 / 嵌套 Grid）的 fixture——full 样例是扁平 13-grid、
 * 节点 id 全变（`row-station` / `cell-o-l` / `owner-label` 等在此处才有），无法替代。
 * 删除会直接导致上述测试集体失败。
 *
 * 交付样例是 `@/dev/yunlv-second-ticket-full`（设计器载入与 preview 页预览均用它）。
 * 若觉得本文件"名字像样例、位置像样例"容易误判，下一步可把它移入 `src/dev/fixtures/`
 * （位置本身即语义，需同步改 12 处 import）——但目前先以注释正名。
 */

import type {
  FieldPNodeV2,
  FormNodeV2,
  FormSchemaV2,
  GridCellV2,
  GridNodeV2,
  GridRowV2,
  PNodeV2,
  TableCellTemplateV2,
  TableNodeV2,
  TextNodeV2,
  TextStyleV2,
} from "@/types";
import {
  appendNodeToCellV2,
  createTableNodeV2,
  mergeGridCellsV2,
  setGridColumnWidthV2,
} from "@/types";

/**
 * 云铝电气第二种工作票：标题及「计划工作时间」之前的五个布局行。
 *
 * 结构：1 个外层 Grid（all 边框，id=ticket-layout）+ 5 个内部行，
 * 标题为独立单行无边框 Grid（id=ticket-title-layout）。这样五行同为同一外层 Grid 的内部行，
 * 区块接缝处不会出现 2px 双边框（此前用 4 个并排 all 边框 Grid 会导致接缝双边框）。
 *
 * 构建全程只调用设计器原语（merge / append / setGridColumnWidth），不手写 JSON——即 P10「不修改源码或 JSON」。
 * 显式 id 仅用于快照稳定与测试断言。
 */
export function makeYunlvSecondTicketFirstFiveRowsSchema(): FormSchemaV2 {
  const textNode = (
    id: string,
    text: string,
    style?: TextStyleV2,
  ): TextNodeV2 => ({
    id,
    type: "text",
    text,
    style,
  });
  const fieldP = (
    id: string,
    field: string,
    options: Omit<Partial<FieldPNodeV2>, "id" | "type" | "mode" | "field"> = {},
  ): FieldPNodeV2 => ({
    id,
    type: "p",
    mode: "field",
    field,
    ...options,
  });
  const cell = (
    id: string,
    children: FormNodeV2[],
    options: Omit<GridCellV2, "id" | "type" | "children"> = {},
  ): GridCellV2 => ({ id, type: "grid-cell", children, ...options });
  const row = (id: string, height: number, cells: GridCellV2[]): GridRowV2 => ({
    id,
    type: "grid-row",
    height,
    cells,
  });
  const tableTemplate = (
    id: string,
    columnKey: string,
    child: FormNodeV2,
  ): TableCellTemplateV2 => ({
    id,
    type: "table-cell-template",
    columnKey,
    children: [child],
  });

  const getGrid = (schema: FormSchemaV2, gridId: string): GridNodeV2 => {
    for (const page of schema.pages) {
      for (const child of page.children) {
        if (child.id === gridId && child.type === "grid") return child;
      }
    }
    throw new Error(`grid ${gridId} not found`);
  };

  const titleGrid: GridNodeV2 = {
    id: "ticket-title-layout",
    type: "grid",
    border: "none",
    rows: [
      row("row-title", 2, [
        cell(
          "cell-title",
          [
            textNode("title-text", "云南铝业股份有限公司 电气第二种工作票", {
              align: "center",
              fontSize: 22,
              fontWeight: "bold",
            }),
          ],
          { width: "1fr" },
        ),
      ]),
    ],
  };

  const outer: GridNodeV2 = {
    id: "ticket-layout",
    type: "grid",
    border: "all",
    columns: ["1fr", "1fr", "1fr", "1fr"],
    rows: [
      row("row-unit-number", 1, [
        cell(
          "cell-u-l",
          [textNode("unit-label", "单位", { align: "center" })],
          { width: "1fr" },
        ),
        cell("cell-u-f", [fieldP("unit-field", "单位")], { width: "1fr" }),
        cell(
          "cell-n-l",
          [textNode("number-label", "编号", { align: "center" })],
          { width: "1fr" },
        ),
        cell("cell-n-f", [fieldP("number-field", "编号")], { width: "1fr" }),
      ]),
      row("row-owner-team", 1, [
        cell("cell-o-l", [], { width: "1fr" }),
        cell("cell-o-f", [], { width: "1fr" }),
        cell("cell-ot-l", [], { width: "1fr" }),
        cell("cell-ot-f", [], { width: "1fr" }),
      ]),
      row("row-members", 1, [
        cell("cell-m-l", [], { width: "1fr" }),
        cell("cell-m-f", [], { width: "1fr" }),
        cell("cell-mc-l", [], { width: "1fr" }),
        cell("cell-mc-f", [], { width: "1fr" }),
      ]),
      row("row-station", 1, [
        cell("cell-s-l", [], { width: "1fr" }),
        cell("cell-s-f", [], { width: "1fr" }),
        cell("cell-st-l", [], { width: "1fr" }),
        cell("cell-st-f", [], { width: "1fr" }),
      ]),
      row("row-work-task", 5, [
        cell(
          "cell-wt-label",
          [
            textNode("work-task-label", "工作任务", {
              align: "center",
              verticalAlign: "middle",
              writingMode: "vertical-rl",
              fontWeight: "bold",
            }),
          ],
          { width: "1fr" },
        ),
        cell("cell-wt-r1", [], { width: "1fr" }),
        cell("cell-wt-r2", [], { width: "1fr" }),
        cell("cell-wt-r3", [], { width: "1fr" }),
      ]),
    ],
  };

  let schema: FormSchemaV2 = {
    version: 2,
    paper: { size: "A4" },
    baseRowHeight: 8,
    pages: [
      {
        id: "ticket-page-1",
        type: "page",
        mode: "fixed",
        margin: { top: 10, right: 10, bottom: 10, left: 10 },
        children: [titleGrid, outer],
      },
    ],
  };

  schema = setGridColumnWidthV2(schema, "ticket-layout", 0, 14);
  schema = setGridColumnWidthV2(schema, "ticket-layout", 2, 14);

  const mergeEntireRow = (gridId: string, rowIndex: number): void => {
    let firstId = getGrid(schema, gridId).rows[rowIndex].cells[0].id;
    while (getGrid(schema, gridId).rows[rowIndex].cells.length > 1) {
      const secondId = getGrid(schema, gridId).rows[rowIndex].cells[1].id;
      schema = mergeGridCellsV2(schema, firstId, secondId);
    }
  };
  mergeEntireRow("ticket-layout", 1);
  mergeEntireRow("ticket-layout", 2);
  mergeEntireRow("ticket-layout", 3);

  const mergeRightThree = (gridId: string, rowIndex: number): void => {
    let firstId = getGrid(schema, gridId).rows[rowIndex].cells[1].id;
    while (getGrid(schema, gridId).rows[rowIndex].cells.length > 2) {
      const secondId = getGrid(schema, gridId).rows[rowIndex].cells[2].id;
      schema = mergeGridCellsV2(schema, firstId, secondId);
    }
  };
  mergeRightThree("ticket-layout", 4);

  schema = appendNodeToCellV2(
    schema,
    "cell-o-l",
    textNode("owner-label", "工作负责人（监护人）："),
  );
  schema = appendNodeToCellV2(
    schema,
    "cell-o-l",
    fieldP("owner-field", "工作负责人（监护人）"),
  );
  schema = appendNodeToCellV2(
    schema,
    "cell-o-l",
    textNode("team-label", "班组："),
  );
  schema = appendNodeToCellV2(schema, "cell-o-l", fieldP("team-field", "班组"));

  schema = appendNodeToCellV2(
    schema,
    "cell-m-l",
    textNode("members-label", "工作班成员（不包括工作负责人）："),
  );
  schema = appendNodeToCellV2(
    schema,
    "cell-m-l",
    fieldP("members-field", "工作班成员"),
  );
  schema = appendNodeToCellV2(
    schema,
    "cell-m-l",
    fieldP("member-count-field", "工作班成员人数", {
      prefix: "共",
      suffix: "人",
      style: { align: "center" },
    }),
  );

  schema = appendNodeToCellV2(
    schema,
    "cell-s-l",
    textNode("station-label", "工作的变、配电站名称及设备名称："),
  );
  schema = appendNodeToCellV2(
    schema,
    "cell-s-l",
    fieldP("station-field", "电站设备"),
  );

  const workTaskTable: TableNodeV2 = {
    ...createTableNodeV2(),
    id: "work-task-table",
    field: "工作任务",
    columns: [
      {
        key: "工作地点",
        title: "工作地点或地段",
        width: "1fr",
        align: "center",
      },
      { key: "工作内容", title: "工作内容", width: "1fr", align: "center" },
    ],
    // 行模板内字段由渲染期按「列key_行号」自动派生（见 schema-v2-table-rows.ts 的
    // `bindTableRowCell`），故此处 field 留空；两列 工作地点/工作内容 第 r 行的字段即
    // `工作地点_r` / `工作内容_r`，与 demoData 的内嵌表键一致（P10「数据回写正确」）。
    rowTemplate: [
      tableTemplate("wt-loc-tpl", "工作地点", fieldP("wt-loc", "")),
      tableTemplate("wt-con-tpl", "工作内容", fieldP("wt-con", "")),
    ],
  };
  schema = appendNodeToCellV2(schema, "cell-wt-r1", workTaskTable);

  return schema;
}
