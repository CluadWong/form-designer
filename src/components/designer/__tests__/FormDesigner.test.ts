import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import FormDesigner from "@/components/designer/FormDesigner.vue";
import type { FormSchemaV2 } from "@/types";
import { makeYunlvSecondTicketFirstFiveRowsSchema } from "@/dev/yunlv-second-ticket-first-five-rows";

function schemaOf(wrapper: VueWrapper): FormSchemaV2 {
  return (wrapper.vm as unknown as { schema: FormSchemaV2 }).schema;
}

function gridById(schema: FormSchemaV2, id: string) {
  const node = schema.pages[0].children.find(child => child.id === id);
  if (node?.type !== "grid") throw new Error(`fixture grid missing: ${id}`);
  return node;
}

/** 找到包含指定字段节点的单元格及其所属 Grid（九续：Grid 嵌套测试用）。 */
function findOwnerCellOfField(schema: FormSchemaV2, fieldId: string) {
  for (const child of schema.pages[0].children) {
    if (child.type !== "grid") continue;
    for (const row of child.rows) {
      for (const cell of row.cells) {
        if (cell.children.some(c => c.id === fieldId)) {
          return { cell, gridId: child.id };
        }
      }
    }
  }
  return null;
}

/**
 * 默认初始化已改为空白（见 FormDesigner 改造），故需显式注入前五行样例，
 * 使依赖其 fixture 节点（unit-field / ticket-layout / work-task-table 等）的用例仍可运行。
 */
function mountDesigner() {
  return mount(FormDesigner, {
    props: {
      initialSchema: makeYunlvSecondTicketFirstFiveRowsSchema(),
      // 预览不再注入预置种子数据（2026-09-08）：进入预览即为空表单。
    },
  });
}

describe("FormDesigner V2 selection and deletion", () => {
  it("cycles from a filled cell component through its cell to ancestors", async () => {
    const wrapper = mountDesigner();
    const field = wrapper.find('[data-node-id="unit-field"]');

    await field.trigger("click");
    expect(wrapper.findAll(".v2-inspector-row")[0]?.text()).toContain("字段");

    await field.trigger("click");
    expect(wrapper.findAll(".v2-inspector-row")[0]?.text()).toContain("格子");

    await field.trigger("click");
    expect(wrapper.findAll(".v2-inspector-row")[0]?.text()).toContain("网格");

    await field.trigger("click");
    expect(wrapper.findAll(".v2-inspector-row")[0]?.text()).toContain("页面");

    await field.trigger("click");
    expect(wrapper.findAll(".v2-inspector-row")[0]?.text()).toContain("字段");
  });

  it("removes a selected root grid from the rendered page", async () => {
    const wrapper = mountDesigner();
    const grid = wrapper.find('[data-node-id="ticket-layout"]');

    await grid.trigger("click");

    const deleteButton = wrapper.find(".v2-tree__delete");
    expect(deleteButton.attributes("disabled")).toBeUndefined();
    await deleteButton.trigger("click");

    expect(wrapper.find('[data-node-id="ticket-layout"]').exists()).toBe(false);
  });

  it("selects a cell but disables its deletion; the Grid itself stays deletable", async () => {
    const wrapper = mountDesigner();
    const addGridButton = wrapper
      .findAll(".v2-palette-item--button")
      .find(button => button.text().includes("网格"));

    await addGridButton?.trigger("click");
    const grid = wrapper.find('[data-node-id^="grid-"]');
    const cell = grid.find('[data-layout-id^="cell-"]');
    await cell.trigger("click");

    // 选中格子：删除禁用，检查器显示「格子」
    const deleteButton = wrapper.find(".v2-tree__delete");
    expect(deleteButton.attributes("disabled")).toBeDefined();
    expect(wrapper.findAll(".v2-inspector-row")[0]?.text()).toContain("格子");

    // 选中 Grid 本身仍可删除
    await grid.trigger("click");
    expect(wrapper.find(".v2-tree__delete").attributes("disabled")).toBeUndefined();
    await wrapper.find(".v2-tree__delete").trigger("click");

    expect(wrapper.find('[data-node-id^="grid-"]').exists()).toBe(false);
    expect(wrapper.findAll(".v2-issue").some(issue => issue.text().includes("至少需要一行"))).toBe(false);
  });

  it("updates row and column counts from the selected Grid inspector", async () => {
    const wrapper = mountDesigner();
    await wrapper.find('[data-node-id="ticket-layout"]').trigger("click");

    const rowsInput = wrapper.find('input[data-dimension="rows"]');
    const columnsInput = wrapper.find('input[data-dimension="columns"]');
    await rowsInput.setValue("6");
    await rowsInput.trigger("change");
    await columnsInput.setValue("3");
    await columnsInput.trigger("change");

    const grid = wrapper.find('[data-node-id="ticket-layout"]');
    expect(grid.findAll(":scope > .layout-grid__row")).toHaveLength(6);
    expect(grid.find('[data-layout-id="row-unit-number"]').findAll(":scope > .layout-grid__cell")).toHaveLength(3);
  });

  it("deleting a table column removes its derived field template (table P not individually selectable)", async () => {
    const wrapper = mountDesigner();
    // 点击表格内的默认字段 P → 因不可单独选中，回退选中所属 Table
    await wrapper.find("tbody .layout-p").trigger("click");
    // 选中高亮（A5）由 CanvasSurface 经 MutationObserver 异步注入 .is-design-selected，
    // 内层 nextTick 才落地，故需两次 flush。
    await nextTick();
    await nextTick();
    expect(wrapper.find('[data-node-id="work-task-table"]').classes()).toContain(
      "is-design-selected",
    );

    // 表格面板列出 2 列（location / content），各有删除按钮。
    // 注意：右侧面板底部还有通用的「额外属性」键值表（同为 .v2-col-table），
    // 故这里用 data-table-columns 钩子限定到「列配置」表。
    const colTable = wrapper.find('[data-table-columns="true"]');
    expect(colTable.findAll(".v2-col-table__row")).toHaveLength(3); // 1 表头 + 2 列行
    const firstColDelete = colTable.find(".v2-col-table__row .v2-inspector__delete--small");
    expect(firstColDelete.attributes("disabled")).toBeUndefined();
    await firstColDelete.trigger("click");
    await nextTick();

    // 删除后列数减一，渲染层表格只剩 1 列（对应派生字段一并移除）
    expect(colTable.findAll(".v2-col-table__row")).toHaveLength(2); // 1 表头 + 1 列行
    expect(wrapper.findAll("thead th")).toHaveLength(1);
  });

  it("selects the overflowing P when its issue entry is clicked", async () => {
    const wrapper = mountDesigner();
    const schema = schemaOf(wrapper);
    const basic = gridById(schema, "ticket-layout");
    const unitRow = basic.rows.find(r => r.id === "row-unit-number")!;
    const unitLabel = unitRow.cells[0].children[0];
    if (unitLabel.type !== "text") throw new Error("unit label fixture");
    unitLabel.text = "这是一个非常长的固定文本内容，用于触发内容溢出警告";
    await nextTick();

    const issueEntry = wrapper.findAll(".v2-issue").find(entry => entry.text().includes("显示不全"));
    expect(issueEntry).toBeDefined();
    await issueEntry!.trigger("click");

    expect((wrapper.vm as unknown as { selectedNodeId: string | null }).selectedNodeId).toBe("unit-label");
    expect(wrapper.findAll(".v2-inspector-row")[0]?.text()).toContain("文本");
  });

  it("falls back to the nearest selectable Grid for a row-level issue", async () => {
    const wrapper = mountDesigner();
    const schema = schemaOf(wrapper);
    gridById(schema, "ticket-layout").rows.find(r => r.id === "row-unit-number")!.cells = [];
    await nextTick();

    const issueEntry = wrapper.findAll(".v2-issue").find(entry => entry.text().includes("至少需要一个格子"));
    expect(issueEntry).toBeDefined();
    await issueEntry!.trigger("click");

    expect((wrapper.vm as unknown as { selectedNodeId: string | null }).selectedNodeId).toBe("ticket-layout");
    expect(wrapper.findAll(".v2-inspector-row")[0]?.text()).toContain("网格");
  });

  it("falls back to the first Page for a schema-level issue without nodeId", async () => {
    const wrapper = mountDesigner();
    const schema = schemaOf(wrapper);
    schema.baseRowHeight = 0;
    await nextTick();

    const issueEntry = wrapper.findAll(".v2-issue").find(entry => entry.text().includes("基础行高"));
    expect(issueEntry).toBeDefined();
    await issueEntry!.trigger("click");

    expect((wrapper.vm as unknown as { selectedNodeId: string | null }).selectedNodeId).toBe("ticket-page-1");
    expect(wrapper.findAll(".v2-inspector-row")[0]?.text()).toContain("页面");
  });

  it("renders a structure tree and selects a node by clicking it", async () => {
    const wrapper = mountDesigner();
    const treeRows = wrapper.findAll(".v2-tree-row");
    expect(treeRows.length).toBeGreaterThan(5);

    const titleRow = treeRows.find(row => row.text().includes("云南铝业"));
    expect(titleRow).toBeDefined();
    await titleRow!.trigger("click");

    const selected = (wrapper.vm as unknown as { selectedNodeId: string | null }).selectedNodeId;
    expect(selected).toBe("title-text");
    expect(wrapper.find('[data-node-id="title-text"]').exists()).toBe(true);
  });

  it("结构树：不显示行(grid-row)，格子(grid-cell)可直接点击选中并打开其样式面板", async () => {
    const wrapper = mountDesigner();
    // 行不再进入树
    const typeBadges = wrapper.findAll(".v2-tree-type").map((el) => el.text());
    expect(typeBadges).not.toContain("grid-row");
    // 格子在树中且可点击选中（ticket-layout 首行首格标签为「格子 1-1」）
    const cellRow = wrapper
      .findAll(".v2-tree-row")
      .find((r) => r.text().includes("格子 1-1"));
    expect(cellRow).toBeDefined();
    await cellRow!.trigger("click");
    const selected = (wrapper.vm as unknown as { selectedNodeId: string | null })
      .selectedNodeId;
    expect(selected).toBeTruthy();
    // 选中格子后检查器首行显示「格子」（样式面板），且删除按钮禁用
    expect(wrapper.findAll(".v2-inspector-row")[0]?.text()).toContain("格子");
    expect(wrapper.find(".v2-tree__delete").attributes("disabled")).toBeDefined();
  });

  it("edits a cell's padding via the inspector and writes it to the schema", async () => {
    const wrapper = mountDesigner();
    const field = wrapper.find('[data-node-id="unit-field"]');
    await field.trigger("click"); // 选中字段
    await field.trigger("click"); // 循环到所属单元格

    const paddingInput = wrapper.find('input[data-cell-padding]');
    expect(paddingInput.exists()).toBe(true);

    await paddingInput.setValue("5");
    await paddingInput.trigger("change");

    const schema = schemaOf(wrapper);
    const cell = gridById(schema, "ticket-layout").rows.find(r => r.id === "row-unit-number")!.cells[1];
    expect(cell.padding).toBe(5);
  });

  it("sets a Grid-level cell default via the inspector", async () => {
    const wrapper = mountDesigner();
    await wrapper.find('[data-node-id="ticket-layout"]').trigger("click");

    const defaultPadding = wrapper.find('input[data-cell-default="padding"]');
    expect(defaultPadding.exists()).toBe(true);

    await defaultPadding.setValue("4");
    await defaultPadding.trigger("change");

    const schema = schemaOf(wrapper);
    expect(gridById(schema, "ticket-layout").cellPadding).toBe(4);
  });

  it("sets Grid cell gap (CSS gap, rows + columns) via the inspector", async () => {
    const wrapper = mountDesigner();
    await wrapper.find('[data-node-id="ticket-layout"]').trigger("click");

    const gapInput = wrapper.find('input[data-grid="gap"]');
    expect(gapInput.exists()).toBe(true);

    await gapInput.setValue("6");
    await gapInput.trigger("change");

    const schema = schemaOf(wrapper);
    expect(gridById(schema, "ticket-layout").gap).toBe(6);
  });

  it("merges and splits adjacent cells from the cell inspector", async () => {
    const wrapper = mountDesigner();
    // 选中外层 Grid 第一行第 0 格（cell-u-l），其右侧有 cell-u-f 可合并
    await wrapper.find('[data-node-id="cell-u-l"]').trigger("click");

    expect(wrapper.find('[data-cell-merge="true"]').exists()).toBe(true);
    expect(wrapper.find('[data-cell-merge="true"]').attributes("disabled")).toBeUndefined();
    // 初始无合并，拆分按钮禁用
    expect(wrapper.find('[data-cell-split="true"]').attributes("disabled")).toBeDefined();

    await wrapper.find('[data-cell-merge="true"]').trigger("click");

    // 第 0 行原为 4 格（单位标签/单位/编号标签/编号），合并前两格 → 3 格，首格 colspan 2
    const mergedGrid = gridById(schemaOf(wrapper), "ticket-layout");
    const mergedRow = mergedGrid.rows.find(r => r.id === "row-unit-number")!;
    expect(mergedRow.cells).toHaveLength(3);
    expect(mergedRow.cells[0].colspan).toBe(2);

    // 合并后可拆分
    expect(wrapper.find('[data-cell-split="true"]').attributes("disabled")).toBeUndefined();
    await wrapper.find('[data-cell-split="true"]').trigger("click");

    const splitGrid = gridById(schemaOf(wrapper), "ticket-layout");
    expect(splitGrid.rows.find(r => r.id === "row-unit-number")!.cells).toHaveLength(4);
    expect(splitGrid.rows.find(r => r.id === "row-unit-number")!.cells[0].colspan).toBeUndefined();
  });

  it("clicking a table-internal P selects the table and shows the derived-field hint", async () => {
    const wrapper = mountDesigner();

    // 普通字段（unit-field）不在表格内，选中后不显示表格提示
    await wrapper.find('[data-node-id="unit-field"]').trigger("click");
    await nextTick();
    expect(wrapper.find(".v2-hint").exists()).toBe(false);

    // 表格内的 P（wt-loc）不可单独选中，点击回退选中所属 Table
    await wrapper.find('[data-node-id="wt-loc"]').trigger("click");
    await nextTick();
    await nextTick();
    expect(wrapper.find('[data-node-id="work-task-table"]').classes()).toContain(
      "is-design-selected",
    );

    // 表格面板不含单独「字段名」控件（字段由列配置自动派生；说明文字已按用户要求移除）
    const fieldNameControl = wrapper
      .findAll(".v2-control")
      .find((c) => c.text().includes("字段名"));
    expect(fieldNameControl).toBeUndefined();
  });
});

describe("FormDesigner 把 Grid 放进 / 拖进 cell（Grid 嵌套，九续）", () => {
  it("选中某格后点击「添加 Grid」会把 Grid 嵌进该格并渲染嵌套 Grid", async () => {
    const wrapper = mountDesigner();
    // 选中位于外层 Grid 某单元格内的字段，使 insertionSlot 指向其所属 cell
    await wrapper.find('[data-node-id="unit-field"]').trigger("click");
    await nextTick();

    const located = findOwnerCellOfField(schemaOf(wrapper), "unit-field");
    expect(located).not.toBeNull();
    const cellId = located!.cell.id;
    expect(located!.cell.children.some(c => c.type === "grid")).toBe(false);

    const gridButton = wrapper
      .findAll(".v2-palette-item--button")
      .find(b => b.text().includes("网格"));
    await gridButton?.trigger("click");
    await nextTick();

    // 1. schema 层：该 cell 的子节点新增了一个 grid
    const locatedAfter = findOwnerCellOfField(schemaOf(wrapper), "unit-field");
    expect(locatedAfter!.cell.children.some(c => c.type === "grid")).toBe(true);

    // 2. 渲染层：该 cell 内出现嵌套 Grid 元素
    const ownerCellEl = wrapper.find(`[data-node-id="${cellId}"]`);
    expect(ownerCellEl.exists()).toBe(true);
    expect(ownerCellEl.find('[data-node-id^="grid-"]').exists()).toBe(true);

    // 3. 结构校验不再报错（嵌套 Grid 已纳入索引与校验）
    expect(wrapper.findAll(".v2-issue").some(i => i.text().includes("至少需要一行"))).toBe(false);
  });

  it("选中已含 Grid 的 cell 本身再添加 Grid：新 Grid 追加到同一 cell（并列），而非 page", async () => {
    const wrapper = mountDesigner();
    // 1. 先选中某格内字段，添加第一个 Grid 进该 cell
    await wrapper.find('[data-node-id="unit-field"]').trigger("click");
    await nextTick();
    const cellId = findOwnerCellOfField(schemaOf(wrapper), "unit-field")!.cell.id;
    const gridButton = wrapper
      .findAll(".v2-palette-item--button")
      .find(b => b.text().includes("网格"))!;
    await gridButton.trigger("click");
    await nextTick();

    // 该 cell 内现已有一个嵌套 Grid（树中 grid 标签已中文化为「网格」，不再显示 ID）
    expect(
      findOwnerCellOfField(schemaOf(wrapper), "unit-field")!
        .cell.children.some(c => c.type === "grid"),
    ).toBe(true);

    // 2. 在结构树里选中「该 cell 本身」（unit-field 位于 ticket-layout 首行第 2 格，标签「格子 1-2」）
    const cellRowEl = wrapper
      .findAll(".v2-tree-row")
      .find(r => r.text().includes("格子 1-2"))!.element as HTMLElement;
    expect(cellRowEl).toBeTruthy();
    cellRowEl.click();
    await nextTick();
    expect(
      (wrapper.vm as unknown as { selectedNodeId: string | null }).selectedNodeId,
    ).toBe(cellId);

    const pageChildrenBefore = schemaOf(wrapper).pages[0].children.length;

    // 3. 再点添加 Grid
    await gridButton.trigger("click");
    await nextTick();

    // 期望：同一 cell 内 grid 数变为 2（并列），page 层级 grid 数不变
    const cell = findOwnerCellOfField(schemaOf(wrapper), "unit-field")!.cell;
    const gridCount = cell.children.filter(c => c.type === "grid").length;
    expect(gridCount).toBe(2);
    expect(schemaOf(wrapper).pages[0].children.length).toBe(pageChildrenBefore);
  });

  it("预览态：点击「添加 Grid」被禁用且不改动结构", async () => {
    const wrapper = mountDesigner();
    await wrapper.find('[data-node-id="unit-field"]').trigger("click");
    await nextTick();

    const before = JSON.stringify(schemaOf(wrapper));
    await wrapper.find('[data-view-mode="preview"]').trigger("click");
    await nextTick();

    const gridButton = wrapper
      .findAll(".v2-palette-item--button")
      .find(b => b.text().includes("网格"));
    expect(gridButton?.attributes("disabled")).toBeDefined();
    await gridButton?.trigger("click");
    await nextTick();

    expect(JSON.stringify(schemaOf(wrapper))).toBe(before);
  });
});

describe("FormDesigner 拖拽重排已有节点（P9）", () => {
  /** 模拟 HTML5 DataTransfer：jsdom 未实现，自建最小实现供拖拽测试使用。 */
  class MockDataTransfer {
    private store = new Map<string, string>();
    types: string[] = [];
    effectAllowed = "";
    dropEffect = "";
    setData(type: string, value: string): void {
      this.store.set(type, value);
      this.types = Array.from(this.store.keys());
    }
    getData(type: string): string {
      return this.store.get(type) ?? "";
    }
    setDragImage(): void {}
  }

  const dispatchDrag = (
    el: Element,
    type: "dragstart" | "dragover" | "drop",
    dt: MockDataTransfer,
    opts: { altKey?: boolean; clientY?: number } = {},
  ): void => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dt });
    if (opts.altKey !== undefined)
      Object.defineProperty(event, "altKey", { value: opts.altKey });
    if (opts.clientY !== undefined)
      Object.defineProperty(event, "clientY", { value: opts.clientY });
    el.dispatchEvent(event);
  };

  const ownerCellOrder = (wrapper: VueWrapper): string[] => {
    const grid = gridById(schemaOf(wrapper), "ticket-layout");
    return grid.rows
      .find((r) => r.id === "row-owner-team")!
      .cells[0].children.map((c) => c.id);
  };

  it("拖拽把组件跨格移动到其它单元格（格内排序 / 跨格移动统一原语）", async () => {
    const wrapper = mountDesigner();
    expect(ownerCellOrder(wrapper)).toEqual([
      "owner-label",
      "owner-field",
      "team-label",
      "team-field",
    ]);

    const dt = new MockDataTransfer();
    dispatchDrag(
      wrapper.find('[data-node-id="owner-field"]').element,
      "dragstart",
      dt,
      { altKey: true },
    );
    await nextTick();
    const targetCell = wrapper.find('[data-layout-id="cell-u-f"]').element;
    dispatchDrag(targetCell, "dragover", dt, { clientY: 0 });
    await nextTick();
    dispatchDrag(targetCell, "drop", dt);
    await nextTick();

    const grid = gridById(schemaOf(wrapper), "ticket-layout");
    const ownerCell = grid.rows.find((r) => r.id === "row-owner-team")!.cells[0];
    const unitFieldCell = grid.rows.find((r) => r.id === "row-unit-number")!.cells[1];
    expect(ownerCell.children.map((c) => c.id)).not.toContain("owner-field");
    expect(unitFieldCell.children.map((c) => c.id)).toContain("owner-field");
  });

  it("同格内拖拽调整顺序（末尾落点 → 移到最后）", async () => {
    const wrapper = mountDesigner();
    expect(ownerCellOrder(wrapper)).toEqual([
      "owner-label",
      "owner-field",
      "team-label",
      "team-field",
    ]);

    const dt = new MockDataTransfer();
    dispatchDrag(
      wrapper.find('[data-node-id="owner-field"]').element,
      "dragstart",
      dt,
      { altKey: true },
    );
    await nextTick();
    const ownCell = wrapper.find('[data-layout-id="cell-o-l"]').element;
    dispatchDrag(ownCell, "dragover", dt, { clientY: 0 });
    await nextTick();
    dispatchDrag(ownCell, "drop", dt);
    await nextTick();

    expect(ownerCellOrder(wrapper)).toEqual([
      "owner-label",
      "team-label",
      "team-field",
      "owner-field",
    ]);
  });
});

describe("FormDesigner 预览态只读（不可添加组件 / 不可输入）", () => {
  const paletteButtons = (wrapper: VueWrapper) =>
    wrapper.findAll(".v2-palette-item--button");

  it("预览态：模板按钮全部禁用，字段与复合字段输入区均可编辑（<p> 渲染，非 readonly 控件）", async () => {
    const wrapper = mountDesigner();
    // 设计态基线：模板可用、字段可编辑
    expect(paletteButtons(wrapper).every(b => b.attributes("disabled") === undefined)).toBe(true);
    expect(wrapper.find('[data-node-id="unit-field"]').attributes("contenteditable")).toBe("true");

    await wrapper.find('[data-view-mode="preview"]').trigger("click");

    // 1. 不可添加组件：所有模板按钮禁用
    expect(paletteButtons(wrapper).length).toBeGreaterThan(0);
    for (const button of paletteButtons(wrapper)) {
      expect(button.attributes("disabled")).toBeDefined();
    }
    // 2. 可输入（设计师预览为交互填充态：复用同一 <p> 渲染路径，字段可编辑、值来自数据；
    //    用户输入经 DOM 遍历采集，不逐键回写响应式 data，见十续）。
    const unitField = wrapper.find('[data-node-id="unit-field"]');
    expect(unitField.attributes("contenteditable")).toBe("true");
    // 预览不再注入预置种子数据（2026-09-08）：进入预览即为空表单，字段可就地输入。
    expect(unitField.text()).toBe("");
    const memberInput = wrapper.find('[data-node-id="member-count-field"] .layout-p__input');
    expect(memberInput.exists()).toBe(true);
    expect(memberInput.attributes("contenteditable")).toBe("true");
    // 3. 模板固定文本（复合字段前/后缀「共…人」，来自 schema 而非数据）仍随模板渲染
    expect(wrapper.text()).toContain("共");
    expect(wrapper.text()).toContain("人");
  });

  it("预览态：绕过 UI 直接调用添加函数也不改动结构", async () => {
    const wrapper = mountDesigner();
    const before = JSON.stringify(schemaOf(wrapper));
    await wrapper.find('[data-view-mode="preview"]').trigger("click");

    const vm = wrapper.vm as unknown as {
      addNodeToSelectedCell: (kind: "field") => void;
      addRootGrid: () => void;
    };
    vm.addNodeToSelectedCell("field");
    vm.addRootGrid();
    await nextTick();

    expect(JSON.stringify(schemaOf(wrapper))).toBe(before);
  });

  it("再次点击同一模式按钮回到设计态", async () => {
    const wrapper = mountDesigner();
    const toggle = wrapper.find('[data-view-mode="preview"]');
    await toggle.trigger("click");
    expect(paletteButtons(wrapper)[0]?.attributes("disabled")).toBeDefined();

    await toggle.trigger("click");
    expect(paletteButtons(wrapper)[0]?.attributes("disabled")).toBeUndefined();
    expect(wrapper.find('[data-node-id="unit-field"]').attributes("contenteditable")).toBe("true");
  });
});

describe("FormDesigner 排列方向配置隐藏（text/p 分支不再暴露 writingMode）", () => {
  it("选中 text 节点时 Inspector 不再显示「排列方向」", async () => {
    const wrapper = mountDesigner();
    await wrapper.find('[data-node-id="title-text"]').trigger("click");
    // 渲染层仍按节点 style.writingMode 渲染（竖排数据不受影响），仅面板隐藏该配置
    expect(wrapper.text()).not.toContain("排列方向");
  });

  it("选中字段 P 节点时 Inspector 不再显示「排列方向」", async () => {
    const wrapper = mountDesigner();
    await wrapper.find('[data-node-id="unit-field"]').trigger("click");
    expect(wrapper.text()).not.toContain("排列方向");
  });
});

describe("FormDesigner 字段组件配置：宽度 / 默认内容 / 内部边框", () => {
  /** 取 fixture 中指定 id 的字段节点（p 节点，每次重新读取以反映最新 schema）。 */
  function fieldNodeById(schema: FormSchemaV2, id: string) {
    const owner = findOwnerCellOfField(schema, id);
    if (!owner) throw new Error(`fixture field missing: ${id}`);
    const node = owner.cell.children.find(c => c.id === id);
    if (node?.type !== "p") throw new Error(`not a field node: ${id}`);
    return node;
  }

  it("宽度：输入 mm/px/% 等自由长度字符串并写入 schema", async () => {
    const wrapper = mountDesigner();
    await wrapper.find('[data-node-id="unit-field"]').trigger("click");

    const widthInput = wrapper.find("input[data-field-width]");
    expect(widthInput.exists()).toBe(true);

    await widthInput.setValue("30mm");
    expect(fieldNodeById(schemaOf(wrapper), "unit-field").width).toBe("30mm");

    await wrapper.find("input[data-field-width]").setValue("50%");
    expect(fieldNodeById(schemaOf(wrapper), "unit-field").width).toBe("50%");

    // 清空时移除该属性（回落为不限制宽度）
    await wrapper.find("input[data-field-width]").setValue("");
    expect(fieldNodeById(schemaOf(wrapper), "unit-field").width).toBeUndefined();
  });

  it("默认内容：文本域输入并写入 schema，渲染层无 data 时回退该值", async () => {
    const wrapper = mountDesigner();
    await wrapper.find('[data-node-id="unit-field"]').trigger("click");

    const defaultInput = wrapper.find("textarea[data-field-default]");
    expect(defaultInput.exists()).toBe(true);

    await defaultInput.setValue("预设内容");
    await nextTick();

    expect(fieldNodeById(schemaOf(wrapper), "unit-field").default).toBe("预设内容");
    // 画布上该字段应渲染出默认内容
    expect(wrapper.find('[data-node-id="unit-field"]').text()).toContain("预设内容");
  });

  it("内部边框：勾选写入 innerBorder=true，取消勾选移除", async () => {
    const wrapper = mountDesigner();
    await wrapper.find('[data-node-id="unit-field"]').trigger("click");

    const checkbox = wrapper.find("input[data-field-inner-border]");
    expect(checkbox.exists()).toBe(true);
    expect(fieldNodeById(schemaOf(wrapper), "unit-field").innerBorder).toBeUndefined();

    await checkbox.setValue(true);
    expect(fieldNodeById(schemaOf(wrapper), "unit-field").innerBorder).toBe(true);
    // 渲染层同步加修饰类（设计态即可见底边框）
    expect(
      wrapper.find('[data-node-id="unit-field"]').classes(),
    ).toContain("layout-p--inner-border");

    await wrapper.find("input[data-field-inner-border]").setValue(false);
    expect(fieldNodeById(schemaOf(wrapper), "unit-field").innerBorder).toBeUndefined();
    expect(
      wrapper.find('[data-node-id="unit-field"]').classes(),
    ).not.toContain("layout-p--inner-border");
  });
});

describe("结构树 折叠全部 / 展开全部", () => {
  it("初始展开，折叠全部后所有子树收起，展开全部后恢复", async () => {
    const wrapper = mountDesigner();

    // 默认展开：结构树存在子树容器
    expect(wrapper.findAll(".v2-tree-children").length).toBeGreaterThan(0);

    const collapseBtn = wrapper
      .findAll(".v2-tree__btn")
      .find((b) => b.text() === "折叠全部");
    expect(collapseBtn).toBeDefined();
    await collapseBtn!.trigger("click");
    await nextTick();

    // 折叠全部：所有节点收起，子树容器消失
    expect(wrapper.findAll(".v2-tree-children").length).toBe(0);

    const expandBtn = wrapper
      .findAll(".v2-tree__btn")
      .find((b) => b.text() === "展开全部");
    expect(expandBtn).toBeDefined();
    await expandBtn!.trigger("click");
    await nextTick();

    // 展开全部：恢复展开
    expect(wrapper.findAll(".v2-tree-children").length).toBeGreaterThan(0);
  });

  it("折叠全部后仍可单独点击某节点展开（全局信号不锁死局部切换）", async () => {
    const wrapper = mountDesigner();
    await wrapper
      .findAll(".v2-tree__btn")
      .find((b) => b.text() === "折叠全部")!
      .trigger("click");
    await nextTick();
    expect(wrapper.findAll(".v2-tree-children").length).toBe(0);

    // 单独点击某个有子节点的行展开
    const row = wrapper
      .findAll(".v2-tree-row")
      .find((r) => r.find(".v2-tree-toggle").exists());
    expect(row).toBeDefined();
    await row!.find(".v2-tree-toggle").trigger("click");
    await nextTick();

    // 至少该节点重新展开（出现一个子树容器）
    expect(wrapper.findAll(".v2-tree-children").length).toBeGreaterThan(0);
  });
});

describe("FormDesigner 帮助面板接线", () => {
  // FormDesigner 内部常量，此处按值锁定（改名时测试会红，属预期追溯点）。
  const HELP_SEEN_STORAGE_KEY = "ticket-designer-help-seen-v1";

  it("已看过引导（localStorage 有标记）时初始不弹面板，工具栏「帮助」按钮打开、面板内 ✕ 关闭", async () => {
    localStorage.setItem(HELP_SEEN_STORAGE_KEY, "1");
    const wrapper = mountDesigner();
    expect(wrapper.find(".v2-help").exists()).toBe(false);

    const helpButton = wrapper
      .findAll(".v2-toolbar__button")
      .find((b) => b.text() === "帮助");
    expect(helpButton).toBeDefined();
    await helpButton!.trigger("click");
    expect(wrapper.find(".v2-help__panel").exists()).toBe(true);
    expect(wrapper.text()).toContain("术语速查");

    await wrapper.find(".v2-help__close").trigger("click");
    expect(wrapper.find(".v2-help").exists()).toBe(false);
  });

  it("首次使用（无已读标记）默认弹出帮助面板，✕ 关闭后落已读标记", async () => {
    localStorage.removeItem(HELP_SEEN_STORAGE_KEY);
    const wrapper = mountDesigner();
    expect(wrapper.find(".v2-help").exists()).toBe(true);

    await wrapper.find(".v2-help__close").trigger("click");
    expect(wrapper.find(".v2-help").exists()).toBe(false);
    expect(localStorage.getItem(HELP_SEEN_STORAGE_KEY)).toBe("1");

    // 已读标记生效：重新挂载不再弹出。
    const remounted = mountDesigner();
    expect(remounted.find(".v2-help").exists()).toBe(false);
  });
});
