import { describe, expect, it } from "vitest";
import {
  resolveTableHeaderLayoutV2,
  resolveTableHeaderRowCountV2,
  resolveTableHeaderRowsV2,
} from "@/engine-v2/derivation";
import { createTableNodeV2 } from "@/types";
import type { TableColumnV2, TableHeaderRowV2, TableNodeV2 } from "@/types";

/**
 * 复合表头布局求解（2026-10-23）。
 *
 * 基准用例是用户给的真实结构（电力工作票「收工/开工时间」段）：
 * 12 个数据列 × 2 行表头，第一行 2 个 colspan=4 的分组 + 4 个 rowspan=2 的独立列，
 * 第二行 8 个「月/日/时/分」子列。
 */
const COLUMN_KEYS = [
  "off_month",
  "off_day",
  "off_hour",
  "off_min",
  "owner1",
  "permitter1",
  "on_month",
  "on_day",
  "on_hour",
  "on_min",
  "owner2",
  "permitter2",
];

function sub4(): TableHeaderRowV2 {
  return {
    cells: [
      { text: "月" },
      { text: "日" },
      { text: "时" },
      { text: "分" },
      { text: "月" },
      { text: "日" },
      { text: "时" },
      { text: "分" },
    ],
  };
}

function makeCompositeTable(): TableNodeV2 {
  const columns: TableColumnV2[] = COLUMN_KEYS.map((key) => ({ key, title: key, width: "1fr" }));
  return {
    ...createTableNodeV2(),
    columns,
    rowTemplate: columns.map((column) => ({
      id: `tpl-${column.key}`,
      type: "table-cell-template" as const,
      columnKey: column.key,
      children: [],
    })),
    headerRows: [
      {
        cells: [
          { text: "收工时间", colspan: 4 },
          { text: "工作负责人", rowspan: 2 },
          { text: "工作许可人", rowspan: 2 },
          { text: "开工时间", colspan: 4 },
          { text: "工作负责人", rowspan: 2 },
          { text: "工作许可人", rowspan: 2 },
        ],
      },
      sub4(),
    ],
  };
}

describe("复合表头布局求解 resolveTableHeaderLayoutV2", () => {
  it("用户实例：12 列 2 行，格位 / 跨列跨行 / 边框归属全部正确", () => {
    const layout = resolveTableHeaderLayoutV2(makeCompositeTable());

    expect(layout.valid).toBe(true);
    expect(layout.issues).toEqual([]);
    expect(layout.columnCount).toBe(12);
    expect(layout.rowCount).toBe(2);

    // 第一行 6 格 + 第二行 8 格
    expect(layout.cells).toHaveLength(14);

    const brief = layout.cells.map(
      (c) => `${c.text}@${c.rowStart}-${c.colStart}r${c.rowSpan}c${c.colSpan}`,
    );
    expect(brief).toEqual([
      "收工时间@1-1r1c4",
      "工作负责人@1-5r2c1",
      "工作许可人@1-6r2c1",
      "开工时间@1-7r1c4",
      "工作负责人@1-11r2c1",
      "工作许可人@1-12r2c1",
      "月@2-1r1c1",
      "日@2-2r1c1",
      "时@2-3r1c1",
      "分@2-4r1c1",
      "月@2-7r1c1",
      "日@2-8r1c1",
      "时@2-9r1c1",
      "分@2-10r1c1",
    ]);
  });

  it("边框只画右 / 下边：触右不画竖线、触表头末行不画横线（避免合并格双线）", () => {
    const layout = resolveTableHeaderLayoutV2(makeCompositeTable());
    // 表头里「工作许可人」出现两次（col6 / col12），必须按格位取，不能按文字取
    const at = (rowStart: number, colStart: number) =>
      layout.cells.find((c) => c.rowStart === rowStart && c.colStart === colStart)!;

    // 收工时间跨 4 列但未触及最右列 → 右边要画；未跨行 → 下边要画（与「月日时分」行分界）
    expect(at(1, 1)).toMatchObject({ text: "收工时间", borderRight: true, borderBottom: true });
    // 最右列的「工作许可人」rowspan=2：右边由表格外框负责、下边是表头末行 → 都不画
    expect(at(1, 12)).toMatchObject({
      text: "工作许可人",
      borderRight: false,
      borderBottom: false,
    });
    // 非最右列的「工作许可人」（col6）：右边要画，下边仍不画（rowspan 到底）
    expect(at(1, 6)).toMatchObject({
      text: "工作许可人",
      borderRight: true,
      borderBottom: false,
    });
    // 第二行「分」在 col4：右边要画（右侧是 rowspan 格，没有左边线来提供这条线）
    expect(at(2, 4)).toMatchObject({ text: "分", borderRight: true, borderBottom: false });
    // 第二行「分」在 col10：右边要画；下边是表头末行 → 不画
    expect(at(2, 10)).toMatchObject({ text: "分", borderRight: true, borderBottom: false });
  });

  it("未配置 headerRows 时回落到 columns 单行，布局等价于旧行为", () => {
    const node = createTableNodeV2();
    const rows = resolveTableHeaderRowsV2(node);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells.map((c) => c.text)).toEqual(node.columns.map((c) => c.title));

    const layout = resolveTableHeaderLayoutV2(node);
    expect(layout.valid).toBe(true);
    expect(layout.rowCount).toBe(1);
    expect(layout.cells.every((c) => c.rowSpan === 1 && c.colSpan === 1)).toBe(true);
    // 单行表头：末格不画右边、所有格都不画下边（表头底边由容器 border-bottom 负责）
    expect(layout.cells.map((c) => c.borderRight)).toEqual([true, false]);
    expect(layout.cells.every((c) => !c.borderBottom)).toBe(true);
  });

  it("布局非法：某行缺格 → 回退单行表头并给出可读原因", () => {
    const node = makeCompositeTable();
    // 第二行只放 7 格 → col10 空缺
    node.headerRows = [
      node.headerRows![0],
      { cells: [...sub4().cells.slice(0, 7)] },
    ];
    const layout = resolveTableHeaderLayoutV2(node);
    expect(layout.valid).toBe(false);
    expect(layout.issues[0]).toContain("第 2 行缺少第 10 列");
    // 回退：渲染与分页只看到 1 行
    expect(layout.rowCount).toBe(1);
    expect(layout.cells).toHaveLength(node.columns.length);
  });

  it("布局非法：跨列超出列数 / 跨行超出表头行数 都被拦下", () => {
    const node = makeCompositeTable();
    node.headerRows = [{ cells: [{ text: "太宽", colspan: 13 }] }];
    expect(resolveTableHeaderLayoutV2(node).issues[0]).toContain("跨列后超出 12 列");

    const node2 = makeCompositeTable();
    node2.headerRows = [
      { cells: [{ text: "跨太多行", rowspan: 3 }] },
    ];
    expect(resolveTableHeaderLayoutV2(node2).issues[0]).toContain("跨行超出 1 行表头");
  });

  it("非法 span（0 / 负数 / 非整数）按 1 处理，不产生崩溃或 NaN 定位", () => {
    const node = createTableNodeV2();
    node.headerRows = [
      {
        cells: [
          { text: "A", colspan: 0 },
          { text: "B", rowspan: -3 },
        ],
      },
    ];
    const layout = resolveTableHeaderLayoutV2(node);
    expect(layout.valid).toBe(true);
    expect(layout.cells.map((c) => [c.text, c.colStart, c.colSpan, c.rowSpan])).toEqual([
      ["A", 1, 1, 1],
      ["B", 2, 1, 1],
    ]);
  });

  it("表头行数：showHeader=false / 续页隐藏片段 → 0；复合表头 → 2", () => {
    expect(resolveTableHeaderRowCountV2(makeCompositeTable())).toBe(2);
    expect(
      resolveTableHeaderRowCountV2({ ...makeCompositeTable(), showHeader: false }),
    ).toBe(0);
    expect(
      resolveTableHeaderRowCountV2({ ...makeCompositeTable(), _paginateHideHeader: true }),
    ).toBe(0);
    expect(resolveTableHeaderRowCountV2(createTableNodeV2())).toBe(1);
  });
});
