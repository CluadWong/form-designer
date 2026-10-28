import { describe, expect, it } from "vitest";
import { paginateSchema, tableHeightMm, type PhysicalPage } from "@/engine-v2/pagination";
import {
  appendNodeToCellV2,
  createEmptyFormSchemaV2,
  createGridNodeV2,
  createTableNodeV2,
  insertRootGridV2,
} from "@/types";
import type { FormSchemaV2, GridNodeV2 } from "@/types";

/**
 * 表格跨页切分：实测行高不得把「整张表」重复计入预算（2026-10-22 用户实报）。
 *
 * 现象：模板 `formdesigner-schema-v2-1792636691289.json`（A4 / 边距 12mm / baseRowHeight 8mm /
 * 表格 minRows 27）在预览页被拆成 **6 页**（5+5+5+5+5+2），实际 27 行 × 8mm = 216mm，
 * 加上表头与逐行 1px 边框约 232mm，正文可用高 273mm —— 本该只占 1 页。
 *
 * 根因：`splitGrid` 的表格切分路径把「整行实测高度」当作 gridOverhead 从页预算里扣掉，
 * 而该实测值**已经包含整张表**；表格随后又被 `_paginateMaxRows` 裁到本页剩余空间，
 * 于是表高被重复扣一次：预算只剩 273 − 232 = 41mm ≈ 5 行 → 27 行拆成 6 页。
 *
 * 修法：预算只扣「非表格占用」= max(确定性行高, 实测行高 − 表高)。
 *
 * 对拍（修复前 / 修复后，同一 measureRow 口径）：
 *   27 行 measured 231.9 → 6 页 / 1 页；50 行 measured 415.9 → 7 页 / 2 页。
 *   确定性层（不传 measureRow）两版一致，均为 1 页 / 2 页 —— 证明改动只收敛实测层。
 */

/** A4 + 上下边距各 12mm → 正文可用高（名义值，按 mm 精确计算）。 */
const BODY_H_MM = 297 - 12 - 12;
/** 同一张纸在浏览器里的实测正文高（297mm = 1122.52px → 取整 1122px = 272.6mm）。 */
const REAL_BODY_H_MM = 272.6;
const ONE_PX_MM = 25.4 / 96;

/**
 * 一个「表头 1 行 + N 数据行」的带边框表格片段，按引擎口径估算的总高（mm）。
 * 逐行 1px 分隔线 + 外框 2px 都要计（见 `tableHeightMm`）。
 */
function fragmentHeightMm(dataRows: number): number {
  return (1 + dataRows) * 8 + 2 * ONE_PX_MM + dataRows * ONE_PX_MM;
}

/** A4 + 边距 12mm + baseRowHeight 8mm，root 1×1 网格，首格放一张 minRows 行的表格。 */
function schemaWithTableRows(rows: number): FormSchemaV2 {
  const grid = createGridNodeV2();
  const cellId = grid.rows[0].cells[0].id;
  const table = { ...createTableNodeV2(), minRows: rows };
  return appendNodeToCellV2(
    insertRootGridV2(createEmptyFormSchemaV2(), grid),
    cellId,
    table,
  );
}

function rootGrid(schema: FormSchemaV2): GridNodeV2 {
  const node = schema.pages[0].children[0];
  if (node.type !== "grid") throw new Error("root 不是 grid");
  return node;
}

/** 浏览器里该行的实测高度 ≈ 确定性表高 + 逐行 1px 边框（约 7.4mm）。 */
function measuredRowHeightMm(rows: number, baseRowHeight = 8): number {
  const onePxMm = 25.4 / 96;
  return (1 + rows) * baseRowHeight + 2 * onePxMm + 7.4;
}

function paginateMeasured(schema: FormSchemaV2, rows: number): PhysicalPage[] {
  const rowId = rootGrid(schema).rows[0].id;
  const measured = measuredRowHeightMm(rows);
  return paginateSchema(schema, {
    measureRow: (row) => (row.id === rowId ? measured : undefined),
  }).pages;
}

/** 每页上该表格片段被限制的数据行数（未限制记为 "all"）。 */
function tableChunks(pages: PhysicalPage[]): string[] {
  return pages.map((page) => {
    const grid = page.children[0]?.node;
    if (!grid || grid.type !== "grid") return "?";
    const table = grid.rows[0]?.cells[0]?.children.find((c) => c.type === "table");
    if (!table) return "?";
    return typeof table._paginateMaxRows === "number" ? String(table._paginateMaxRows) : "all";
  });
}

describe("表格跨页切分：实测行高不重复计入整表高度", () => {
  it("27 行表格在实测行高约 232mm 时只占 1 页（原为 6 页）", () => {
    const schema = schemaWithTableRows(27);
    const pages = paginateMeasured(schema, 27);
    expect(tableChunks(pages)).toEqual(["all"]);
    expect(pages.length).toBe(1);
  });

  it("实测层与确定性层对 27 / 50 行的页数一致", () => {
    for (const rows of [27, 50]) {
      const schema = schemaWithTableRows(rows);
      expect({ rows, pages: paginateMeasured(schema, rows).length }).toEqual({
        rows,
        pages: paginateSchema(schema).pages.length,
      });
    }
  });

  it("真正超出一页的表格仍按数据行切分，且行数不丢", () => {
    const schema = schemaWithTableRows(50);
    const pages = paginateMeasured(schema, 50);
    expect(pages.length).toBe(2);
    const chunks = tableChunks(pages).map(Number);
    expect(chunks).toEqual([31, 19]);
    expect(chunks.reduce((a, b) => a + b, 0)).toBe(50);
  });

  it("33 行：切到 2 页（31 + 2），首片段不再溢出正文区", () => {
    const schema = schemaWithTableRows(33);
    const pages = paginateMeasured(schema, 33);
    expect(tableChunks(pages)).toEqual(["31", "2"]);
    // 首片段真实高度必须 ≤ 正文可用高，否则会压到页脚边距（用户实报的现象）
    const firstChunkH = fragmentHeightMm(31);
    expect(firstChunkH).toBeLessThanOrEqual(BODY_H_MM);
  });

  it("32 行：名义 272.996mm 几乎贴满 273mm，真机正文只有 272.6mm → 切到 2 页", () => {
    const schema = schemaWithTableRows(32);
    expect(tableChunks(paginateMeasured(schema, 32))).toEqual(["31", "1"]);
    // 32 行按名义纸面「刚好放得下」，但 A4 297mm→1122px 取整后正文实测 272.6mm，
    // 引擎留 0.5mm 余量把它判为放不下 —— 否则表格最后一条边框会压进下边距。
    expect(fragmentHeightMm(32)).toBeLessThanOrEqual(BODY_H_MM);
    expect(fragmentHeightMm(32)).toBeGreaterThan(REAL_BODY_H_MM);
  });
});

describe("tableHeightMm：逐行分隔线计入表格高度", () => {
  it("border=all 时每数据行多 1px（表头 + N 行共 N 条下边框）", () => {
    const table = { ...createTableNodeV2(), minRows: 33 };
    const onePxMm = 25.4 / 96;
    expect(tableHeightMm(table, 8, null)).toBeCloseTo(
      (1 + 33) * 8 + 2 * onePxMm + 33 * onePxMm,
      6,
    );
  });

  it("border=none 时既无外框也无逐行线", () => {
    const table = { ...createTableNodeV2(), minRows: 33, border: "none" as const };
    expect(tableHeightMm(table, 8, null)).toBeCloseTo(34 * 8, 6);
  });
});

/**
 * 表格**续片段**不得按「整表」的实测行高记账（2026-10-23 用户实报「大片空白」）。
 *
 * 现象：模板 `formdesigner-schema-v2-1792751592586.json`（A4 / 边距 10mm / baseRowHeight 8mm）
 * 真机出 4 页，第 2 页空 90.8mm、第 3 页空 39.3mm；而正文总高约 783mm，按 276.5mm/页
 * 本应只有 3 页。
 *
 * 根因：`push()` 用 `atomicNodeHeightMm` 累加 `curUsed`，而 Grid 片段的行高走的是
 * `measureRow` —— 该回调按 `row.id` 返回**整行**渲染高度，里面含**整张表**。表格被
 * `_paginateMaxRows` 裁到续页只剩 1~2 行后，实测值仍是整表高：
 *   12 行表切到第 2 页的续片段实际渲染 16.7mm，却被记成 107.7mm（多算 91mm）；
 *   紧接着的 5 行表因此只剩 28mm 预算、只分到 2 行，其余被推到第 3 页。
 *
 * 修法：`fragmentRowHeightMm` —— 行内有被裁切的表时，占用改按
 * `max(确定性行高, 表以外高度 + 裁切后表高)`，其中「表以外」= max(0, 实测整行 − 整表高)。
 * 无实测值时仍走确定性估算，故纯确定性层（测试 / SSR）结果逐字节不变。
 */
describe("表格续片段：页面占用按实际渲染行数计，不重复算整表", () => {
  /** 表格（`rows` 行）后面再接 `siblings` 个 1 行小网格，模拟「表格之后还有一堆小节」。 */
  function schemaWithTableAndSiblings(rows: number, siblings: number): FormSchemaV2 {
    let schema = schemaWithTableRows(rows);
    for (let i = 0; i < siblings; i += 1) {
      schema = insertRootGridV2(schema, createGridNodeV2());
    }
    return schema;
  }

  function paginateWithTableRowMeasured(
    schema: FormSchemaV2,
    rows: number,
  ): PhysicalPage[] {
    const rowId = rootGrid(schema).rows[0].id;
    const measured = measuredRowHeightMm(rows);
    return paginateSchema(schema, {
      measureRow: (row) => (row.id === rowId ? measured : undefined),
    }).pages;
  }

  it("40 行表格切页后，第 2 页的续片段不再占掉整表高度（后续小节留在第 2 页）", () => {
    const schema = schemaWithTableAndSiblings(40, 12);
    const pages = paginateWithTableRowMeasured(schema, 40);
    const chunks = tableChunks(pages).map(Number);
    expect(chunks).toEqual([31, 9]);
    expect(chunks.reduce((a, b) => a + b, 0)).toBe(40);
    // 修复前：第 2 页把续片段记成整表高（约 336mm）→ 12 个小节被整体甩到第 3 页。
    expect(pages.length).toBe(2);
    expect(pages[1].children.length).toBe(1 + 12);
  });

  it("确定性层（无 measureRow）页数不受影响", () => {
    const schema = schemaWithTableAndSiblings(40, 12);
    expect(paginateSchema(schema).pages.length).toBe(2);
  });
});
