import { describe, expect, it } from "vitest";
import {
  gridFragmentHeightMm,
  paginatePage,
  paginateSchema,
  tableHeightMm,
  type PhysicalPage,
} from "@/engine-v2/pagination";
import { makeFiftyRowGridSchema } from "@/dev/gridPaginationDemo";
import type {
  FormNodeV2,
  FormSchemaV2,
  GridNodeV2,
  GridRowV2,
  PageSchemaV2,
  TableNodeV2,
} from "@/types";
import { resolvePaperSizeV2 } from "@/types";

/** 统计物理页列表中所有 Grid 片段的行数总和。 */
function totalGridRows(pages: PhysicalPage[]): number {
  let n = 0;
  for (const p of pages) {
    for (const c of p.children) {
      if (c.node.type === "grid") n += c.node.rows.length;
    }
  }
  return n;
}

/** 统计物理页数量（仅含至少一个子项）。 */
function nonEmptyPages(pages: PhysicalPage[]): PhysicalPage[] {
  return pages.filter((p) => p.children.length > 0);
}

describe("分页引擎 pagination", () => {
  it("50 行 Grid + 标题 → 切成 2 个物理页，且行数不丢", () => {
    const schema = makeFiftyRowGridSchema();
    const result = paginateSchema(schema);
    const pages = nonEmptyPages(result.pages);

    expect(pages).toHaveLength(2);
    // 网格被完整保留：50 行一分不丢
    expect(totalGridRows(pages)).toBe(50);
    // 无溢出告警（每段都放得下）
    expect(result.warnings).toHaveLength(0);
  });

  it("每个物理页内容高度均不超过正文可用高", () => {
    const schema = makeFiftyRowGridSchema();
    const paper = resolvePaperSizeV2(schema.paper);
    const bodyH = paper.heightMm - 10 - 10; // margin 10
    const result = paginateSchema(schema);

    for (const p of result.pages) {
      let used = 0;
      for (const c of p.children) {
        if (c.node.type === "grid") {
          const sb = c.suppressBorders;
          used += gridFragmentHeightMm(
            schema.baseRowHeight,
            c.node,
            c.node.rows,
            !!sb?.top,
            !!sb?.bottom,
          );
        }
      }
      expect(used).toBeLessThanOrEqual(bodyH + 0.5);
    }
  });

  it("跨页 Grid 片段用 suppressBorders 形成连续外观（首段有顶框、末段有底框、中间去顶底框）", () => {
    const schema = makeFiftyRowGridSchema();
    const result = paginateSchema(schema);
    const gridFragments = result.pages
      .flatMap((p) => p.children)
      .filter((c) => c.node.type === "grid");

    expect(gridFragments.length).toBeGreaterThan(1);
    // 首片段保留顶框（未被抑制）
    expect(gridFragments[0].suppressBorders?.top).not.toBe(true);
    // 末片段保留底框（未被抑制）
    const last = gridFragments[gridFragments.length - 1];
    expect(last.suppressBorders?.bottom).not.toBe(true);
    // 中间片段抑制顶/底框（连续外观）
    for (let i = 1; i < gridFragments.length - 1; i++) {
      expect(gridFragments[i].suppressBorders?.top).toBe(true);
      expect(gridFragments[i].suppressBorders?.bottom).toBe(true);
    }
  });

  it("短内容 → 单页，且不切分 Grid", () => {
    const page: PageSchemaV2 = {
      id: "p1",
      type: "page",
      mode: "fixed",
      margin: { top: 10, right: 10, bottom: 10, left: 10 },
      children: [
        {
          id: "g",
          type: "grid",
          border: "all",
          rows: [
            {
              id: "r1",
              type: "grid-row",
              height: 1,
              cells: [{ id: "c1", type: "grid-cell", children: [] }],
            },
          ],
        },
      ],
    };
    const schema: FormSchemaV2 = {
      version: 2,
      paper: { size: "A4" },
      baseRowHeight: 8,
      pages: [page],
    };
    const result = paginatePage(page, {
      baseRowHeight: 8,
      bodyHeightMm: 277,
      contentWidthMm: 190,
    });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].children[0].node).toMatchObject({ id: "g" });
    // 整 Grid 未切分（rows 仍是 1 行）
    expect((result.pages[0].children[0].node as GridNodeV2).rows).toHaveLength(
      1,
    );
  });

  it("单个节点比整页还高 → 强制放入并产出告警", () => {
    const page: PageSchemaV2 = {
      id: "p1",
      type: "page",
      mode: "fixed",
      margin: { top: 10, right: 10, bottom: 10, left: 10 },
      children: [
        {
          id: "tall",
          type: "grid",
          border: "all",
          rows: [
            {
              id: "r1",
              type: "grid-row",
              height: 1,
              cells: [{ id: "c1", type: "grid-cell", children: [] }],
            },
          ],
        },
      ],
    };
    // baseRowHeight=300 → 单行就 300mm > 正文 277mm
    const result = paginatePage(page, {
      baseRowHeight: 300,
      bodyHeightMm: 277,
      contentWidthMm: 190,
    });
    expect(result.pages).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it("多个逻辑页 → 拼接为连续编号的物理页", () => {
    const makePage = (id: string): PageSchemaV2 => ({
      id,
      type: "page",
      mode: "fixed",
      margin: { top: 10, right: 10, bottom: 10, left: 10 },
      children: [
        {
          id: `${id}-t`,
          type: "text",
          text: "一页内容",
        },
      ],
    });
    const schema: FormSchemaV2 = {
      version: 2,
      paper: { size: "A4" },
      baseRowHeight: 8,
      pages: [makePage("lp1"), makePage("lp2")],
    };
    const result = paginateSchema(schema);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].index).toBe(1);
    expect(result.pages[1].index).toBe(2);
    expect(result.pages[1].sourcePageId).toBe("lp2");
  });

  it("measureRow 注入真实行高后，分页按真实高度切分（估算偏低 → 多换页、不溢出）", () => {
    const schema = makeFiftyRowGridSchema();
    // 模拟「多行字段 / 换行文本」使真实行高（20mm）远高于确定性估算（8mm）
    const result = paginateSchema(schema, { measureRow: () => 20 });
    const pages = nonEmptyPages(result.pages);

    // 真实行高下每页装得下更少行 → 物理页数多于确定性分页的 2 页
    expect(pages.length).toBeGreaterThan(2);
    // 50 行一分不丢
    expect(totalGridRows(pages)).toBe(50);
    // 用真实行高复核：每页内容高度不再超过正文可用高（不溢出纸外）
    const paper = resolvePaperSizeV2(schema.paper);
    const bodyH = paper.heightMm - 10 - 10;
    for (const p of pages) {
      let used = 0;
      for (const c of p.children) {
        if (c.node.type === "grid") {
          const sb = c.suppressBorders;
          used += gridFragmentHeightMm(
            schema.baseRowHeight,
            c.node,
            c.node.rows,
            !!sb?.top,
            !!sb?.bottom,
            () => 20,
          );
        }
      }
      expect(used).toBeLessThanOrEqual(bodyH + 0.5);
    }
  });

  it("Table（50 行数据）按数据行跨页切分，总行数不丢", () => {
    // 构造复现用户报的结构：Grid(1行) → Cell → Table(minRows:50)
    const schema: FormSchemaV2 = {
      version: 2,
      paper: { size: "A4" },
      baseRowHeight: 8,
      pages: [
        {
          id: "page-1",
          type: "page",
          mode: "fixed",
          margin: { top: 10, right: 10, bottom: 10, left: 10 },
          children: [
            {
              id: "grid-1",
              type: "grid",
              border: "all",
              rows: [
                {
                  id: "row-1",
                  type: "grid-row",
                  height: 1,
                  cells: [
                    {
                      id: "cell-1",
                      type: "grid-cell",
                      width: "1fr",
                      children: [
                        {
                          id: "table-1",
                          type: "table",
                          columns: [
                            { key: "c1", title: "列1", width: "1fr" },
                            { key: "c2", title: "列2", width: "1fr" },
                          ],
                          minRows: 50,
                          rowTemplate: [
                            {
                              id: "tpl-c1",
                              type: "table-cell-template",
                              columnKey: "c1",
                              children: [
                                {
                                  id: "p1",
                                  type: "p",
                                  mode: "field",
                                  field: "",
                                },
                              ],
                            },
                            {
                              id: "tpl-c2",
                              type: "table-cell-template",
                              columnKey: "c2",
                              children: [
                                {
                                  id: "p2",
                                  type: "p",
                                  mode: "field",
                                  field: "",
                                },
                              ],
                            },
                          ],
                          border: "all",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = paginateSchema(schema);
    const pages = nonEmptyPages(result.pages);

    // 50 行数据 + 表头 = 51 × 8mm = 408mm > A4 正文区 277mm → 必须切分
    expect(pages.length).toBeGreaterThan(1);

    // 递归统计所有片段的 _paginateMaxRows 之和（Table 可能嵌套在 Grid 片段内部）
    let totalDataRows = 0;
    let tableFragmentCount = 0;
    function countTables(node: FormNodeV2): void {
      if (node.type === "table") {
        tableFragmentCount++;
        const maxRows = (node as { _paginateMaxRows?: number })
          ._paginateMaxRows;
        if (typeof maxRows === "number" && maxRows > 0) {
          totalDataRows += maxRows;
        }
      } else if (node.type === "grid") {
        for (const row of node.rows) {
          for (const cell of row.cells) {
            for (const child of cell.children) {
              countTables(child);
            }
          }
        }
      }
    }
    for (const p of pages) {
      for (const c of p.children) {
        countTables(c.node);
      }
    }

    // 至少有 2 个 Table 片段
    expect(tableFragmentCount).toBeGreaterThanOrEqual(2);
    // 所有片段的数据行之和 = 50（一行不丢）
    expect(totalDataRows).toBe(50);

    // 每页内容高度不超过正文可用高
    const paper = resolvePaperSizeV2(schema.paper);
    const bodyH = paper.heightMm - 10 - 10; // 277
    for (const p of pages) {
      let used = 0;
      for (const c of p.children) {
        if (c.node.type === "table") {
          used += tableHeightMm(c.node, schema.baseRowHeight, null);
        } else if (c.node.type === "grid") {
          used += gridFragmentHeightMm(
            schema.baseRowHeight,
            c.node,
            c.node.rows,
            !!c.suppressBorders?.top,
            !!c.suppressBorders?.bottom,
          );
        }
      }
      expect(used).toBeLessThanOrEqual(bodyH + 1.0); // 容许 1mm 浮点误差
    }
  });

  it("前文 Grid + 超大 Table：首片段留在前文所在页，余行流转下一页（不整表换页）", () => {
    // 复现用户实报模板（formdesigner-schema-v2-1792639106952.json）：
    // 第 1 个 Grid 放「前文」，第 2 个 Grid(1行) 内放 Table(minRows 31, border all)。
    // 期望：表格超过当页的部分分页到下一页，而不是整个表格都移到下一页。
    // 31 行表格 ≈ 264.7mm，前文 ≈ 8.5mm，A4 正文 273mm → 首片段应装下 30 行，余 1 行到下一页。
    const schema: FormSchemaV2 = {
      version: 2,
      paper: { size: "A4" },
      baseRowHeight: 8,
      pages: [
        {
          id: "page-1",
          type: "page",
          mode: "fixed",
          margin: { top: 12, right: 12, bottom: 12, left: 12 },
          children: [
            {
              id: "grid-preface",
              type: "grid",
              border: "all",
              rows: [
                {
                  id: "row-preface",
                  type: "grid-row",
                  height: 1,
                  cells: [
                    {
                      id: "cell-preface",
                      type: "grid-cell",
                      width: "1fr",
                      children: [
                        { id: "text-preface", type: "text", text: "前文" },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              id: "grid-table",
              type: "grid",
              border: "all",
              rows: [
                {
                  id: "row-table",
                  type: "grid-row",
                  height: 1,
                  cells: [
                    {
                      id: "cell-table",
                      type: "grid-cell",
                      width: "1fr",
                      children: [
                        {
                          id: "table-1",
                          type: "table",
                          columns: [
                            { key: "c1", title: "列1", width: "1fr" },
                            { key: "c2", title: "列2", width: "1fr" },
                          ],
                          minRows: 31,
                          rowTemplate: [
                            {
                              id: "tpl-c1",
                              type: "table-cell-template",
                              columnKey: "c1",
                              children: [
                                {
                                  id: "p1",
                                  type: "p",
                                  mode: "field",
                                  field: "",
                                },
                              ],
                            },
                            {
                              id: "tpl-c2",
                              type: "table-cell-template",
                              columnKey: "c2",
                              children: [
                                {
                                  id: "p2",
                                  type: "p",
                                  mode: "field",
                                  field: "",
                                },
                              ],
                            },
                          ],
                          border: "all",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = paginateSchema(schema);
    const pages = nonEmptyPages(result.pages);

    expect(pages).toHaveLength(2);
    // 第 1 页：前文 Grid + 表格首片段（_paginateMaxRows = 30），前文未被单独封存
    const page1 = pages[0];
    expect(page1.children).toHaveLength(2);
    expect(page1.children[0].node.type).toBe("grid");
    // `expect(...).toBe` 不做类型收窄，故显式断言为 Grid 片段后再取 rows。
    const tableFrag1 = page1.children[1].node as GridNodeV2;
    expect(tableFrag1.type).toBe("grid");
    const table1 = tableFrag1.rows[0].cells[0].children[0];
    expect(table1.type).toBe("table");
    expect((table1 as { _paginateMaxRows?: number })._paginateMaxRows).toBe(30);

    // 第 2 页：表格余行（1 行）
    const tableFrag2 = pages[1].children[0].node as GridNodeV2;
    expect(tableFrag2.type).toBe("grid");
    const table2 = tableFrag2.rows[0].cells[0].children[0];
    expect(table2.type).toBe("table");
    expect((table2 as { _paginateMaxRows?: number })._paginateMaxRows).toBe(1);
    // splitGrid 路径同样写起始行号：续页从第 31 行（0-based 30）继续，而非重绘首行
    expect((table2 as { _paginateStartRow?: number })._paginateStartRow).toBe(
      30,
    );

    // 总行数不丢
    let total = 0;
    for (const p of pages) {
      for (const c of p.children) {
        if (c.node.type === "grid") {
          for (const row of c.node.rows) {
            for (const cell of row.cells) {
              for (const child of cell.children) {
                if (child.type === "table") {
                  const max = (child as { _paginateMaxRows?: number })
                    ._paginateMaxRows;
                  total += typeof max === "number" && max > 0 ? max : 0;
                }
              }
            }
          }
        }
      }
    }
    expect(total).toBe(31);
  });

  it("末行 Table 整格放不下当前页 → 按数据行填满本页，余行流转下一页（9 行填满 / 10 行整表跳页回归）", () => {
    // 复现用户实报模板（formdesigner-schema-v2-1792640370000.json）：
    // 「6、安全措施」Grid（border none）有 2 行：第 1 行文本、第 2 行内 Table（border all）。
    // 用户观察：minRows=9 时表格刚好填满第一页；改成 10 行后整表被甩到第二页。
    // 期望：10 行时首片段（表头 + 9 行）留在第一页填满剩余空间，仅余 1 行流转第二页。
    const ONE_PX_MM = 25.4 / 96;

    // 前文 Grid：23 行 × 8mm + 外框 2px ≈ 184.5mm，令第一页剩余空间 ≈ 92.5mm ——
    // 9 行表格（≈82.9mm）+ 文本行(8mm) = 90.9mm 恰好放得下；10 行表格（≈91.2mm）则放不下。
    const prefaceRows: GridRowV2[] = Array.from({ length: 23 }, (_, k) => ({
      id: `row-preface-${k}`,
      type: "grid-row",
      height: 1,
      cells: [
        {
          id: `cell-preface-${k}`,
          type: "grid-cell",
          width: "1fr",
          children: [],
        },
      ],
    }));

    const makeSchema = (minRows: number): FormSchemaV2 => ({
      version: 2,
      paper: { size: "A4" },
      baseRowHeight: 8,
      pages: [
        {
          id: "page-1",
          type: "page",
          mode: "fixed",
          margin: { top: 10, right: 10, bottom: 10, left: 10 },
          children: [
            {
              id: "grid-preface",
              type: "grid",
              border: "all",
              rows: prefaceRows,
              columns: ["1fr"],
            },
            {
              id: "grid-safety",
              type: "grid",
              border: "none",
              rows: [
                {
                  id: "row-safety-label",
                  type: "grid-row",
                  height: 1,
                  cells: [
                    {
                      id: "cell-safety-label",
                      type: "grid-cell",
                      width: "1fr",
                      children: [
                        {
                          id: "text-safety",
                          type: "text",
                          text: "6、安全措施",
                        },
                      ],
                    },
                  ],
                },
                {
                  id: "row-safety-table",
                  type: "grid-row",
                  height: 1,
                  cells: [
                    {
                      id: "cell-safety-table",
                      type: "grid-cell",
                      width: "1fr",
                      children: [
                        {
                          id: "table-kgdz",
                          type: "table",
                          columns: [
                            {
                              key: "kgdz",
                              title: "应拉断路器(开关)、隔离开关(刀闸)",
                              width: "1fr",
                            },
                            { key: "exec", title: "已执行", width: 20 },
                          ],
                          minRows,
                          rowTemplate: [
                            {
                              id: "tpl-kgdz",
                              type: "table-cell-template",
                              columnKey: "kgdz",
                              children: [
                                {
                                  id: "p-kgdz",
                                  type: "p",
                                  mode: "field",
                                  field: "",
                                },
                              ],
                            },
                            {
                              id: "tpl-exec",
                              type: "table-cell-template",
                              columnKey: "exec",
                              children: [
                                {
                                  id: "p-exec",
                                  type: "p",
                                  mode: "field",
                                  field: "",
                                },
                              ],
                            },
                          ],
                          border: "all",
                        },
                      ],
                    },
                  ],
                },
              ],
              columns: ["1fr"],
            },
          ],
        },
      ],
    });

    // 浏览器实测：表格行的真实渲染高度 ≈ 表头 + minRows 数据行 + 外框 + 逐行分隔线。
    const makeMeasureRow =
      (minRows: number) =>
      (row: { id: string }): number =>
        row.id === "row-safety-table"
          ? (1 + minRows) * 8 + 2 * ONE_PX_MM + minRows * ONE_PX_MM
          : 8;

    /** 递归收集所有 Table 片段的 _paginateMaxRows（未限制记 MAX_SAFE_INTEGER）。 */
    const collectChunks = (node: FormNodeV2): number[] => {
      const out: number[] = [];
      if (node.type === "table") {
        const max = (node as { _paginateMaxRows?: number })._paginateMaxRows;
        out.push(
          typeof max === "number" && max > 0 ? max : Number.MAX_SAFE_INTEGER,
        );
      } else if (node.type === "grid") {
        for (const row of node.rows) {
          for (const cell of row.cells) {
            for (const child of cell.children)
              out.push(...collectChunks(child));
          }
        }
      }
      return out;
    };
    const chunksOf = (minRows: number): number[] => {
      const r = paginateSchema(makeSchema(minRows), {
        measureRow: makeMeasureRow(minRows),
      });
      return r.pages.flatMap((p) =>
        p.children.flatMap((c) => collectChunks(c.node)),
      );
    };

    // 9 行：整格（文本行 + 整表）放在第一页，表格未切分，仍 1 页
    const pages9 = nonEmptyPages(
      paginateSchema(makeSchema(9), { measureRow: makeMeasureRow(9) }).pages,
    );
    expect(pages9).toHaveLength(1);
    expect(chunksOf(9)).toEqual([Number.MAX_SAFE_INTEGER]);

    // 10 行：整格放不下 → 表格按数据行切分 9 + 1，首片段留在第一页，总行数不丢
    const pages10 = nonEmptyPages(
      paginateSchema(makeSchema(10), { measureRow: makeMeasureRow(10) }).pages,
    );
    expect(pages10).toHaveLength(2);
    expect(chunksOf(10)).toEqual([9, 1]);
    expect(chunksOf(10).reduce((a, b) => a + b, 0)).toBe(10);
    // 首片段留在第一页（前文 Grid + 文本行 + 表格首片段 = 3 个子项），而非整格甩到第二页
    expect(pages10[0].children).toHaveLength(3);
  });

  // ── 跨页重复表头（repeatHeaderOnBreak，2026-10-22）──

  /** 独立 Table（页面直接子节点，走 `paginateTable` 路径）的表格节点。 */
  function makeStandaloneTableNode(
    minRows: number,
    repeatHeaderOnBreak?: boolean,
    showHeader?: boolean,
  ): FormNodeV2 {
    return {
      id: "table-standalone",
      type: "table",
      columns: [
        { key: "c1", title: "列1", width: "1fr" },
        { key: "c2", title: "列2", width: "1fr" },
      ],
      minRows,
      rowTemplate: [
        {
          id: "tpl-c1",
          type: "table-cell-template",
          columnKey: "c1",
          children: [{ id: "p1", type: "p", mode: "field", field: "" }],
        },
        {
          id: "tpl-c2",
          type: "table-cell-template",
          columnKey: "c2",
          children: [{ id: "p2", type: "p", mode: "field", field: "" }],
        },
      ],
      border: "all",
      ...(repeatHeaderOnBreak === undefined ? {} : { repeatHeaderOnBreak }),
      ...(showHeader === undefined ? {} : { showHeader }),
    };
  }

  /** 收集所有 Table 片段的行数上限、起始行号与隐藏表头标记（递归，兼容 Grid 嵌套）。 */
  function collectTableFragments(pages: PhysicalPage[]): Array<{
    maxRows: number;
    startRow: number;
    hideHeader: boolean;
  }> {
    const out: Array<{
      maxRows: number;
      startRow: number;
      hideHeader: boolean;
    }> = [];
    const visit = (node: FormNodeV2): void => {
      if (node.type === "table") {
        const t = node as TableNodeV2 & {
          _paginateMaxRows?: number;
          _paginateStartRow?: number;
          _paginateHideHeader?: boolean;
        };
        out.push({
          maxRows: t._paginateMaxRows ?? Number.MAX_SAFE_INTEGER,
          startRow: t._paginateStartRow ?? 0,
          hideHeader: t._paginateHideHeader === true,
        });
      } else if (node.type === "grid") {
        for (const row of node.rows) {
          for (const cell of row.cells) {
            for (const child of cell.children) visit(child);
          }
        }
      }
    };
    for (const p of pages) {
      for (const c of p.children) visit(c.node);
    }
    return out;
  }

  it("独立 Table 默认重复表头：每个片段都预留表头高度，续页不隐藏表头（66 行 → 32+32+2）", () => {
    const schema: FormSchemaV2 = {
      version: 2,
      paper: { size: "A4" },
      baseRowHeight: 8,
      pages: [
        {
          id: "page-1",
          type: "page",
          mode: "fixed",
          margin: { top: 10, right: 10, bottom: 10, left: 10 },
          children: [makeStandaloneTableNode(66)],
        },
      ],
    };
    const result = paginateSchema(schema);
    const pages = nonEmptyPages(result.pages);
    const frags = collectTableFragments(pages);

    // 66 行全部保留，且续页也预留表头 → 每页 32 行容量
    expect(frags.map((f) => f.maxRows)).toEqual([32, 32, 2]);
    // 默认 true：没有任何片段隐藏表头
    expect(frags.every((f) => !f.hideHeader)).toBe(true);
    // 每页实际高度（含续页表头）不超正文区
    for (const p of pages) {
      let used = 0;
      for (const c of p.children) {
        if (c.node.type === "table") used += tableHeightMm(c.node, 8, null);
      }
      expect(used).toBeLessThanOrEqual(277 + 1.0);
    }
  });

  it("独立 Table repeatHeaderOnBreak=false：续页隐藏表头、不预留表头高度（66 行 → 32+33+1）", () => {
    const schema: FormSchemaV2 = {
      version: 2,
      paper: { size: "A4" },
      baseRowHeight: 8,
      pages: [
        {
          id: "page-1",
          type: "page",
          mode: "fixed",
          margin: { top: 10, right: 10, bottom: 10, left: 10 },
          children: [makeStandaloneTableNode(66, false)],
        },
      ],
    };
    const frags = collectTableFragments(
      nonEmptyPages(paginateSchema(schema).pages),
    );

    // 续页不预留表头 → 每页 33 行容量
    expect(frags.map((f) => f.maxRows)).toEqual([32, 33, 1]);
    // 首片段保留表头；续页片段全部隐藏表头（_paginateHideHeader）
    expect(frags[0].hideHeader).toBe(false);
    expect(frags.slice(1).every((f) => f.hideHeader)).toBe(true);
  });

  it("跨页 Table 片段记录起始行号：续页从上次中断处续绘（66 行 → 0 / 32 / 64）", () => {
    const schema: FormSchemaV2 = {
      version: 2,
      paper: { size: "A4" },
      baseRowHeight: 8,
      pages: [
        {
          id: "page-1",
          type: "page",
          mode: "fixed",
          margin: { top: 10, right: 10, bottom: 10, left: 10 },
          children: [makeStandaloneTableNode(66)],
        },
      ],
    };
    const frags = collectTableFragments(
      nonEmptyPages(paginateSchema(schema).pages),
    );

    expect(frags.map((f) => f.maxRows)).toEqual([32, 32, 2]);
    // 起始行号 0-based：第二页从第 33 行开始画，而不是重画第 1 行
    expect(frags.map((f) => f.startRow)).toEqual([0, 32, 64]);
    // 片段区间连续且完整覆盖 66 行：无重叠、无跳跃、无丢失
    let next = 0;
    for (const frag of frags) {
      expect(frag.startRow).toBe(next);
      next += frag.maxRows;
    }
    expect(next).toBe(66);
  });

  it("网格内 Table repeatHeaderOnBreak=false：splitGrid 切分路径的续页片段也隐藏表头", () => {
    const schema: FormSchemaV2 = {
      version: 2,
      paper: { size: "A4" },
      baseRowHeight: 8,
      pages: [
        {
          id: "page-1",
          type: "page",
          mode: "fixed",
          margin: { top: 10, right: 10, bottom: 10, left: 10 },
          children: [
            {
              id: "grid-1",
              type: "grid",
              border: "all",
              rows: [
                {
                  id: "row-1",
                  type: "grid-row",
                  height: 1,
                  cells: [
                    {
                      id: "cell-1",
                      type: "grid-cell",
                      width: "1fr",
                      children: [makeStandaloneTableNode(66, false)],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const frags = collectTableFragments(
      nonEmptyPages(paginateSchema(schema).pages),
    );

    // splitGrid Table 切分路径同样生效：续页片段写 _paginateHideHeader
    expect(frags.map((f) => f.maxRows)).toEqual([32, 33, 1]);
    expect(frags[0].hideHeader).toBe(false);
    expect(frags.slice(1).every((f) => f.hideHeader)).toBe(true);
  });

  // ── 显示表头（showHeader，2026-10-23）──

  it("showHeader=false：表头不参与估算高（少 1 行 + 1 条分隔线）", () => {
    const ONE_PX_MM = 1 / (96 / 25.4);
    const withHeader = makeStandaloneTableNode(10) as TableNodeV2;
    const withoutHeader = makeStandaloneTableNode(
      10,
      undefined,
      false,
    ) as TableNodeV2;
    const diff =
      tableHeightMm(withHeader, 8, null) -
      tableHeightMm(withoutHeader, 8, null);
    // 差值 = 一个表头行（8mm）+ 该行贡献的一条 1px 下边框
    expect(diff).toBeCloseTo(8 + ONE_PX_MM, 6);
  });

  it("独立 Table showHeader=false：每页可多放 1 行（66 行 → 33+33）", () => {
    const schema: FormSchemaV2 = {
      version: 2,
      paper: { size: "A4" },
      baseRowHeight: 8,
      pages: [
        {
          id: "page-1",
          type: "page",
          mode: "fixed",
          margin: { top: 10, right: 10, bottom: 10, left: 10 },
          children: [makeStandaloneTableNode(66, undefined, false)],
        },
      ],
    };
    const pages = nonEmptyPages(paginateSchema(schema).pages);
    const frags = collectTableFragments(pages);

    // 没有表头 → 每页容量 33 行（有表头时是 32）
    expect(frags.map((f) => f.maxRows)).toEqual([33, 33]);
    // 不需要 _paginateHideHeader：整表本来就不画表头
    expect(frags.every((f) => !f.hideHeader)).toBe(true);
    // 每页估算高不超正文区
    for (const p of pages) {
      let used = 0;
      for (const c of p.children) {
        if (c.node.type === "table") used += tableHeightMm(c.node, 8, null);
      }
      expect(used).toBeLessThanOrEqual(277 + 1.0);
    }
  });

  it("网格内 Table showHeader=false：splitGrid 路径同样不预留表头（66 行 → 33+33）", () => {
    const schema: FormSchemaV2 = {
      version: 2,
      paper: { size: "A4" },
      baseRowHeight: 8,
      pages: [
        {
          id: "page-1",
          type: "page",
          mode: "fixed",
          margin: { top: 10, right: 10, bottom: 10, left: 10 },
          children: [
            {
              id: "grid-1",
              type: "grid",
              border: "all",
              rows: [
                {
                  id: "row-1",
                  type: "grid-row",
                  height: 1,
                  cells: [
                    {
                      id: "cell-1",
                      type: "grid-cell",
                      width: "1fr",
                      children: [makeStandaloneTableNode(66, undefined, false)],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const frags = collectTableFragments(
      nonEmptyPages(paginateSchema(schema).pages),
    );

    // 与独立 Table 同口径：每页 33 行，且续页片段无需隐藏表头
    expect(frags.map((f) => f.maxRows)).toEqual([33, 33]);
    expect(frags.every((f) => !f.hideHeader)).toBe(true);
  });

  // ── 复合表头：表头 N 行（2026-10-23）──

  /** 给 2 列表加一份 2 行复合表头（第一行 2 格、第二行 2 格，layout 合法）。 */
  function withTwoRowHeader(node: FormNodeV2): TableNodeV2 {
    return {
      ...(node as TableNodeV2),
      headerRows: [
        { cells: [{ text: "收工时间" }, { text: "工作负责人", rowspan: 2 }] },
        { cells: [{ text: "月" }] },
      ],
    };
  }

  it("复合表头 2 行：估算高比单行多 1 行 + 1 条行间线", () => {
    const ONE_PX_MM = 1 / (96 / 25.4);
    const single = makeStandaloneTableNode(10) as TableNodeV2;
    const composite = withTwoRowHeader(single);
    const diff =
      tableHeightMm(composite, 8, null) - tableHeightMm(single, 8, null);
    expect(diff).toBeCloseTo(8 + ONE_PX_MM, 6);
  });

  it("独立 Table 2 行表头：每页少放 1 行数据（66 行 → 31+31+4）", () => {
    const schema: FormSchemaV2 = {
      version: 2,
      paper: { size: "A4" },
      baseRowHeight: 8,
      pages: [
        {
          id: "page-1",
          type: "page",
          mode: "fixed",
          margin: { top: 10, right: 10, bottom: 10, left: 10 },
          children: [withTwoRowHeader(makeStandaloneTableNode(66))],
        },
      ],
    };
    const pages = nonEmptyPages(paginateSchema(schema).pages);
    const frags = collectTableFragments(pages);
    // 1 行表头时每页 32 行；2 行表头各扣 8mm → 31 行
    expect(frags.map((f) => f.maxRows)).toEqual([31, 31, 4]);
    expect(frags.every((f) => !f.hideHeader)).toBe(true);
    for (const p of pages) {
      let used = 0;
      for (const c of p.children) {
        if (c.node.type === "table") used += tableHeightMm(c.node, 8, null);
      }
      expect(used).toBeLessThanOrEqual(277 + 1.0);
    }
  });

  it("独立 Table 2 行表头 + repeatHeaderOnBreak=false：仅首片段扣 2 行（66 行 → 31+33+2）", () => {
    const table = withTwoRowHeader(makeStandaloneTableNode(66, false));
    const schema: FormSchemaV2 = {
      version: 2,
      paper: { size: "A4" },
      baseRowHeight: 8,
      pages: [
        {
          id: "page-1",
          type: "page",
          mode: "fixed",
          margin: { top: 10, right: 10, bottom: 10, left: 10 },
          children: [table],
        },
      ],
    };
    const frags = collectTableFragments(
      nonEmptyPages(paginateSchema(schema).pages),
    );
    expect(frags.map((f) => f.maxRows)).toEqual([31, 33, 2]);
    // 续页片段隐藏表头（整块表头都不画），所以只有首片段有表头
    expect(frags[0].hideHeader).toBe(false);
    expect(frags.slice(1).every((f) => f.hideHeader)).toBe(true);
  });

  it("网格内 Table 2 行表头：splitGrid 路径同样按 2 行预留（66 行 → 31+31+4）", () => {
    const schema: FormSchemaV2 = {
      version: 2,
      paper: { size: "A4" },
      baseRowHeight: 8,
      pages: [
        {
          id: "page-1",
          type: "page",
          mode: "fixed",
          margin: { top: 10, right: 10, bottom: 10, left: 10 },
          children: [
            {
              id: "grid-1",
              type: "grid",
              border: "all",
              rows: [
                {
                  id: "row-1",
                  type: "grid-row",
                  height: 1,
                  cells: [
                    {
                      id: "cell-1",
                      type: "grid-cell",
                      width: "1fr",
                      children: [withTwoRowHeader(makeStandaloneTableNode(66))],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const frags = collectTableFragments(
      nonEmptyPages(paginateSchema(schema).pages),
    );
    expect(frags.map((f) => f.maxRows)).toEqual([31, 31, 4]);
  });
});

/**
 * 嵌套表格栈跨页（2026-10-27，A1）。
 *
 * 复现用户模板 `formdesigner-schema-v2-1793082741932.json` 的形态：
 * - 前文网格 6 行（含表格、多行文本），实测约占 106mm；
 * - 第二个网格**只有 1 行**，但该行单元格内嵌一个 3 行网格，每行一张表
 *   （minRows 7 / 6 / 6，实测 66 / 58 / 58mm，合计 182mm）。
 *
 * 修复前：182mm 的「单行」放不进剩余 170mm，短网格分支把整格甩到第二页，
 * 首页尾部空出约 170mm。修复后：按嵌套网格行边界切分，前两块留在首页，
 * 第三块流转第二页，且续页片段的左侧标题格留空。
 */
describe("网格内嵌套表格栈跨页", () => {
  /** 造一张 2 列表、`minRows` 行的表格（border inner，带单行表头）。 */
  function makeTable(id: string, minRows: number): TableNodeV2 {
    return {
      id,
      type: "table",
      minRows,
      border: "inner",
      columns: [
        { key: "c1", title: "列1", width: "1fr" },
        { key: "c2", title: "列2", width: "1fr" },
      ],
      rowTemplate: [
        {
          id: `${id}-tpl-1`,
          type: "table-cell-template",
          columnKey: "c1",
          children: [{ id: `${id}-p-1`, type: "p", mode: "field", field: "" }],
        },
        {
          id: `${id}-tpl-2`,
          type: "table-cell-template",
          columnKey: "c2",
          children: [{ id: `${id}-p-2`, type: "p", mode: "field", field: "" }],
        },
      ],
    };
  }

  /** 造一行，`cells` 为每个单元格的子节点列表。 */
  function makeRow(id: string, cells: GridRowV2["cells"]): GridRowV2 {
    return { id, type: "grid-row", height: 1, cells };
  }

  /** 造一个单元格，`children` 为其子节点。 */
  function makeCell(
    id: string,
    children: GridRowV2["cells"][number]["children"],
  ) {
    return { id, type: "grid-cell" as const, width: "1fr" as const, children };
  }

  /** 前文 6 行的实测高度（合计 106mm，与用户模板的第一个网格同量级）。 */
  const PREFACE_HEIGHTS = [8, 8, 24, 8, 41, 17];

  /** 复现模板结构：前文网格 + 一个「1 行内嵌 3 张表」的网格。 */
  function makeNestedStackSchema(): FormSchemaV2 {
    const prefaceRows: GridRowV2[] = PREFACE_HEIGHTS.map((_, k) =>
      makeRow(`preface-${k}`, [makeCell(`preface-cell-${k}`, [])]),
    );

    const nestedGrid: GridNodeV2 = {
      id: "nested-grid",
      type: "grid",
      border: "inner",
      rows: [
        makeRow("nested-row-0", [
          makeCell("nested-cell-0", [makeTable("t1", 7)]),
        ]),
        makeRow("nested-row-1", [
          makeCell("nested-cell-1", [makeTable("t2", 6)]),
        ]),
        makeRow("nested-row-2", [
          makeCell("nested-cell-2", [makeTable("t3", 6)]),
        ]),
      ],
    };

    return {
      version: 2,
      paper: { size: "A4" },
      baseRowHeight: 8,
      pages: [
        {
          id: "page-1",
          type: "page",
          mode: "fixed",
          margin: { top: 10, right: 10, bottom: 10, left: 10 },
          children: [
            {
              id: "preface",
              type: "grid",
              border: "all",
              rows: prefaceRows,
            },
            {
              id: "second",
              type: "grid",
              border: "all",
              rows: [
                makeRow("second-row", [
                  makeCell("second-title", [
                    {
                      id: "title-text",
                      type: "text",
                      text: "安全措施（必要时可附页绘图说明）",
                    },
                  ]),
                  makeCell("second-body", [nestedGrid]),
                ]),
              ],
            },
          ],
        },
      ],
    };
  }

  /** 实测行高：前文 6 行 + 第二网格外层行 182mm + 3 个嵌套行 66 / 58 / 58mm。 */
  function measureRow(row: GridRowV2): number | undefined {
    if (row.id.startsWith("preface-")) {
      return PREFACE_HEIGHTS[Number(row.id.slice("preface-".length))];
    }
    if (row.id === "second-row") return 182;
    if (row.id === "nested-row-0") return 66;
    if (row.id === "nested-row-1") return 58;
    if (row.id === "nested-row-2") return 58;
    return undefined;
  }

  it("第二个网格按嵌套行切分：前两块接在第一个网格后面，第三块流转第二页", () => {
    const result = paginateSchema(makeNestedStackSchema(), { measureRow });
    const pages = nonEmptyPages(result.pages);

    expect(pages).toHaveLength(2);
    // 首页：前文网格 + 第二个网格的首片段（不再整格甩页）
    expect(pages[0].children.map((c) => c.node.id)).toEqual([
      "preface",
      "second",
    ]);
    const firstFragment = pages[0].children[1].node as GridNodeV2;
    expect(firstFragment.rows).toHaveLength(1);
    const firstNested = firstFragment.rows[0].cells[1]
      .children[0] as GridNodeV2;
    expect(firstNested.rows.map((r) => r.id)).toEqual([
      "nested-row-0",
      "nested-row-1",
    ]);

    // 第二页：只续接最后一个嵌套行；不参与续接的标题格留空
    const secondFragment = pages[1].children[0].node as GridNodeV2;
    const secondRow = secondFragment.rows[0];
    expect(secondRow.cells[0].children).toHaveLength(0);
    const secondNested = secondRow.cells[1].children[0] as GridNodeV2;
    expect(secondNested.rows.map((r) => r.id)).toEqual(["nested-row-2"]);

    // 嵌套行不丢：两个片段合起来仍是 3 行
    expect(firstNested.rows.length + secondNested.rows.length).toBe(3);
    // 无溢出告警
    expect(result.warnings).toHaveLength(0);
  });

  it("续页片段的边框续接：首片段保留顶框，末片段保留底框", () => {
    const pages = nonEmptyPages(
      paginateSchema(makeNestedStackSchema(), { measureRow }).pages,
    );
    expect(pages[0].children[1].suppressBorders?.top).not.toBe(true);
    expect(pages[0].children[1].suppressBorders?.bottom).toBe(true);
    expect(pages[1].children[0].suppressBorders?.top).toBe(true);
    expect(pages[1].children[0].suppressBorders?.bottom).not.toBe(true);
  });

  it("非末行的嵌套表格栈：先用本页剩余空间续填，后续行在第二页接着排", () => {
    const nestedGrid: GridNodeV2 = {
      id: "stack",
      type: "grid",
      border: "inner",
      rows: [
        makeRow("s-row-0", [makeCell("s-cell-0", [makeTable("s-t1", 7)])]),
        makeRow("s-row-1", [makeCell("s-cell-1", [makeTable("s-t2", 6)])]),
        makeRow("s-row-2", [makeCell("s-cell-2", [makeTable("s-t3", 6)])]),
      ],
    };
    const schema: FormSchemaV2 = {
      version: 2,
      paper: { size: "A4" },
      baseRowHeight: 8,
      pages: [
        {
          id: "page-1",
          type: "page",
          mode: "fixed",
          margin: { top: 10, right: 10, bottom: 10, left: 10 },
          children: [
            {
              id: "outer",
              type: "grid",
              border: "all",
              rows: [
                makeRow("outer-head", [makeCell("outer-head-cell", [])]),
                makeRow("outer-stack", [
                  makeCell("outer-title", [
                    { id: "title-text-2", type: "text", text: "安全措施" },
                  ]),
                  makeCell("outer-body", [nestedGrid]),
                ]),
                makeRow("outer-tail", [makeCell("outer-tail-cell", [])]),
              ],
            },
          ],
        },
      ],
    };
    const measure = (row: GridRowV2): number | undefined => {
      if (row.id === "outer-head") return 180;
      if (row.id === "outer-stack") return 182;
      if (row.id === "outer-tail") return 20;
      if (row.id === "s-row-0") return 66;
      if (row.id === "s-row-1") return 58;
      if (row.id === "s-row-2") return 58;
      return undefined;
    };

    const pages = nonEmptyPages(
      paginateSchema(schema, { measureRow: measure }).pages,
    );
    expect(pages).toHaveLength(2);

    // 第一页：前导行 + 表格栈首块（66mm 塞进剩余约 96mm）
    expect(pages[0].children).toHaveLength(2);
    const firstStackFrag = pages[0].children[1].node as GridNodeV2;
    expect(firstStackFrag.rows.map((r) => r.id)).toEqual(["outer-stack"]);
    const firstNested = firstStackFrag.rows[0].cells[1]
      .children[0] as GridNodeV2;
    expect(firstNested.rows.map((r) => r.id)).toEqual(["s-row-0"]);
    // 行内容的首片段仍显示标题（不因「网格已开始」而丢失）
    expect(firstStackFrag.rows[0].cells[0].children).toHaveLength(1);
    // 栈还有余块 → 底框抑制
    expect(pages[0].children[1].suppressBorders?.bottom).toBe(true);

    // 第二页：栈余下两块 + 外层后续行（尾行）继续排在同一页
    expect(pages[1].children).toHaveLength(2);
    const secondStackFrag = pages[1].children[0].node as GridNodeV2;
    const secondNested = secondStackFrag.rows[0].cells[1]
      .children[0] as GridNodeV2;
    expect(secondNested.rows.map((r) => r.id)).toEqual(["s-row-1", "s-row-2"]);
    // 续页片段标题格留空
    expect(secondStackFrag.rows[0].cells[0].children).toHaveLength(0);
    // 外层还有后续行 → 栈片段底框仍抑制
    expect(pages[1].children[0].suppressBorders?.bottom).toBe(true);
    // 尾行以「续接」形态紧跟其后：抑制顶框、保留底框
    const tailFrag = pages[1].children[1].node as GridNodeV2;
    expect(tailFrag.rows.map((r) => r.id)).toEqual(["outer-tail"]);
    expect(pages[1].children[1].suppressBorders?.top).toBe(true);
    expect(pages[1].children[1].suppressBorders?.bottom).not.toBe(true);
  });

  it("同一行两个单元格各有一段表格栈：按行号并行推进，矮栈用尽后留空", () => {
    const stackA: GridNodeV2 = {
      id: "stack-a",
      type: "grid",
      border: "inner",
      rows: [
        makeRow("a-row-0", [makeCell("a-cell-0", [makeTable("a-t1", 9)])]),
        makeRow("a-row-1", [makeCell("a-cell-1", [makeTable("a-t2", 9)])]),
      ],
    };
    const stackB: GridNodeV2 = {
      id: "stack-b",
      type: "grid",
      border: "inner",
      rows: [
        makeRow("b-row-0", [makeCell("b-cell-0", [makeTable("b-t1", 7)])]),
        makeRow("b-row-1", [makeCell("b-cell-1", [makeTable("b-t2", 7)])]),
        makeRow("b-row-2", [makeCell("b-cell-2", [makeTable("b-t3", 7)])]),
      ],
    };
    const schema: FormSchemaV2 = {
      version: 2,
      paper: { size: "A4" },
      baseRowHeight: 8,
      pages: [
        {
          id: "page-1",
          type: "page",
          mode: "fixed",
          margin: { top: 10, right: 10, bottom: 10, left: 10 },
          children: [
            {
              id: "multi",
              type: "grid",
              border: "all",
              rows: [
                makeRow("multi-head", [makeCell("multi-head-cell", [])]),
                makeRow("multi-stack", [
                  makeCell("multi-left", [stackA]),
                  makeCell("multi-right", [stackB]),
                ]),
              ],
            },
          ],
        },
      ],
    };
    const measure = (row: GridRowV2): number | undefined => {
      if (row.id === "multi-head") return 100;
      if (row.id === "multi-stack") return 180;
      if (row.id.startsWith("a-row-")) return 80;
      if (row.id.startsWith("b-row-")) return 60;
      return undefined;
    };

    const pages = nonEmptyPages(
      paginateSchema(schema, { measureRow: measure }).pages,
    );
    expect(pages).toHaveLength(2);

    // 第一页：两栈各推进 2 行（第 3 行放不下）
    const firstRow = (pages[0].children[1].node as GridNodeV2).rows[0];
    const firstA = firstRow.cells[0].children[0] as GridNodeV2;
    const firstB = firstRow.cells[1].children[0] as GridNodeV2;
    expect(firstA.rows.map((r) => r.id)).toEqual(["a-row-0", "a-row-1"]);
    expect(firstB.rows.map((r) => r.id)).toEqual(["b-row-0", "b-row-1"]);

    // 第二页：A 已用尽留空，B 继续第 3 行
    const secondRow = (pages[1].children[0].node as GridNodeV2).rows[0];
    const secondA = secondRow.cells[0].children[0] as GridNodeV2;
    const secondB = secondRow.cells[1].children[0] as GridNodeV2;
    expect(secondA.rows).toHaveLength(0);
    expect(secondB.rows.map((r) => r.id)).toEqual(["b-row-2"]);
  });

  it("深层单链包装：切分发生在叶子层，包装层逐层重建且续页装饰单元格留空", () => {
    // 结构：grid(deep) → row → cell → grid(wrap) → row → cell → grid(leaf) → row → table
    const leafGrid: GridNodeV2 = {
      id: "deep-leaf",
      type: "grid",
      border: "inner",
      rows: [
        makeRow("leaf-row-0", [makeCell("leaf-cell-0", [makeTable("d-t1", 7)])]),
        makeRow("leaf-row-1", [makeCell("leaf-cell-1", [makeTable("d-t2", 6)])]),
        makeRow("leaf-row-2", [makeCell("leaf-cell-2", [makeTable("d-t3", 6)])]),
      ],
    };
    const wrapGrid: GridNodeV2 = {
      id: "deep-wrap",
      type: "grid",
      border: "inner",
      rows: [
        makeRow("wrap-row", [
          makeCell("wrap-label", [
            { id: "wrap-label-text", type: "text", text: "分区标签" },
          ]),
          makeCell("wrap-body", [leafGrid]),
        ]),
      ],
    };
    const schema: FormSchemaV2 = {
      version: 2,
      paper: { size: "A4" },
      baseRowHeight: 8,
      pages: [
        {
          id: "page-1",
          type: "page",
          mode: "fixed",
          margin: { top: 10, right: 10, bottom: 10, left: 10 },
          children: [
            {
              id: "deep-preface",
              type: "grid",
              border: "all",
              rows: [makeRow("deep-preface-row", [makeCell("deep-preface-cell", [])])],
            },
            {
              id: "deep-outer",
              type: "grid",
              border: "all",
              rows: [
                makeRow("deep-row", [
                  makeCell("deep-title", [
                    { id: "deep-title-text", type: "text", text: "深层区块" },
                  ]),
                  makeCell("deep-body", [wrapGrid]),
                ]),
              ],
            },
          ],
        },
      ],
    };
    const measure = (row: GridRowV2): number | undefined => {
      if (row.id === "deep-preface-row") return 100;
      if (row.id === "deep-row") return 182;
      if (row.id === "wrap-row") return 182;
      if (row.id === "leaf-row-0") return 66;
      if (row.id === "leaf-row-1") return 58;
      if (row.id === "leaf-row-2") return 58;
      return undefined;
    };

    const pages = nonEmptyPages(
      paginateSchema(schema, { measureRow: measure }).pages,
    );
    expect(pages).toHaveLength(2);

    /** 从外层片段逐层取出叶子 Grid。 */
    const leafOf = (fragment: GridNodeV2): GridNodeV2 => {
      const wrap = fragment.rows[0].cells[1].children[0] as GridNodeV2;
      return wrap.rows[0].cells[1].children[0] as GridNodeV2;
    };

    // 第一页：叶子前两行，两层装饰（标题 / 分区标签）都保留
    const firstFragment = pages[0].children[1].node as GridNodeV2;
    const firstWrap = firstFragment.rows[0].cells[1].children[0] as GridNodeV2;
    expect(firstFragment.rows[0].cells[0].children).toHaveLength(1);
    expect(firstWrap.rows[0].cells[0].children).toHaveLength(1);
    expect(leafOf(firstFragment).rows.map((r) => r.id)).toEqual([
      "leaf-row-0",
      "leaf-row-1",
    ]);

    // 第二页：叶子末行；两层装饰都留空
    const secondFragment = pages[1].children[0].node as GridNodeV2;
    const secondWrap = secondFragment.rows[0].cells[1].children[0] as GridNodeV2;
    expect(secondFragment.rows[0].cells[0].children).toHaveLength(0);
    expect(secondWrap.rows[0].cells[0].children).toHaveLength(0);
    expect(leafOf(secondFragment).rows.map((r) => r.id)).toEqual(["leaf-row-2"]);
  });
});
