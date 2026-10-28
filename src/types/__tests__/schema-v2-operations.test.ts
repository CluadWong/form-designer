import { describe, expect, it } from "vitest";
import { resolveCellBoxV2 } from "@/engine-v2/derivation";
import { makeYunlvSecondTicketFirstFiveRowsSchema } from "@/dev/yunlv-second-ticket-first-five-rows";
import {
  appendNodeToCellV2,
  createEmptyFormSchemaV2,
  createGridNodeV2,
  createGridRowV2,
  createTextNodeV2,
  createTableNodeV2,
  createHtmlNodeV2,
  createImageNodeV2,
  insertRootGridV2,
  moveGridRowV2,
  removeNodeV2,
  resizeGridV2,
  setGridColumnWidthV2,
  resizeGridRowV2,
  resizeGridCellLayoutV2,
  splitGridCellRowsV2,
  splitGridRowV2,
  updateGridRowHeightV2,
  updateTableMinRowsV2,
  updateTableRepeatHeaderV2,
  updateTableShowHeaderV2,
  addTableColumnV2,
  removeTableColumnV2,
  updateTableColumnV2,
  updateSchemaNodeV2,
  updateCellPaddingV2,
  updateCellAlignV2,
  updateCellVerticalAlignV2,
  updateGridCellDefaultsV2,
  updateGridGapV2,
  resolveGridGapV2,
  cloneNodeWithFreshIdsV2,
  copyGridRowV2,
  mergeGridCellsV2,
  moveNodeV2,
  moveNodeToIndexV2,
  moveNodeWithinParentV2,
  listDropTargetsV2,
  splitGridCellV2,
  splitGridCellInTwoV2,
  wrapCellChildrenWithGridV2,
} from "@/types/schema-v2-operations";
import type { GridCellV2, GridNodeV2 } from "@/types/schema-v2";
import { buildEditorNodeIndexV2 } from "@/types/schema-v2-index";
import { validateFormSchemaV2 } from "@/types/schema-v2-validation";

describe("Schema V2 operations", () => {
  const sampleGrid = (
    schema: ReturnType<typeof makeYunlvSecondTicketFirstFiveRowsSchema>,
    id: string,
  ) => {
    const grid = schema.pages[0].children.find((node) => node.id === id);
    if (!grid || grid.type !== "grid")
      throw new Error(`sample grid missing: ${id}`);
    return grid;
  };

  it("creates a regular grid from row and column counts", () => {
    const grid = createGridNodeV2({
      rows: 3,
      columns: 4,
      rowHeight: 2,
      cellWidth: 24,
    });

    expect(grid.rows).toHaveLength(3);
    expect(grid.rows[0].cells).toHaveLength(4);
    expect(grid.rows.every((row) => row.height === 2)).toBe(true);
    expect(
      grid.rows.every((row) => row.cells.every((cell) => cell.width === 24)),
    ).toBe(true);
    expect(
      grid.rows.every((row) =>
        row.cells.every((cell) => cell.children.length === 0),
      ),
    ).toBe(true);
  });

  it("creates table templates with one default field P per column", () => {
    const table = createTableNodeV2();

    expect(table.rowTemplate).toHaveLength(table.columns.length);
    expect(table.rowTemplate.map((template) => template.children)).toEqual(
      table.columns.map(() => [
        expect.objectContaining({
          type: "p",
          mode: "field",
          // 字段名由渲染期按「列key_行号」自动派生，行模板内不写死（见 schema-v2-table-rows.ts）
          field: "",
        }),
      ]),
    );
  });

  it("creates safe HTML and image defaults", () => {
    expect(createHtmlNodeV2()).toMatchObject({ type: "html", html: "" });
    expect(createImageNodeV2()).toMatchObject({
      type: "image",
      objectFit: "contain",
    });
  });

  it("sets a column width across every row of a grid", () => {
    const source = createEmptyFormSchemaV2();
    const grid = createGridNodeV2({ rows: 2, columns: 3, cellWidth: 24 });
    const withGrid = insertRootGridV2(source, grid);
    const resized = setGridColumnWidthV2(withGrid, grid.id, 1, "1fr");
    const nextGrid = resized.pages[0].children[0];
    if (nextGrid.type !== "grid") throw new Error("grid missing");
    expect(nextGrid.rows.every((row) => row.cells[1].width === "1fr")).toBe(
      true,
    );
    expect(nextGrid.rows[0].cells[0].width).toBe(24);
    expect(nextGrid.rows[1].cells[2].width).toBe(24);
  });

  it("clones a nested subtree with fresh IDs and unchanged content", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    const source = sampleGrid(schema, "ticket-layout");
    const sourceTable = source.rows.find((r) => r.id === "row-work-task")!
      .cells[1].children[0];
    const clone = cloneNodeWithFreshIdsV2(source);
    expect(clone.type).toBe("grid");
    expect(clone.id).not.toBe(source.id);
    const cloneTable = clone.rows
      .flatMap((r) => r.cells)
      .flatMap((c) => c.children)
      .find((c) => c.type === "table");
    expect(cloneTable).toBeDefined();
    expect(cloneTable).toMatchObject({ type: "table" });
    expect(cloneTable!.id).not.toBe(sourceTable.id);
  });

  it("copies a row next to the source with fresh nested IDs", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    const next = copyGridRowV2(schema, "row-station");
    const grid = sampleGrid(next, "ticket-layout");
    expect(grid.rows).toHaveLength(6);
    expect(grid.rows[0].id).toBe("row-unit-number");
    expect(grid.rows[3].id).toBe("row-station");
    const copyRow = grid.rows[4];
    expect(copyRow.id).not.toBe("row-station");
    expect(copyRow.cells).toHaveLength(1);
    const field = copyRow.cells[0].children.find((c) => c.type === "p");
    expect(field).toBeDefined();
    expect(field!.id).not.toBe("station-field");
  });

  it("moves a component across cells and rejects moves into descendants", () => {
    const source = createEmptyFormSchemaV2();
    const grid = createGridNodeV2({ rows: 1, columns: 2 });
    const withGrid = insertRootGridV2(source, grid);
    const p = createTextNodeV2("移动");
    const withP = appendNodeToCellV2(withGrid, grid.rows[0].cells[0].id, p);
    const nodeId = p.id;
    const moved = moveNodeV2(withP, nodeId, grid.rows[0].cells[1].id);
    const nextGrid = moved.pages[0].children[0];
    if (nextGrid.type !== "grid") throw new Error("grid missing");
    expect(nextGrid.rows[0].cells[0].children).toHaveLength(0);
    expect(nextGrid.rows[0].cells[1].children[0].id).toBe(nodeId);
    expect(moveNodeV2(withP, grid.id, grid.rows[0].cells[0].id)).toEqual(withP);
  });

  it("merges sibling cells and wraps cell contents with a nested Grid", () => {
    const source = createEmptyFormSchemaV2();
    const grid = createGridNodeV2({ rows: 1, columns: 2 });
    const withGrid = insertRootGridV2(source, grid);
    const withP = appendNodeToCellV2(
      withGrid,
      grid.rows[0].cells[0].id,
      createTextNodeV2("左"),
    );
    const withQ = appendNodeToCellV2(
      withP,
      grid.rows[0].cells[1].id,
      createTextNodeV2("右"),
    );
    const merged = mergeGridCellsV2(
      withQ,
      grid.rows[0].cells[0].id,
      grid.rows[0].cells[1].id,
    );
    const mergedGrid = merged.pages[0].children[0];
    if (mergedGrid.type !== "grid") throw new Error("grid missing");
    expect(mergedGrid.rows[0].cells).toHaveLength(1);
    expect(mergedGrid.rows[0].cells[0].colspan).toBe(2);
    const wrapped = wrapCellChildrenWithGridV2(withQ, grid.rows[0].cells[0].id);
    const wrappedGrid = wrapped.pages[0].children[0];
    if (wrappedGrid.type !== "grid") throw new Error("grid missing");
    expect(wrappedGrid.rows[0].cells[0].children[0].type).toBe("grid");
  });

  it("allows replacing a table cell P with another component", () => {
    const source = createEmptyFormSchemaV2();
    const grid = createGridNodeV2({ rows: 1, columns: 1 });
    const table = createTableNodeV2();
    const withTable = appendNodeToCellV2(
      insertRootGridV2(source, grid),
      grid.rows[0].cells[0].id,
      table,
    );
    const templateId = table.rowTemplate[0].id;
    const defaultPId = table.rowTemplate[0].children[0].id;
    const withoutDefault = removeNodeV2(withTable, defaultPId);
    const withReplacement = appendNodeToCellV2(
      withoutDefault,
      templateId,
      createTextNodeV2("特殊内容"),
    );
    const resultGrid = withReplacement.pages[0].children[0];
    if (resultGrid.type !== "grid") throw new Error("grid missing");
    const resultTable = resultGrid.rows[0].cells[0].children[0];
    if (resultTable.type !== "table") throw new Error("table missing");
    expect(resultTable.rowTemplate[0].children).toEqual([
      expect.objectContaining({ type: "text", text: "特殊内容" }),
    ]);
  });

  it("updates a nested row without mutating the source schema", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    const next = updateGridRowHeightV2(schema, "row-work-task", 6);
    expect(
      sampleGrid(next, "ticket-layout").rows.find(
        (r) => r.id === "row-work-task",
      )!.height,
    ).toBe(6);
    expect(
      sampleGrid(schema, "ticket-layout").rows.find(
        (r) => r.id === "row-work-task",
      )!.height,
    ).toBe(5);
  });

  it("resizes a selected grid while preserving existing cells and children", () => {
    const source = createEmptyFormSchemaV2();
    const grid = createGridNodeV2({ rows: 2, columns: 2 });
    const withGrid = insertRootGridV2(source, grid);
    const withP = appendNodeToCellV2(
      withGrid,
      grid.rows[0].cells[1].id,
      createTextNodeV2("keep"),
    );
    const resized = resizeGridV2(withP, grid.id, 3, 3);
    const resizedGrid = resized.pages[0].children[0];

    if (resizedGrid.type !== "grid") throw new Error("grid missing");
    expect(resizedGrid.rows).toHaveLength(3);
    expect(resizedGrid.rows[0].cells).toHaveLength(3);
    expect(resizedGrid.rows[0].cells[1].children[0]).toMatchObject({
      type: "text",
      text: "keep",
    });
    expect(resizedGrid.rows[2].cells).toHaveLength(3);
  });

  it("resizes an individual row independently of the parent Grid", () => {
    const source = createEmptyFormSchemaV2();
    const grid = createGridNodeV2({ rows: 2, columns: 2 });
    const withGrid = insertRootGridV2(source, grid);
    const resized = updateSchemaNodeV2(withGrid, grid.rows[1].id, (node) =>
      node.type === "grid-row" ? resizeGridRowV2(node, 4) : node,
    );
    const nextGrid = resized.pages[0].children[0];
    if (nextGrid.type !== "grid") throw new Error("grid missing");
    expect(nextGrid.rows[0].cells).toHaveLength(2);
    expect(nextGrid.rows[1].cells).toHaveLength(4);
  });

  it("splits a Cell into a one-column nested Grid", () => {
    const source = createEmptyFormSchemaV2();
    const grid = createGridNodeV2({ rows: 1, columns: 2 });
    const withGrid = insertRootGridV2(source, grid);
    const withTable = appendNodeToCellV2(
      withGrid,
      grid.rows[0].cells[1].id,
      createTextNodeV2("table"),
    );
    const split = splitGridCellRowsV2(withTable, grid.rows[0].cells[1].id, 3);
    const parent = split.pages[0].children[0];

    if (parent.type !== "grid") throw new Error("grid missing");
    const nested = parent.rows[0].cells[1].children[0];
    expect(nested.type).toBe("grid");
    if (nested.type !== "grid") throw new Error("nested grid missing");
    expect(nested.rows).toHaveLength(3);
    expect(nested.rows[0].cells[0].children[0]).toMatchObject({
      type: "text",
      text: "table",
    });
  });

  it("configures both rows and columns inside a Cell", () => {
    const source = createEmptyFormSchemaV2();
    const grid = createGridNodeV2({ rows: 1, columns: 2 });
    const withGrid = insertRootGridV2(source, grid);
    const resized = resizeGridCellLayoutV2(
      withGrid,
      grid.rows[0].cells[1].id,
      2,
      3,
    );
    const parent = resized.pages[0].children[0];
    if (parent.type !== "grid") throw new Error("grid missing");
    const nested = parent.rows[0].cells[1].children[0];
    if (nested.type !== "grid") throw new Error("nested grid missing");
    expect(nested.rows).toHaveLength(2);
    expect(nested.rows[0].cells).toHaveLength(3);
  });

  it("updates table minimum rows through the nested tree", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    const next = updateTableMinRowsV2(schema, "work-task-table", 6);
    const grid = sampleGrid(next, "ticket-layout");
    const table = grid.rows.find((r) => r.id === "row-work-task")!.cells[1]
      .children[0];
    if (table.type !== "table") throw new Error("fixture table missing");
    expect(table.minRows).toBe(6);
  });

  it("updates table repeat-header-on-break through the nested tree", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    const next = updateTableRepeatHeaderV2(schema, "work-task-table", false);
    const table = sampleGrid(next, "ticket-layout").rows.find(
      (r) => r.id === "row-work-task",
    )!.cells[1].children[0];
    if (table.type !== "table") throw new Error("fixture table missing");
    // 显式 false 覆盖缺省 true
    expect(table.repeatHeaderOnBreak).toBe(false);
    // 源 schema 不被修改
    const sourceTable = sampleGrid(schema, "ticket-layout").rows.find(
      (r) => r.id === "row-work-task",
    )!.cells[1].children[0];
    if (sourceTable.type !== "table") throw new Error("fixture table missing");
    expect(sourceTable.repeatHeaderOnBreak).toBeUndefined();
  });

  it("updates table show-header through the nested tree", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    const next = updateTableShowHeaderV2(schema, "work-task-table", false);
    const table = sampleGrid(next, "ticket-layout").rows.find(
      (r) => r.id === "row-work-task",
    )!.cells[1].children[0];
    if (table.type !== "table") throw new Error("fixture table missing");
    // 显式 false 覆盖缺省 true
    expect(table.showHeader).toBe(false);
    // 源 schema 不被修改
    const sourceTable = sampleGrid(schema, "ticket-layout").rows.find(
      (r) => r.id === "row-work-task",
    )!.cells[1].children[0];
    if (sourceTable.type !== "table") throw new Error("fixture table missing");
    expect(sourceTable.showHeader).toBeUndefined();
  });

  it("adds a table column with matching template without mutating the source", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    const next = addTableColumnV2(schema, "work-task-table");
    const sourceTable = sampleGrid(schema, "ticket-layout").rows.find(
      (r) => r.id === "row-work-task",
    )!.cells[1].children[0];
    const table = sampleGrid(next, "ticket-layout").rows.find(
      (r) => r.id === "row-work-task",
    )!.cells[1].children[0];
    if (table.type !== "table") throw new Error("table missing");
    expect(sourceTable.type === "table" ? sourceTable.columns.length : 0).toBe(
      2,
    );
    expect(table.columns).toHaveLength(3);
    const added = table.columns[2];
    expect(added.key).toMatch(/^col\d+$/);
    expect(added.title).toBe("新列");
    expect(added.width).toBe("1fr");
    expect(table.rowTemplate).toHaveLength(3);
    expect(table.rowTemplate[2]).toMatchObject({
      type: "table-cell-template",
      columnKey: added.key,
    });
    // 源 schema 不被修改
    expect(sourceTable.type === "table" ? sourceTable.columns.length : 0).toBe(
      2,
    );
  });

  it("removes a table column and its template, keeping at least one column", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    const table = sampleGrid(schema, "ticket-layout").rows.find(
      (r) => r.id === "row-work-task",
    )!.cells[1].children[0];
    if (table.type !== "table") throw new Error("fixture table missing");
    const key = table.columns[0].key;
    const next = removeTableColumnV2(schema, "work-task-table", key);
    const resultTable = sampleGrid(next, "ticket-layout").rows.find(
      (r) => r.id === "row-work-task",
    )!.cells[1].children[0];
    if (resultTable.type !== "table") throw new Error("table missing");
    expect(resultTable.columns).toHaveLength(1);
    expect(resultTable.columns[0].key).not.toBe(key);
    expect(resultTable.rowTemplate.every((t) => t.columnKey !== key)).toBe(
      true,
    );

    // 仅剩 1 列时不再删除
    const blocked = removeTableColumnV2(
      next,
      "work-task-table",
      resultTable.columns[0].key,
    );
    const blockedTable = sampleGrid(blocked, "ticket-layout").rows.find(
      (r) => r.id === "row-work-task",
    )!.cells[1].children[0];
    if (blockedTable.type !== "table") throw new Error("table missing");
    expect(blockedTable.columns).toHaveLength(1);
  });

  it("updates a table column's meta fields", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    const table = sampleGrid(schema, "ticket-layout").rows.find(
      (r) => r.id === "row-work-task",
    )!.cells[1].children[0];
    if (table.type !== "table") throw new Error("fixture table missing");
    const key = table.columns[0].key;
    const next = updateTableColumnV2(schema, "work-task-table", key, {
      title: "序号",
      align: "center",
    });
    const resultTable = sampleGrid(next, "ticket-layout").rows.find(
      (r) => r.id === "row-work-task",
    )!.cells[1].children[0];
    if (resultTable.type !== "table") throw new Error("table missing");
    const col = resultTable.columns[0];
    expect(col.title).toBe("序号");
    expect(col.align).toBe("center");
  });

  it("creates a blank page, adds a grid, splits a row, and inserts a static P", () => {
    const blank = createEmptyFormSchemaV2();
    const grid = createGridNodeV2(createGridRowV2(1));
    const withGrid = insertRootGridV2(blank, grid);
    const rowId = grid.rows[0].id;
    const split = splitGridRowV2(withGrid, rowId, 2);
    const gridAfterSplit = split.pages[0].children[0];
    if (gridAfterSplit.type !== "grid") throw new Error("grid missing");
    const withP = appendNodeToCellV2(
      split,
      gridAfterSplit.rows[0].cells[0].id,
      createTextNodeV2("单位"),
    );
    const finalGrid = withP.pages[0].children[0];
    if (finalGrid.type !== "grid") throw new Error("grid missing");
    expect(finalGrid.rows[0].cells).toHaveLength(2);
    expect(finalGrid.rows[0].cells[0].children[0]).toMatchObject({
      type: "text",
      text: "单位",
    });
  });

  it("moves rows and removes a nested node without mutating the source", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    const moved = moveGridRowV2(schema, "row-station", "up");
    const movedGrid = sampleGrid(moved, "ticket-layout");
    expect(movedGrid.rows[2].id).toBe("row-station");
    const removed = removeNodeV2(schema, "station-field");
    const stationRow = sampleGrid(removed, "ticket-layout").rows.find(
      (r) => r.id === "row-station",
    )!;
    expect(
      stationRow.cells[0].children.find((c) => c.id === "station-field"),
    ).toBeUndefined();
  });

  it("removes grid, row, and cell structure nodes", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();

    const withoutCell = removeNodeV2(schema, "cell-u-f");
    const cellGrid = sampleGrid(withoutCell, "ticket-layout");
    const unitRow = cellGrid.rows.find((r) => r.id === "row-unit-number")!;
    expect(unitRow.cells).toHaveLength(3);

    const withoutRow = removeNodeV2(schema, "row-station");
    const rowGrid = sampleGrid(withoutRow, "ticket-layout");
    expect(rowGrid.rows.some((row) => row.id === "row-station")).toBe(false);

    const withoutGrid = removeNodeV2(schema, "ticket-layout");
    expect(
      withoutGrid.pages[0].children.some((node) => node.id === "ticket-layout"),
    ).toBe(false);
  });

  it("prunes empty rows and grids after deleting the last cell", () => {
    const schema = createEmptyFormSchemaV2();
    const grid = createGridNodeV2(createGridRowV2(1));
    const withGrid = insertRootGridV2(schema, grid);
    const withoutCell = removeNodeV2(withGrid, grid.rows[0].cells[0].id);

    expect(withoutCell.pages[0].children).toHaveLength(0);
    expect(
      validateFormSchemaV2(withoutCell).some(
        (issue) => issue.code === "INVALID_GRID_ROWS",
      ),
    ).toBe(false);
  });
});

describe("P6.2b cell padding/align cascade", () => {
  const makeGrid = (overrides: Partial<GridNodeV2> = {}): GridNodeV2 => ({
    id: "g",
    type: "grid",
    border: "all",
    rows: [],
    ...overrides,
  });
  const makeCell = (overrides: Partial<GridCellV2> = {}): GridCellV2 => ({
    id: "c",
    type: "grid-cell",
    children: [],
    ...overrides,
  });

  it("resolves cell box with cascade: cell > grid default > constant", () => {
    const gridDefaults = makeGrid({
      cellPadding: 4,
      cellAlign: "center",
      cellVerticalAlign: "top",
    });
    expect(resolveCellBoxV2(makeCell(), gridDefaults)).toEqual({
      padding: 4,
      align: "center",
      verticalAlign: "top",
    });
    const cellOverride = makeCell({
      padding: 2,
      align: "right",
      verticalAlign: "bottom",
    });
    expect(resolveCellBoxV2(cellOverride, gridDefaults)).toEqual({
      padding: 2,
      align: "right",
      verticalAlign: "bottom",
    });
    // 无 Grid 默认时回退常量（padding 0 / 居中 / 居中）
    expect(resolveCellBoxV2(makeCell(), makeGrid())).toEqual({
      padding: 0,
      align: "center",
      verticalAlign: "middle",
    });
  });

  it("updates a single cell's padding without mutating the source", () => {
    const source = createEmptyFormSchemaV2();
    const grid = createGridNodeV2({ rows: 1, columns: 1 });
    const withGrid = insertRootGridV2(source, grid);
    const cellId = grid.rows[0].cells[0].id;

    const next = updateCellPaddingV2(withGrid, cellId, 3);
    const nextGrid = next.pages[0].children[0];
    if (nextGrid.type !== "grid") throw new Error("grid missing");
    expect(nextGrid.rows[0].cells[0].padding).toBe(3);
    // 源不被修改
    const srcGrid = withGrid.pages[0].children[0];
    if (srcGrid.type !== "grid") throw new Error("grid missing");
    expect(srcGrid.rows[0].cells[0].padding).toBeUndefined();
    // 负数归零
    const clamped = updateCellPaddingV2(withGrid, cellId, -5);
    const clampedGrid = clamped.pages[0].children[0];
    if (clampedGrid.type !== "grid") throw new Error("grid missing");
    expect(clampedGrid.rows[0].cells[0].padding).toBe(0);
  });

  it("updates a cell's align / verticalAlign and can clear overrides", () => {
    const source = createEmptyFormSchemaV2();
    const grid = createGridNodeV2({ rows: 1, columns: 1 });
    const withGrid = insertRootGridV2(source, grid);
    const cellId = grid.rows[0].cells[0].id;

    const aligned = updateCellAlignV2(withGrid, cellId, "center");
    const aGrid = aligned.pages[0].children[0];
    if (aGrid.type !== "grid") throw new Error("grid missing");
    expect(aGrid.rows[0].cells[0].align).toBe("center");

    const valign = updateCellVerticalAlignV2(aligned, cellId, "top");
    const vGrid = valign.pages[0].children[0];
    if (vGrid.type !== "grid") throw new Error("grid missing");
    expect(vGrid.rows[0].cells[0].verticalAlign).toBe("top");

    const cleared = updateCellAlignV2(valign, cellId, undefined);
    const cGrid = cleared.pages[0].children[0];
    if (cGrid.type !== "grid") throw new Error("grid missing");
    expect(cGrid.rows[0].cells[0].align).toBeUndefined();
  });

  it("sets Grid-level cell defaults without mutating the source", () => {
    const source = createEmptyFormSchemaV2();
    const grid = createGridNodeV2({ rows: 1, columns: 1 });
    const withGrid = insertRootGridV2(source, grid);

    const next = updateGridCellDefaultsV2(withGrid, grid.id, {
      cellPadding: 5,
      cellAlign: "right",
      cellVerticalAlign: "bottom",
    });
    const nextGrid = next.pages[0].children[0];
    if (nextGrid.type !== "grid") throw new Error("grid missing");
    expect(nextGrid.cellPadding).toBe(5);
    expect(nextGrid.cellAlign).toBe("right");
    expect(nextGrid.cellVerticalAlign).toBe("bottom");
    // 级联：无覆盖的 cell 继承 Grid 默认
    expect(resolveCellBoxV2(nextGrid.rows[0].cells[0], nextGrid)).toEqual({
      padding: 5,
      align: "right",
      verticalAlign: "bottom",
    });
    // 源不被修改
    const srcGrid = withGrid.pages[0].children[0];
    if (srcGrid.type !== "grid") throw new Error("grid missing");
    expect(srcGrid.cellPadding).toBeUndefined();
  });

  it("resolves and updates Grid gap (CSS gap, rows + columns)", () => {
    const source = createEmptyFormSchemaV2();
    const grid = createGridNodeV2({ rows: 1, columns: 1 });
    const withGrid = insertRootGridV2(source, grid);

    // 缺省 / 非法解析为 0（旧数据保持单元格紧贴）
    expect(resolveGridGapV2(withGrid.pages[0].children[0] as GridNodeV2)).toBe(
      0,
    );

    const next = updateGridGapV2(withGrid, grid.id, 6);
    const nextGrid = next.pages[0].children[0];
    if (nextGrid.type !== "grid") throw new Error("grid missing");
    expect(nextGrid.gap).toBe(6);
    expect(resolveGridGapV2(nextGrid)).toBe(6);

    // 0 / 负数 / 非数字清除字段
    const cleared = updateGridGapV2(next, grid.id, 0);
    const cGrid = cleared.pages[0].children[0];
    if (cGrid.type !== "grid") throw new Error("grid missing");
    expect(cGrid.gap).toBeUndefined();

    // 源不被修改
    const srcGrid = withGrid.pages[0].children[0];
    if (srcGrid.type !== "grid") throw new Error("grid missing");
    expect(srcGrid.gap).toBeUndefined();
  });
});

describe("P6.2c/P6.2d 共享列轨 + 合并/拆分", () => {
  const buildThreeColGrid = () => {
    const blank = createEmptyFormSchemaV2();
    const grid = createGridNodeV2({ rows: 1, columns: 3, cellWidth: 30 });
    const schema = insertRootGridV2(blank, grid);
    const g = schema.pages[0].children[0];
    if (g.type !== "grid") throw new Error("grid missing");
    return { schema, grid: g };
  };

  it("createGridNodeV2 sets a canonical columns array matching cell count", () => {
    const { grid } = buildThreeColGrid();
    expect(grid.columns).toEqual([30, 30, 30]);
  });

  it("setGridColumnWidthV2 maintains both grid.columns and per-cell widths", () => {
    const { schema, grid } = buildThreeColGrid();
    const next = setGridColumnWidthV2(schema, grid.id, 1, 50);
    const g = next.pages[0].children[0];
    if (g.type !== "grid") throw new Error("grid missing");
    expect(g.columns).toEqual([30, 50, 30]);
    expect(g.rows.every((row) => row.cells[1].width === 50)).toBe(true);
  });

  it("resizeGridV2 同步 columns：长度对齐首行格数并保留既有宽度", () => {
    const { schema, grid } = buildThreeColGrid(); // columns=[30,30,30]
    // 缩到 2 列：保留前 2 个宽度
    const shrunk = resizeGridV2(schema, grid.id, 1, 2);
    const s = shrunk.pages[0].children[0];
    if (s.type !== "grid") throw new Error("grid missing");
    expect(s.columns).toEqual([30, 30]);
    expect(s.rows[0].cells).toHaveLength(2);
    // 扩到 4 列：保留原有 + 新列默认 1fr
    const grown = resizeGridV2(schema, grid.id, 1, 4);
    const g2 = grown.pages[0].children[0];
    if (g2.type !== "grid") throw new Error("grid missing");
    expect(g2.columns).toEqual([30, 30, 30, "1fr"]);
    expect(g2.rows[0].cells).toHaveLength(4);
  });

  it("mergeGridCellsV2 sums colspan and concatenates children", () => {
    const { schema, grid } = buildThreeColGrid();
    const first = grid.rows[0].cells[0].id;
    const second = grid.rows[0].cells[1].id;
    const merged = mergeGridCellsV2(schema, first, second);
    const g = merged.pages[0].children[0];
    if (g.type !== "grid") throw new Error("grid missing");
    expect(g.rows[0].cells).toHaveLength(2);
    expect(g.rows[0].cells[0].colspan).toBe(2);
  });

  it("splitGridCellV2 restores column count and keeps children in the first cell", () => {
    const { schema, grid } = buildThreeColGrid();
    const first = grid.rows[0].cells[0].id;
    const second = grid.rows[0].cells[1].id;
    const merged = mergeGridCellsV2(schema, first, second);
    const mergedGrid = merged.pages[0].children[0];
    if (mergedGrid.type !== "grid") throw new Error("grid missing");
    const child = createTextNodeV2("合并内容");
    const withChild = appendNodeToCellV2(
      merged,
      mergedGrid.rows[0].cells[0].id,
      child,
    );
    const wg = withChild.pages[0].children[0];
    if (wg.type !== "grid") throw new Error("grid missing");
    const split = splitGridCellV2(withChild, wg.rows[0].cells[0].id);
    const g = split.pages[0].children[0];
    if (g.type !== "grid") throw new Error("grid missing");
    expect(g.rows[0].cells).toHaveLength(3);
    expect(g.rows[0].cells[0].colspan).toBeUndefined();
    expect(g.rows[0].cells[0].children).toHaveLength(1);
    expect(g.rows[0].cells[1].children).toHaveLength(0);
  });

  it("merge then split round-trips the cell count", () => {
    const { schema, grid } = buildThreeColGrid();
    const first = grid.rows[0].cells[0].id;
    const second = grid.rows[0].cells[1].id;
    const merged = mergeGridCellsV2(schema, first, second);
    const mg = merged.pages[0].children[0];
    if (mg.type !== "grid") throw new Error("grid missing");
    const split = splitGridCellV2(merged, mg.rows[0].cells[0].id);
    const g = split.pages[0].children[0];
    if (g.type !== "grid") throw new Error("grid missing");
    expect(g.rows[0].cells).toHaveLength(3);
  });

  it("splitGridCellInTwoV2 普通格一分为二：本行多一格、整张网格多一列、其它行同列位补格", () => {
    const { schema, grid } = buildThreeColGrid();
    const target = grid.rows[0].cells[0].id;
    const withChild = appendNodeToCellV2(
      schema,
      target,
      createTextNodeV2("左半"),
    );

    const split = splitGridCellInTwoV2(withChild, target);
    const g = split.pages[0].children[0];
    if (g.type !== "grid") throw new Error("grid missing");

    // 列轨 +1，且留在被拆格之后的位置（这里是最左侧 → 新轨在第 2 条）
    expect(g.columns).toEqual([30, "1fr", 30, 30]);
    // 本行 3 → 4 格，新格紧跟原格
    expect(g.rows[0].cells).toHaveLength(4);
    expect(g.rows[0].cells[0].id).toBe(target);
    expect(g.rows[0].cells[1].children).toHaveLength(0);
    // 原格内容留在左边那格，不被搬走
    expect(g.rows[0].cells[0].children).toHaveLength(1);
    // 所有行轨道总数一致（列对齐不被破坏）
    for (const row of g.rows) {
      const tracks = row.cells.reduce(
        (sum, cell) => sum + (cell.colspan ?? 1),
        0,
      );
      expect(tracks).toBe(4);
    }
  });

  it("splitGridCellInTwoV2 插在中间：新格落在第 2 列位，其它行也在同一列位补格", () => {
    const blank = createEmptyFormSchemaV2();
    const grid = createGridNodeV2({ rows: 2, columns: 3, cellWidth: 30 });
    const schema = insertRootGridV2(blank, grid);
    const g0 = schema.pages[0].children[0];
    if (g0.type !== "grid") throw new Error("grid missing");
    const middle = g0.rows[0].cells[1].id;

    const split = splitGridCellInTwoV2(schema, middle);
    const g = split.pages[0].children[0];
    if (g.type !== "grid") throw new Error("grid missing");

    expect(g.columns).toEqual([30, 30, "1fr", 30]);
    expect(g.rows[0].cells).toHaveLength(4);
    expect(g.rows[0].cells[1].id).toBe(middle);
    expect(g.rows[0].cells[2].children).toHaveLength(0);
    // 第二行同样插在第 2 列位（索引 2），不是追加在末尾
    expect(g.rows[1].cells).toHaveLength(4);
    expect(g.rows[1].cells.map((cell) => cell.children.length)).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it("splitGridCellInTwoV2 其它行的跨列格跨过插入点：撑 colspan，不新增格", () => {
    const blank = createEmptyFormSchemaV2();
    const grid = createGridNodeV2({ rows: 2, columns: 3, cellWidth: 30 });
    const base = insertRootGridV2(blank, grid);
    const g0 = base.pages[0].children[0];
    if (g0.type !== "grid") throw new Error("grid missing");
    // 第二行把第 1、2 列合并 → 该行 2 格：[0]=1轨、[1]=2轨
    const merged = mergeGridCellsV2(
      base,
      g0.rows[1].cells[1].id,
      g0.rows[1].cells[2].id,
    );
    const gm = merged.pages[0].children[0];
    if (gm.type !== "grid") throw new Error("grid missing");
    expect(gm.rows[1].cells).toHaveLength(2);
    expect(gm.rows[1].cells[1].colspan).toBe(2);

    // 拆第一行第 2 格 → 插入点在轨位 2，正落在第二行那个 colspan=2 的格内部
    const split = splitGridCellInTwoV2(merged, gm.rows[0].cells[1].id);
    const g = split.pages[0].children[0];
    if (g.type !== "grid") throw new Error("grid missing");

    expect(g.rows[1].cells).toHaveLength(2); // 未新增格
    expect(g.rows[1].cells[1].colspan).toBe(3); // 撑开一列
    expect(
      g.rows[1].cells.reduce((sum, cell) => sum + (cell.colspan ?? 1), 0),
    ).toBe(4);
    expect(g.rows[0].cells).toHaveLength(4);
  });

  it("splitGridCellInTwoV2 目标不存在时返回原 schema 引用", () => {
    const { schema } = buildThreeColGrid();
    expect(splitGridCellInTwoV2(schema, "not-exist")).toBe(schema);
  });
});

describe("P6.3b 格内排序 / P6.3c 跨格移动目标", () => {
  /** 规范样例「工作负责人（监护人）/班组」合并格内的 4 个子节点顺序。 */
  const ownerCellChildren = (
    schema: ReturnType<typeof makeYunlvSecondTicketFirstFiveRowsSchema>,
  ) => {
    const grid = schema.pages[0].children.find(
      (node) => node.id === "ticket-layout",
    );
    if (grid?.type !== "grid") throw new Error("ticket-layout missing");
    const row = grid.rows.find((r) => r.id === "row-owner-team");
    if (!row) throw new Error("row-owner-team missing");
    return row.cells[0].children.map((child) => child.id);
  };

  it("moveNodeWithinParentV2 上移与下移交换兄弟顺序", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    expect(ownerCellChildren(schema)).toEqual([
      "owner-label",
      "owner-field",
      "team-label",
      "team-field",
    ]);

    const up = moveNodeWithinParentV2(schema, "owner-field", "up");
    expect(ownerCellChildren(up)).toEqual([
      "owner-field",
      "owner-label",
      "team-label",
      "team-field",
    ]);

    const down = moveNodeWithinParentV2(up, "owner-field", "down");
    expect(ownerCellChildren(down)).toEqual([
      "owner-label",
      "owner-field",
      "team-label",
      "team-field",
    ]);

    // 源 schema 不被修改
    expect(ownerCellChildren(schema)).toEqual([
      "owner-label",
      "owner-field",
      "team-label",
      "team-field",
    ]);
  });

  it("moveNodeWithinParentV2 在边界或父容器不支持时原样返回", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    expect(moveNodeWithinParentV2(schema, "owner-label", "up")).toBe(schema);
    expect(moveNodeWithinParentV2(schema, "team-field", "down")).toBe(schema);
    // grid-row 不是可排序的父容器（行顺序请用 moveGridRowV2）
    expect(moveNodeWithinParentV2(schema, "row-unit-number", "up")).toBe(
      schema,
    );
  });

  it("listDropTargetsV2 列出全部单元格与表格列模板", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    const targets = listDropTargetsV2(schema);
    const ids = targets.map((target) => target.id);
    expect(new Set(ids).size).toBe(ids.length); // id 唯一
    expect(ids).toEqual(
      expect.arrayContaining([
        "cell-title",
        "cell-u-l",
        "cell-o-l",
        "cell-m-l",
        "cell-s-l",
        "cell-wt-r1",
        "wt-loc-tpl",
        "wt-con-tpl",
      ]),
    );
    expect(targets.find((t) => t.id === "cell-wt-r1")?.label).toContain(
      "第5行第2格",
    );
    expect(targets.find((t) => t.id === "wt-con-tpl")?.label).toContain(
      "工作内容",
    );
  });

  it("listDropTargetsV2 传入节点时排除其所在格与自身内部容器", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    // 不传节点：包含自身所在格
    expect(listDropTargetsV2(schema).map((t) => t.id)).toContain("cell-o-l");

    // owner-field 当前位于 cell-o-l：该格不应再作为移动目标
    const forField = listDropTargetsV2(schema, "owner-field").map((t) => t.id);
    expect(forField).not.toContain("cell-o-l");
    expect(forField).toContain("cell-s-l");

    // 移动整个外层 Grid 时，其内部所有格与表格列模板都不是合法目标
    const forGrid = listDropTargetsV2(schema, "ticket-layout").map((t) => t.id);
    expect(forGrid).not.toContain("cell-o-l");
    expect(forGrid).not.toContain("cell-wt-r1");
    expect(forGrid).not.toContain("wt-loc-tpl");
    expect(forGrid).toContain("cell-title");
  });

  it("moveNodeV2 目标为自身所在格时原样返回，不产生位移也不重复", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    const childrenOf = (target: typeof schema, parentId: string): string[] => {
      const parent = buildEditorNodeIndexV2(target).get(parentId)?.node as
        | { children?: Array<{ id: string }> }
        | undefined;
      return (parent?.children ?? []).map((child) => child.id);
    };
    const before = childrenOf(schema, "cell-o-l");
    expect(before).toContain("owner-field");

    const sameCell = moveNodeV2(schema, "owner-field", "cell-o-l");
    expect(sameCell).toBe(schema); // 原引用，不产生撤销记录
    expect(childrenOf(sameCell, "cell-o-l")).toEqual(before);

    // 正常跨格移动仍然生效
    const moved = moveNodeV2(schema, "owner-field", "cell-s-l");
    expect(childrenOf(moved, "cell-o-l")).not.toContain("owner-field");
    expect(childrenOf(moved, "cell-s-l")).toContain("owner-field");
  });

  it("moveNodeToIndexV2 同格重排到任意下标", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    expect(ownerCellChildren(schema)).toEqual([
      "owner-label",
      "owner-field",
      "team-label",
      "team-field",
    ]);
    // owner-field(原下标1) 移到末尾（下标4 = 数组长度，追加到末位）
    const reordered = moveNodeToIndexV2(schema, "owner-field", "cell-o-l", 4);
    expect(ownerCellChildren(reordered)).toEqual([
      "owner-label",
      "team-label",
      "team-field",
      "owner-field",
    ]);
    // team-field(原下标3) 移到最前（下标0）
    const toFront = moveNodeToIndexV2(schema, "team-field", "cell-o-l", 0);
    expect(ownerCellChildren(toFront)).toEqual([
      "team-field",
      "owner-label",
      "owner-field",
      "team-label",
    ]);
    // 源 schema 不被修改
    expect(ownerCellChildren(schema)).toEqual([
      "owner-label",
      "owner-field",
      "team-label",
      "team-field",
    ]);
  });

  it("moveNodeToIndexV2 跨格移动到任意下标", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    const moved = moveNodeToIndexV2(schema, "owner-field", "cell-s-l", 0);
    expect(ownerCellChildren(moved)).not.toContain("owner-field");
    const sCell = buildEditorNodeIndexV2(moved).get("cell-s-l")?.node as
      | { children: Array<{ id: string }> }
      | undefined;
    expect(sCell?.children[0].id).toBe("owner-field");
  });

  it("moveNodeToIndexV2 同格原位 no-op 返回原引用", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    expect(moveNodeToIndexV2(schema, "owner-field", "cell-o-l", 1)).toBe(
      schema,
    );
  });

  it("moveNodeToIndexV2 拒绝移入自身后代", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    // 把整个外层 Grid 移进它自己的某个格 → 拒绝，返回原引用
    expect(moveNodeToIndexV2(schema, "ticket-layout", "cell-o-l", 0)).toBe(
      schema,
    );
  });

  it("moveNodeToIndexV2 越界 atIndex 自动 clamp", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    expect(
      ownerCellChildren(
        moveNodeToIndexV2(schema, "owner-field", "cell-o-l", 999),
      ),
    ).toEqual(["owner-label", "team-label", "team-field", "owner-field"]);
    expect(
      ownerCellChildren(
        moveNodeToIndexV2(schema, "owner-field", "cell-o-l", -5),
      ),
    ).toEqual(["owner-field", "owner-label", "team-label", "team-field"]);
  });
});
