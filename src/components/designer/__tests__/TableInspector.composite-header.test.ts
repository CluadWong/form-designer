import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import TableInspector from "@/components/designer/inspectors/TableInspector.vue";
import { createTableNodeV2 } from "@/types";
import type { TableHeaderRowV2, TableNodeV2 } from "@/types";
import type { SchemaEdits } from "@/components/designer/composables/useSchemaEdits";

/**
 * 表格面板「表头与列」网格编辑器（2026-10-27 重设计）。
 *
 * 旧面板把表头与列拆成两张同构键值表（标题两处、增删两套、span 靠数字框），
 * 新面板只有一个入口：网格里选格 → 合并/拆分/删格，列带里增删列。
 * 本文件锁住新契约：
 * 1. 单行投影改字**直写列标题**（不固化矩阵，导出 JSON 不膨胀）；
 * 2. 已有矩阵改字提交整份矩阵；
 * 3. 合并/拆分/删格/增删行都是「整份矩阵 + 自动补洞」，面板操作不会产出非法布局；
 * 4. 列只从列带增删。
 */
function mountInspector(node: TableNodeV2) {
  const updateRows = vi.fn();
  const updateColumn = vi.fn();
  const resetHeader = vi.fn();
  const removeColumn = vi.fn();
  const addColumn = vi.fn();
  const handlers: Record<string, unknown> = {
    updateTableHeaderRows: updateRows,
    updateTableColumn: updateColumn,
    resetTableHeaderRows: resetHeader,
    removeTableColumn: removeColumn,
    addTableColumn: addColumn,
  };
  const api = new Proxy(handlers, {
    get: (target, key) => target[key as string] ?? (() => undefined),
  }) as unknown as SchemaEdits;
  const wrapper = mount(TableInspector, { props: { node, api } });
  return { wrapper, updateRows, updateColumn, resetHeader, removeColumn, addColumn };
}

function lastRows(fn: ReturnType<typeof vi.fn>): TableHeaderRowV2[] {
  return fn.mock.calls.at(-1)?.[0] as TableHeaderRowV2[];
}

function compositeNode(): TableNodeV2 {
  return {
    ...createTableNodeV2(),
    headerRows: [
      { cells: [{ text: "收工时间", colspan: 2 }] },
      { cells: [{ text: "月" }, { text: "日" }] },
    ],
  };
}

/** 选中某个格（点击格本身，不依赖 textarea 的 focus）。 */
async function selectCell(wrapper: ReturnType<typeof mountInspector>["wrapper"], key: string) {
  await wrapper.find(`[data-header-cell="${key}"]`).trigger("click");
}

describe("TableInspector 表头网格", () => {
  it("单行投影：按列标题渲染一行格，且不写回 schema", () => {
    const node = createTableNodeV2();
    const { wrapper, updateRows } = mountInspector(node);
    const cells = wrapper.findAll("[data-header-row]");
    expect(cells).toHaveLength(2);
    expect(
      cells.map((cell) => (cell.find("[data-header-text]").element as HTMLTextAreaElement).value),
    ).toEqual(node.columns.map((column) => column.title));
    expect(updateRows).not.toHaveBeenCalled();
  });

  it("单行投影改字 → 直写列标题（不固化 headerRows）", async () => {
    const { wrapper, updateRows, updateColumn } = mountInspector(createTableNodeV2());
    const input = wrapper.findAll("[data-header-text]")[0];
    await input.setValue("收工时间");
    await input.trigger("change");
    expect(updateColumn).toHaveBeenCalledWith("col1", "title", expect.anything());
    expect(updateRows).not.toHaveBeenCalled();
  });

  it("已有矩阵改字 → 提交整份矩阵，其余格原样保留", async () => {
    const { wrapper, updateRows } = mountInspector(compositeNode());
    const first = wrapper.findAll("[data-header-text]")[0];
    await first.setValue("收工日期");
    await first.trigger("change");
    const rows = lastRows(updateRows);
    expect(rows).toHaveLength(2);
    expect(rows[0].cells[0]).toMatchObject({ text: "收工日期", colspan: 2 });
    expect(rows[1].cells.map((cell) => cell.text)).toEqual(["月", "日"]);
  });

  it("选中格后才出现操作条：未选中给引导语，不渲染合并按钮", async () => {
    const { wrapper } = mountInspector(compositeNode());
    expect(wrapper.find('[data-header-grow-col="true"]').exists()).toBe(false);
    expect(wrapper.find("[data-header-cellbar]").text()).toContain("点选表头格");

    await selectCell(wrapper, "1-1");
    expect(wrapper.find('[data-header-grow-col="true"]').exists()).toBe(true);
    expect(wrapper.find("[data-header-cell-label]").text()).toContain("收工时间");
  });

  it("向右合并一格 → colspan+1；跨行合并 → rowspan+1", async () => {
    const node: TableNodeV2 = {
      ...createTableNodeV2(),
      columns: [
        { key: "col1", title: "列 1", width: "1fr" },
        { key: "col2", title: "列 2", width: "1fr" },
        { key: "col3", title: "列 3", width: "1fr" },
      ],
      headerRows: [{ cells: [{ text: "A" }, { text: "B" }, { text: "C" }] }],
    };
    const { wrapper, updateRows } = mountInspector(node);
    await selectCell(wrapper, "1-1");
    await wrapper.find('[data-header-grow-col="true"]').trigger("click");

    let rows = lastRows(updateRows);
    expect(rows[0].cells[0]).toMatchObject({ text: "A", colspan: 2 });
    expect(rows[0].cells.map((cell) => cell.text)).toEqual(["A", "C"]);
  });

  it("不可合并时按钮禁用：跨列已顶到最右列", async () => {
    const { wrapper } = mountInspector(compositeNode());
    await selectCell(wrapper, "1-1");
    const grow = wrapper.find('[data-header-grow-col="true"]');
    // 第 1 行只有一格，已跨满 2 列 → 不能再向右合并
    expect((grow.element as HTMLButtonElement).disabled).toBe(true);
  });

  it("拆分跨列格 → 摊出的列自动补空格，行仍占满", async () => {
    const { wrapper, updateRows } = mountInspector(compositeNode());
    await selectCell(wrapper, "1-1");
    await wrapper.find('[data-header-shrink-col="true"]').trigger("click");

    const rows = lastRows(updateRows);
    expect(rows[0].cells[0].colspan).toBeUndefined();
    // 被让出的一列由空格补上，否则整张表头会回退单行
    expect(rows[0].cells).toHaveLength(2);
    expect(rows[0].cells[1].text).toBe("");
    expect(rows[1].cells.map((cell) => cell.text)).toEqual(["月", "日"]);
  });

  it("删格 → 占地并入同行左邻，行依旧占满", async () => {
    const { wrapper, updateRows } = mountInspector(compositeNode());
    await selectCell(wrapper, "2-2");
    await wrapper.find('[data-header-remove-cell="true"]').trigger("click");

    const rows = lastRows(updateRows);
    expect(rows[1].cells).toHaveLength(1);
    expect(rows[1].cells[0]).toMatchObject({ text: "月", colspan: 2 });
  });

  it("整行只剩一格时禁止删格", async () => {
    const { wrapper } = mountInspector(compositeNode());
    await selectCell(wrapper, "1-1");
    expect(
      (wrapper.find('[data-header-remove-cell="true"]').element as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("+ 行：末尾追加一行并逐列补满", async () => {
    const { wrapper, updateRows } = mountInspector(compositeNode());
    await wrapper.find('[data-header-add-row="true"]').trigger("click");
    const rows = lastRows(updateRows);
    expect(rows).toHaveLength(3);
    expect(rows[2].cells).toHaveLength(2);
    expect(rows[2].cells.every((cell) => cell.text === "")).toBe(true);
  });

  it("删行：固定删对应行，只剩一行时按钮禁用", async () => {
    const { wrapper, updateRows } = mountInspector(compositeNode());
    const removeButtons = wrapper.findAll('[data-header-remove-row="true"]');
    expect(removeButtons).toHaveLength(2);
    await removeButtons[0].trigger("click");
    const rows = lastRows(updateRows);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells.map((cell) => cell.text)).toEqual(["月", "日"]);

    const single = mountInspector(createTableNodeV2()).wrapper;
    expect(
      (single.find('[data-header-remove-row="true"]').element as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("恢复单行：调用专用重置（先摊平文字再删矩阵），无矩阵时禁用", async () => {
    const { wrapper, resetHeader } = mountInspector(compositeNode());
    await wrapper.find('[data-header-reset="true"]').trigger("click");
    expect(resetHeader).toHaveBeenCalledTimes(1);

    const single = mountInspector(createTableNodeV2()).wrapper;
    expect(
      (single.find('[data-header-reset="true"]').element as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("列带：与网格同列对齐，一列一格；改字段名 / 宽度 / 删列都走列 API", async () => {
    const { wrapper, removeColumn, updateColumn } = mountInspector(compositeNode());
    const band = wrapper.find('[data-table-columns="true"]');
    const colCells = band.findAll("[data-table-column]");
    expect(colCells).toHaveLength(2);
    expect(colCells.map((cell) => cell.attributes("data-table-column"))).toEqual(["col1", "col2"]);

    await colCells[0].find("[data-col-key]").setValue("day");
    await colCells[0].find("[data-col-key]").trigger("change");

    await colCells[1].find("[data-col-width]").setValue("30mm");
    await colCells[1].find("[data-col-width]").trigger("change");

    await wrapper.findAll('[data-col-remove="true"]')[0].trigger("click");
    expect(removeColumn).toHaveBeenCalledWith("col1");
    expect(updateColumn).toHaveBeenCalledWith("col2", "width", expect.anything());
  });

  it("列带只有一列时禁止删列", () => {
    const node: TableNodeV2 = {
      ...createTableNodeV2(),
      columns: [{ key: "col1", title: "列 1", width: "1fr" }],
      rowTemplate: [createTableNodeV2().rowTemplate[0]],
    };
    const { wrapper } = mountInspector(node);
    expect(
      (wrapper.find('[data-col-remove="true"]').element as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("布局非法时给出可读提示（渲染与分页此后回退单行表头）", () => {
    const node: TableNodeV2 = {
      ...createTableNodeV2(),
      // 两格合计跨 4 列，但只有 2 列 → 越界
      headerRows: [{ cells: [{ text: "A", colspan: 2 }, { text: "B", colspan: 2 }] }],
    };
    const { wrapper } = mountInspector(node);
    const issue = wrapper.find('[data-header-issue="true"]');
    expect(issue.exists()).toBe(true);
    expect(issue.text()).toContain("超出 2 列");
    expect(mountInspector(compositeNode()).wrapper.find('[data-header-issue="true"]').exists()).toBe(
      false,
    );
  });

  it("关闭「显示表头」时网格淡化（配置仍可编辑）", () => {
    const { wrapper } = mountInspector({ ...compositeNode(), showHeader: false });
    expect(wrapper.find("[data-table-header-editor]").classes()).toContain("v2-sheet--muted");
  });
});
