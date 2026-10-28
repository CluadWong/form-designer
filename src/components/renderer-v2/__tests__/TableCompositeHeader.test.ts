import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { GridFormRenderer } from "@/components/renderer-v2";
import {
  createEmptyFormSchemaV2,
  createGridBySizeV2,
  createTableNodeV2,
  insertRootGridV2,
  appendNodeToCellV2,
} from "@/types";
import type { FormSchemaV2, TableColumnV2, TableNodeV2 } from "@/types";

/**
 * 复合表头渲染（2026-10-23）。
 *
 * 背景：`.layout-table` 被 CSS 改成 `display: block` + `tr { display: grid }`，
 * HTML 的 `colspan` / `rowspan` 在这种布局下**不生效**。故表头跨行跨列改用
 * grid 定位（`grid-row-start/span`、`grid-column-start/span`）实现，边框也由
 * 布局求解给出归属，覆盖掉按 DOM 顺序判断的 `:not(:last-child)` 规则。
 */
const COLUMN_COUNT = 12;

function columns(count = COLUMN_COUNT): TableColumnV2[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `c${index + 1}`,
    title: `列${index + 1}`,
    width: "1fr" as const,
  }));
}

function schemaWithTable(table: TableNodeV2): FormSchemaV2 {
  const grid = createGridBySizeV2({ rows: 1, columns: 1, border: "all" });
  return appendNodeToCellV2(
    insertRootGridV2(createEmptyFormSchemaV2(), grid),
    grid.rows[0].cells[0].id,
    table,
  );
}

/** 用户实例：12 列 × 2 行（2 个 colspan=4 分组 + 4 个 rowspan=2 独立列 + 8 个「月日时分」）。 */
function compositeTable(): TableNodeV2 {
  const cols = columns();
  return {
    ...createTableNodeV2(),
    columns: cols,
    rowTemplate: cols.map((column) => ({
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
      {
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
      },
    ],
    border: "all",
  };
}

function mountTable(table: TableNodeV2) {
  const wrapper = mount(GridFormRenderer, { props: { schema: schemaWithTable(table) } });
  return { wrapper, ths: wrapper.findAll("thead th") };
}

function styleOf(el: Element): CSSStyleDeclaration {
  return (el as HTMLElement).style;
}

describe("复合表头渲染（grid 模拟 colspan / rowspan）", () => {
  it("12 列 2 行：渲染 14 个 th，第一行 6 格、第二行 8 格", () => {
    const { ths } = mountTable(compositeTable());
    expect(ths).toHaveLength(14);
    expect(ths.map((th) => th.text())).toEqual([
      "收工时间",
      "工作负责人",
      "工作许可人",
      "开工时间",
      "工作负责人",
      "工作许可人",
      "月",
      "日",
      "时",
      "分",
      "月",
      "日",
      "时",
      "分",
    ]);
  });

  it("colspan / rowspan 落到 grid 定位（列宽仍由列定义驱动）", () => {
    const { ths } = mountTable(compositeTable());
    const first = styleOf(ths[0].element);
    // 收工时间：第 1 行第 1 列起，跨 1 行 4 列
    expect(first.gridRowStart).toBe("1");
    expect(first.gridColumnStart).toBe("1");
    expect(first.gridRow).toBe("span 1");
    expect(first.gridColumn).toBe("span 4");

    const owner = styleOf(ths[1].element);
    // 工作负责人：第 1 行第 5 列起，跨 2 行 1 列
    expect(owner.gridRowStart).toBe("1");
    expect(owner.gridColumnStart).toBe("5");
    expect(owner.gridRow).toBe("span 2");
    expect(owner.gridColumn).toBe("span 1");

    const sub = styleOf(ths[6].element);
    // 第二行「月」：第 2 行第 1 列
    expect(sub.gridRowStart).toBe("2");
    expect(sub.gridColumnStart).toBe("1");
  });

  it("表头行容器声明 N 条行轨道（每行一个基准行高）", () => {
    const { wrapper } = mountTable(compositeTable());
    const row = wrapper.find("thead tr").element as HTMLElement;
    expect(row.style.gridTemplateRows).toBe("repeat(2, minmax(8mm, auto))");
    expect(row.style.gridTemplateColumns.split(" ")).toHaveLength(COLUMN_COUNT);
  });

  it("边框按格位下发：触右列/表头末行的格宽度为 0，其余 1px（避免合并格双线）", () => {
    const { ths } = mountTable(compositeTable());
    const lastColOwner = styleOf(ths[5].element); // 第一行 col12「工作许可人」
    expect(lastColOwner.borderRightWidth).toBe("0px");
    expect(lastColOwner.borderBottomWidth).toBe("0px");

    const groupHead = styleOf(ths[0].element); // 收工时间：右侧与下行都有内线
    expect(groupHead.borderRightWidth).toBe("1px");
    expect(groupHead.borderBottomWidth).toBe("1px");

    const subMinute = styleOf(ths[9].element); // 第二行 col4「分」：右侧有 rowspan 格，需自己画线
    expect(subMinute.borderRightWidth).toBe("1px");
    expect(subMinute.borderBottomWidth).toBe("0px");
  });

  it("四边宽度全部显式给出：上/左为 0px（写了 border-style 后未声明边会回落 3px）", () => {
    const { ths } = mountTable(compositeTable());
    for (const th of ths) {
      const style = styleOf(th.element);
      // 只要给 borderStyle，没写宽度的边就按 `border-width: medium` = 3px 渲染：
      // 与邻格的 1px 并排 → 4px 粗线（2026-10-23 真机实测，用户报的「表头边框重叠」）。
      expect(style.borderStyle).toBe("solid");
      expect(style.borderTopWidth).toBe("0px");
      expect(style.borderLeftWidth).toBe("0px");
    }
  });

  it("边框 none / outer 时不画内部线，也不下发任何 border（否则 3px 默认宽度凭空出现）", () => {
    for (const mode of ["none", "outer"] as const) {
      const { ths } = mountTable({ ...compositeTable(), border: mode });
      for (const th of ths) {
        const style = styleOf(th.element);
        expect(style.borderStyle).toBe("");
        expect(style.borderTopWidth).toBe("");
        expect(style.borderRightWidth).toBe("");
        expect(style.borderBottomWidth).toBe("");
        expect(style.borderLeftWidth).toBe("");
      }
    }
  });

  it("单行表头（未配 headerRows）不引入任何 grid span / 边框内联，输出与旧版一致", () => {
    const cols = columns(3);
    const table: TableNodeV2 = {
      ...createTableNodeV2(),
      columns: cols,
      rowTemplate: cols.map((column) => ({
        id: `tpl-${column.key}`,
        type: "table-cell-template" as const,
        columnKey: column.key,
        children: [],
      })),
    };
    const { wrapper, ths } = mountTable(table);
    expect(ths).toHaveLength(3);
    expect(ths.map((th) => th.text())).toEqual(["列1", "列2", "列3"]);

    const first = styleOf(ths[0].element);
    expect(first.gridRowStart).toBe("");
    expect(first.gridColumn).toBe("");
    expect(first.borderRightWidth).toBe("");
    expect(first.borderBottomWidth).toBe("");
    // 行容器沿用旧样：列宽 + minHeight，没有多行轨道
    const row = wrapper.find("thead tr").element as HTMLElement;
    expect(row.style.gridTemplateRows).toBe("");
    expect(row.style.minHeight).toBe("8mm");
  });

  it("布局非法时回退单行表头（画 12 格，不出现错位/空洞）", () => {
    const table = compositeTable();
    table.headerRows = [table.headerRows![0]]; // 只有跨行格那一行 → 第二行缺格
    const { wrapper, ths } = mountTable(table);
    expect(ths).toHaveLength(COLUMN_COUNT);
    expect(ths.map((th) => th.text())).toEqual(columns().map((c) => c.title));
    const row = wrapper.find("thead tr").element as HTMLElement;
    expect(row.style.gridTemplateRows).toBe("");
  });

  it("showHeader=false 时即便配了复合表头也不渲染 thead", () => {
    const table = { ...compositeTable(), showHeader: false };
    const { wrapper } = mountTable(table);
    expect(wrapper.find("thead").exists()).toBe(false);
  });
});
