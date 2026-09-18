/**
 * 结构编辑 composable 单测（2026-09-07 批次 1 拆分）：验证编辑闸门与提交接线。
 *
 * 关注点不是每个 Inspector 字段（那仍由 FormDesigner.test.ts 经 DOM 覆盖），
 * 而是：① 非设计态一切结构编辑被闸门挡住；② 编辑动作确实落到文档并进入历史。
 */
import { describe, expect, it } from "vitest";
import { ref, type Ref } from "vue";
import { useSchemaDocument, type SchemaDocument } from "../useSchemaDocument";
import { useNodeSelection } from "../useNodeSelection";
import { useSchemaEdits } from "../useSchemaEdits";
import type { FieldPNodeV2, FormSchemaV2, GridCellV2, GridNodeV2, TableNodeV2, TextStyleV2 } from "@/types";

function setup(editable = true) {
  const editableRef = ref(editable);
  const doc = useSchemaDocument();
  const selection = useNodeSelection(doc.schema, { editable: () => editableRef.value });
  const edits = useSchemaEdits({
    document: doc,
    selection,
    editable: () => editableRef.value,
    clearSelection: selection.clearSelection,
  });
  return { editableRef, doc, selection, edits };
}

describe("useSchemaEdits", () => {
  it("非设计态：结构编辑一律不生效（统一闸门）", () => {
    const { doc, edits } = setup(false);
    const before = doc.schema.value;
    edits.addRootGrid();
    edits.addGrid();
    edits.addNodeToSelectedCell("text");
    expect(doc.schema.value).toBe(before);
    expect(doc.canUndo.value).toBe(false);
  });

  it("设计态：addRootGrid 追加根 Grid 并选中它", () => {
    const { doc, selection, edits } = setup(true);
    const before = doc.schema.value.pages[0].children.length;
    edits.addRootGrid();
    const page = doc.schema.value.pages[0];
    expect(page.children).toHaveLength(before + 1);
    const added = page.children[page.children.length - 1];
    expect(selection.selectedNodeId.value).toBe(added.id);
    expect(doc.canUndo.value).toBe(true);
  });

  it("updateSelectedNode 只作用于当前选中节点", () => {
    const { doc, selection, edits } = setup(true);
    const gridId = doc.schema.value.pages[0].children[0].id;
    selection.selectNodeById(gridId);
    expect(selection.selectedNodeId.value).toBe(gridId);
    edits.updateSelectedNode((node) =>
      node.type === "grid" ? { ...node, border: "none" } : node,
    );
    const grid = doc.schema.value.pages[0].children[0];
    expect(grid.type === "grid" && grid.border).toBe("none");
  });

  it("落点提交：节点不存在时不产生新结构", () => {
    const { doc, edits } = setup(true);
    const cellEntry = [...doc.schema.value.pages[0].children].find((n) => n.type === "grid");
    expect(cellEntry).toBeDefined();
    edits.onDropNode({ moveId: "not-exist", cellId: "not-exist", index: 0 });
    expect(doc.canUndo.value).toBe(false);
  });
});

/** 在 schema 中按 id 查找 grid-cell（用于断言落点）。 */
function findCell(doc: SchemaDocument, cellId: string): GridCellV2 {
  for (const page of doc.schema.value.pages) {
    for (const child of page.children) {
      if (child.type === "grid") {
        for (const row of child.rows) {
          for (const cell of row.cells) {
            if (cell.id === cellId) return cell;
          }
        }
      }
    }
  }
  throw new Error("cell not found: " + cellId);
}

/** 构造「单元格内有一个文本组件」的场景，并选中该文本组件。 */
function withTextInCell() {
  const ctx = setup(true);
  const { doc, selection, edits } = ctx;
  const grid = doc.schema.value.pages[0].children[0] as GridNodeV2;
  const cellId = grid.rows[0].cells[0].id;
  selection.selectNodeById(cellId);
  edits.addNodeToSelectedCell("text");
  const cell = findCell(doc, cellId);
  const textId = cell.children[0].id;
  selection.selectNodeById(textId);
  return { ...ctx, cellId, textId };
}

/** 构造「单元格内有一个字段 P」的场景，并选中该字段（供额外属性 / 触发开关测试）。 */
function withFieldInCell() {
  const ctx = setup(true);
  const { doc, selection, edits } = ctx;
  const grid = doc.schema.value.pages[0].children[0] as GridNodeV2;
  const cellId = grid.rows[0].cells[0].id;
  selection.selectNodeById(cellId);
  edits.addNodeToSelectedCell("field");
  const fieldId = findCell(doc, cellId).children[0].id;
  selection.selectNodeById(fieldId);
  return { ...ctx, cellId, fieldId };
}

/** 读取该格首个子节点（字段 P）。 */
function fieldInCell(doc: SchemaDocument, cellId: string): FieldPNodeV2 {
  return findCell(doc, cellId).children[0] as FieldPNodeV2;
}

/** 选中首个根 Grid（供 grid 级编辑动作测试）。 */
function selectGridNode() {
  const ctx = setup(true);
  const { doc, selection } = ctx;
  const gridId = (doc.schema.value.pages[0].children[0] as GridNodeV2).id;
  selection.selectNodeById(gridId);
  return { ...ctx, gridId };
}

/** 直接选中首个 grid-cell（供单元格级覆盖编辑测试）。 */
function selectFirstCell() {
  const ctx = setup(true);
  const { doc, selection } = ctx;
  const grid = doc.schema.value.pages[0].children[0] as GridNodeV2;
  const cellId = grid.rows[0].cells[0].id;
  selection.selectNodeById(cellId);
  return { ...ctx, cellId };
}

describe("useSchemaEdits 复制/剪切/粘贴/原地复制", () => {
  it("设计态：duplicateSelected 在选中组件后插入克隆并选中它", () => {
    const { doc, selection, edits, cellId } = withTextInCell();
    const before = findCell(doc, cellId).children.length;
    const original = findCell(doc, cellId).children[0] as { text?: string };
    edits.duplicateSelected();
    const cell = findCell(doc, cellId);
    expect(cell.children).toHaveLength(before + 1);
    const clones = cell.children.filter((c) => (c as { text?: string }).text === original.text);
    expect(clones).toHaveLength(2);
    // 新选中节点是原节点之后的克隆，且 id 全新
    const selId = selection.selectedNodeId.value;
    expect(selId).toBe(cell.children[1].id);
    expect(cell.children[0].id).not.toBe(selId);
    expect(doc.canUndo.value).toBe(true);
  });

  it("设计态：copySelected 不改动 schema，只写入内存缓冲", () => {
    const { doc, edits } = withTextInCell();
    const before = doc.schema.value;
    const undoBefore = doc.canUndo.value;
    edits.copySelected();
    expect(doc.schema.value).toBe(before); // 无提交
    expect(doc.canUndo.value).toBe(undoBefore); // 不产生新撤销步
  });

  it("设计态：复制后粘贴 → 插到选中组件之后（同格）", () => {
    const { doc, edits, cellId } = withTextInCell();
    edits.copySelected();
    const before = findCell(doc, cellId).children.length;
    edits.pasteClipboard();
    const cell = findCell(doc, cellId);
    expect(cell.children).toHaveLength(before + 1);
    // 粘贴产物 id 与原组件不同（深拷贝刷新）
    expect(cell.children[0].id).not.toBe(cell.children[1].id);
    expect(doc.canUndo.value).toBe(true);
  });

  it("设计态：复制后选中单元格再粘贴 → 进该格", () => {
    const { doc, selection, edits, cellId } = withTextInCell();
    edits.copySelected();
    selection.selectNodeById(cellId); // 当前选中为 grid-cell
    const before = findCell(doc, cellId).children.length;
    edits.pasteClipboard();
    expect(findCell(doc, cellId).children).toHaveLength(before + 1);
  });

  it("设计态：cut 后选中清空，粘贴回源格（兜底落点）", () => {
    const { doc, edits, cellId } = withTextInCell();
    const before = findCell(doc, cellId).children.length; // 1
    edits.cutSelected();
    expect(findCell(doc, cellId).children).toHaveLength(before - 1); // 原件被移除
    expect(doc.canUndo.value).toBe(true);
    // 此时选中已清空、无插入槽，但 clipboardSourceCellId 记录源格
    edits.pasteClipboard();
    expect(findCell(doc, cellId).children).toHaveLength(before); // 克隆回到源格
  });

  it("非设计态：复制/剪切/粘贴/原地复制 全部 no-op（统一闸门）", () => {
    const { doc, edits, editableRef } = withTextInCell();
    editableRef.value = false; // 切到预览态
    const before = doc.schema.value;
    const undoBefore = doc.canUndo.value;
    edits.copySelected();
    edits.cutSelected();
    edits.duplicateSelected();
    edits.pasteClipboard();
    expect(doc.schema.value).toBe(before);
    expect(doc.canUndo.value).toBe(undoBefore); // 无新撤销步
  });

  it("page 与 grid-cell 不可复制/剪切/原地复制（受保护节点无副作用）", () => {
    const { doc, selection, edits } = setup(true);

    // page：selectedCopiableNode 直接返回 null，三个动作均 no-op
    const pageId = doc.schema.value.pages[0].id;
    selection.selectNodeById(pageId);
    const beforePage = doc.schema.value;
    edits.copySelected();
    edits.cutSelected();
    edits.duplicateSelected();
    expect(doc.schema.value).toBe(beforePage);
    expect(doc.canUndo.value).toBe(false);

    // grid-cell：同样受保护（无独立复制语义）
    const cellId = (doc.schema.value.pages[0].children[0] as GridNodeV2).rows[0].cells[0].id;
    selection.selectNodeById(cellId);
    const beforeCell = doc.schema.value;
    edits.copySelected();
    edits.cutSelected();
    edits.duplicateSelected();
    expect(doc.schema.value).toBe(beforeCell);
    expect(doc.canUndo.value).toBe(false);
  });
});

describe("列宽解析：不得静默兜底为 24（三十七续回归）", () => {
  function selectGrid() {
    const ctx = setup(true);
    const { doc, selection, edits } = ctx;
    const gridId = (doc.schema.value.pages[0].children[0] as GridNodeV2).id;
    selection.selectNodeById(gridId);
    return { ...ctx, gridId };
  }

  function gridOf(doc: SchemaDocument): GridNodeV2 {
    const node = doc.schema.value.pages[0].children[0];
    if (node.type !== "grid") throw new Error("not a grid");
    return node;
  }

  it("空列宽输入：回到默认 1fr，绝不写入 24", () => {
    const { doc, edits } = selectGrid();
    edits.updateGridColumnWidth(0, { target: { value: "" } } as unknown as Event);
    const grid = gridOf(doc);
    expect(grid.columns?.[0]).toBe("1fr");
    expect(grid.columns?.[0]).not.toBe(24);
  });

  it("非法列宽输入（如 abc）：不提交 schema，不误写 24", () => {
    const { doc, edits } = selectGrid();
    const before = doc.schema.value;
    edits.updateGridColumnWidth(0, { target: { value: "abc" } } as unknown as Event);
    expect(doc.schema.value).toBe(before);
    expect(doc.canUndo.value).toBe(false);
  });

  it("合法列宽（1fr / 数字）：正常提交且不变成 24", () => {
    const { doc, edits } = selectGrid();
    edits.updateGridColumnWidth(0, { target: { value: "1fr" } } as unknown as Event);
    expect(gridOf(doc).columns?.[0]).toBe("1fr");
    edits.updateGridColumnWidth(0, { target: { value: "30" } } as unknown as Event);
    expect(gridOf(doc).columns?.[0]).toBe(30);
  });

  it("列宽带 mm 单位（照标签输入 30mm）：剥离后按毫米数提交", () => {
    const { doc, edits } = selectGrid();
    edits.updateGridColumnWidth(0, { target: { value: "30mm" } } as unknown as Event);
    expect(gridOf(doc).columns?.[0]).toBe(30);
    edits.updateGridColumnWidth(0, { target: { value: "20 MM" } } as unknown as Event);
    expect(gridOf(doc).columns?.[0]).toBe(20);
  });

  it("改列数后设第二列宽度：渲染真源 columns 同步（resize 不再留 stale 长度）", () => {
    const { doc, selection, edits } = selectGrid();
    edits.updateGridDimensions({
      target: { value: "2", dataset: { dimension: "columns" } },
    } as unknown as Event);
    edits.updateGridColumnWidth(1, { target: { value: "40" } } as unknown as Event);
    const grid = gridOf(doc);
    expect(grid.columns).toHaveLength(2);
    expect(grid.columns?.[1]).toBe(40);
  });
});

describe("Table 表头样式配置（表头字号/粗细/对齐）", () => {
  function selectTable() {
    const ctx = setup(true);
    const { doc, selection, edits } = ctx;
    const grid = doc.schema.value.pages[0].children[0] as GridNodeV2;
    const cellId = grid.rows[0].cells[0].id;
    selection.selectNodeById(cellId);
    edits.addNodeToSelectedCell("table");
    const cell = findCell(doc, cellId);
    const table = cell.children.find((c) => c.type === "table") as TableNodeV2;
    selection.selectNodeById(table.id);
    return { ...ctx, tableId: table.id };
  }

  function tableOf(doc: SchemaDocument): TableNodeV2 {
    const grid = doc.schema.value.pages[0].children[0] as GridNodeV2;
    const cell = findCell(doc, grid.rows[0].cells[0].id);
    return cell.children.find((c) => c.type === "table") as TableNodeV2;
  }

  it("设置表头字号：写入 headerStyle.fontSize", () => {
    const { doc, edits } = selectTable();
    edits.updateTableHeaderFontSize({ target: { value: "14" } } as unknown as Event);
    expect(tableOf(doc).headerStyle?.fontSize).toBe(14);
  });

  it("表头字号非法/空：不静默兜底，移除覆盖（undefined，不写 1）", () => {
    const { doc, edits } = selectTable();
    edits.updateTableHeaderFontSize({ target: { value: "14" } } as unknown as Event);
    expect(tableOf(doc).headerStyle?.fontSize).toBe(14);
    edits.updateTableHeaderFontSize({ target: { value: "abc" } } as unknown as Event);
    expect(tableOf(doc).headerStyle?.fontSize).toBeUndefined();
  });

  it("设置表头粗细 / 对齐：写入 headerStyle", () => {
    const { doc, edits } = selectTable();
    edits.updateTableHeaderFontWeight({ target: { value: "bold" } } as unknown as Event);
    edits.updateTableHeaderAlign({ target: { value: "center" } } as unknown as Event);
    const h = tableOf(doc).headerStyle;
    expect(h?.fontWeight).toBe("bold");
    expect(h?.align).toBe("center");
  });

  it("非 table 节点：表头样式不生效", () => {
    const { doc, selection, edits } = selectTable();
    const grid = doc.schema.value.pages[0].children[0];
    selection.selectNodeById(grid.id);
    edits.updateTableHeaderFontSize({ target: { value: "20" } } as unknown as Event);
    expect(tableOf(doc).headerStyle).toBeUndefined();
  });
});

describe("页眉 / 页脚配置（paper 级，作用于所有物理页）", () => {
  it("启用开关：写入 paper.header.enabled / paper.footer.enabled", () => {
    const { doc, edits } = setup(true);
    edits.updatePaperHeaderEnabled({ target: { checked: true } } as unknown as Event);
    edits.updatePaperFooterEnabled({ target: { checked: true } } as unknown as Event);
    expect(doc.schema.value.paper.header?.enabled).toBe(true);
    expect(doc.schema.value.paper.footer?.enabled).toBe(true);
    // 关闭是显式 false（布尔开关，不是未设）
    edits.updatePaperHeaderEnabled({ target: { checked: false } } as unknown as Event);
    expect(doc.schema.value.paper.header?.enabled).toBe(false);
  });

  it("每页重复开关：写入 paper.header/footer.repeatOnEveryPage（显式布尔）", () => {
    const { doc, edits } = setup(true);
    edits.updatePaperHeaderRepeatOnEveryPage({ target: { checked: false } } as unknown as Event);
    edits.updatePaperFooterRepeatOnEveryPage({ target: { checked: false } } as unknown as Event);
    expect(doc.schema.value.paper.header?.repeatOnEveryPage).toBe(false);
    expect(doc.schema.value.paper.footer?.repeatOnEveryPage).toBe(false);
    // 显式回写 true（未设亦等价 true，但开关回写具体值）
    edits.updatePaperHeaderRepeatOnEveryPage({ target: { checked: true } } as unknown as Event);
    expect(doc.schema.value.paper.header?.repeatOnEveryPage).toBe(true);
  });

  it("三栏文本：写入对应栏，空串移除该栏（不写空字符串）", () => {
    const { doc, edits } = setup(true);
    edits.updatePaperHeaderContent("left", { target: { value: "云铝" } } as unknown as Event);
    edits.updatePaperHeaderContent("center", { target: { value: "工作票" } } as unknown as Event);
    const content = doc.schema.value.paper.header?.content;
    expect(content?.left).toBe("云铝");
    expect(content?.center).toBe("工作票");
    expect(content?.right).toBeUndefined();
    edits.updatePaperHeaderContent("left", { target: { value: "" } } as unknown as Event);
    expect(doc.schema.value.paper.header?.content?.left).toBeUndefined();
    // 另一栏不受影响
    expect(doc.schema.value.paper.header?.content?.center).toBe("工作票");
  });

  it("带高非法/空：不静默兜底（undefined，不写 1）", () => {
    const { doc, edits } = setup(true);
    edits.updatePaperHeaderHeight({ target: { value: "12" } } as unknown as Event);
    expect(doc.schema.value.paper.header?.height).toBe(12);
    edits.updatePaperHeaderHeight({ target: { value: "abc" } } as unknown as Event);
    expect(doc.schema.value.paper.header?.height).toBeUndefined();
  });

  it("样式：字号 / 加粗 / 颜色写入 paper.header.style", () => {
    const { doc, edits } = setup(true);
    edits.updatePaperHeaderFontSize({ target: { value: "14" } } as unknown as Event);
    edits.updatePaperHeaderFontWeight({ target: { value: "bold" } } as unknown as Event);
    edits.updatePaperHeaderColor({ target: { value: "#123456" } } as unknown as Event);
    const style = doc.schema.value.paper.header?.style;
    expect(style?.fontSize).toBe(14);
    expect(style?.fontWeight).toBe("bold");
    expect(style?.color).toBe("#123456");
    // 非法字号移除覆盖
    edits.updatePaperHeaderFontSize({ target: { value: "0" } } as unknown as Event);
    expect(doc.schema.value.paper.header?.style?.fontSize).toBeUndefined();
  });

  it("页眉与页脚互不干扰，且不影响纸张尺寸/边距", () => {
    const { doc, edits } = setup(true);
    const beforeSize = doc.schema.value.paper.size;
    const beforeMargin = doc.schema.value.pages[0].margin.top;
    edits.updatePaperHeaderContent("left", { target: { value: "H" } } as unknown as Event);
    edits.updatePaperFooterContent("right", { target: { value: "F" } } as unknown as Event);
    expect(doc.schema.value.paper.header?.content?.left).toBe("H");
    expect(doc.schema.value.paper.footer?.content?.right).toBe("F");
    expect(doc.schema.value.paper.header?.content?.right).toBeUndefined();
    expect(doc.schema.value.paper.footer?.content?.left).toBeUndefined();
    expect(doc.schema.value.paper.size).toBe(beforeSize);
    expect(doc.schema.value.pages[0].margin.top).toBe(beforeMargin);
  });
});

describe("第38续回归：inspector 静默兜底清零（8 处统一改金标准）", () => {
  it("updateGridDimensions：合法正整数提交；空/非法不提交（不静默成 1）", () => {
    const { doc, edits } = selectGridNode();
    edits.updateGridDimensions({
      target: { value: "3", dataset: { dimension: "rows" } },
    } as unknown as Event);
    expect((doc.schema.value.pages[0].children[0] as GridNodeV2).rows).toHaveLength(3);
    const before = doc.schema.value;
    edits.updateGridDimensions({
      target: { value: "abc", dataset: { dimension: "rows" } },
    } as unknown as Event);
    expect(doc.schema.value).toBe(before); // 不提交，保留现状
    edits.updateGridDimensions({
      target: { value: "", dataset: { dimension: "columns" } },
    } as unknown as Event);
    expect(doc.schema.value).toBe(before);
  });

  it("updateGridCellDefault(cellPadding)：合法写值；空/非法→undefined（不静默写 0）", () => {
    const { doc, edits } = selectGridNode();
    edits.updateGridCellDefault("cellPadding", { target: { value: "5" } } as unknown as Event);
    expect((doc.schema.value.pages[0].children[0] as GridNodeV2).cellPadding).toBe(5);
    edits.updateGridCellDefault("cellPadding", { target: { value: "abc" } } as unknown as Event);
    expect(
      (doc.schema.value.pages[0].children[0] as GridNodeV2).cellPadding,
    ).toBeUndefined();
  });

  it("updateGridGap：合法写值；空/非法→undefined（不静默写 0）", () => {
    const { doc, edits } = selectGridNode();
    edits.updateGridGap({ target: { value: "6" } } as unknown as Event);
    expect((doc.schema.value.pages[0].children[0] as GridNodeV2).gap).toBe(6);
    edits.updateGridGap({ target: { value: "abc" } } as unknown as Event);
    expect((doc.schema.value.pages[0].children[0] as GridNodeV2).gap).toBeUndefined();
  });

  it("updateSelectedCellPadding：合法写值；空/非法→undefined（不静默写 0）", () => {
    const { doc, edits, cellId } = selectFirstCell();
    edits.updateSelectedCellPadding({ target: { value: "4" } } as unknown as Event);
    expect(findCell(doc, cellId).padding).toBe(4);
    edits.updateSelectedCellPadding({ target: { value: "abc" } } as unknown as Event);
    expect(findCell(doc, cellId).padding).toBeUndefined();
  });

  it("updateSelectedFontSize：合法写值；空/非法→undefined（不静默兜底成 1）", () => {
    const { doc, selection, edits } = withTextInCell();
    edits.updateSelectedFontSize({ target: { value: "14" } } as unknown as Event);
    expect((selection.selectedNode.value as { style?: TextStyleV2 }).style?.fontSize).toBe(14);
    edits.updateSelectedFontSize({ target: { value: "abc" } } as unknown as Event);
    expect(
      (selection.selectedNode.value as { style?: TextStyleV2 }).style?.fontSize,
    ).toBeUndefined();
  });

  it("updateBaseRowHeight：合法正整数提交；空/非法不提交（不静默兜底成 8）", () => {
    const { doc, edits } = setup(true);
    edits.updateBaseRowHeight({ target: { value: "12" } } as unknown as Event);
    expect(doc.schema.value.baseRowHeight).toBe(12);
    const snapshot = doc.schema.value;
    edits.updateBaseRowHeight({ target: { value: "abc" } } as unknown as Event);
    expect(doc.schema.value).toBe(snapshot); // 不提交
    expect(doc.schema.value.baseRowHeight).toBe(12); // 保留 12
  });

  it("updatePaperMarginSide：单边合法提交且不影响其他边；空/非法不提交", () => {
    const { doc, edits } = setup(true);
    edits.updatePaperMarginSide("top", { target: { value: "15" } } as unknown as Event);
    expect(doc.schema.value.pages[0].margin.top).toBe(15);
    // 其余三边保持缺省 12（不联动四边）
    expect(doc.schema.value.pages[0].margin.right).toBe(12);
    expect(doc.schema.value.pages[0].margin.bottom).toBe(12);
    expect(doc.schema.value.pages[0].margin.left).toBe(12);
    const snapshot = doc.schema.value;
    edits.updatePaperMarginSide("left", { target: { value: "abc" } } as unknown as Event);
    expect(doc.schema.value).toBe(snapshot); // 不提交，保留现状
    expect(doc.schema.value.pages[0].margin.left).toBe(12);
  });

  it("节点额外属性：新增 / 改名 / 改值 / 删除；空表回退 undefined（导出干净）", () => {
    const { doc, edits, cellId } = withFieldInCell();

    // 新增：自动取不冲突的键名（param1），值留空待填
    edits.addSelectedParam();
    expect(fieldInCell(doc, cellId).params).toEqual({ param1: "" });

    // 改名：值不动，插入顺序保持
    edits.renameSelectedParam("param1", { target: { value: "action" } } as unknown as Event);
    expect(fieldInCell(doc, cellId).params).toEqual({ action: "" });

    // 改值（逐键提交）
    edits.updateSelectedParamValue("action", {
      target: { value: "datePicker" },
    } as unknown as Event);
    expect(fieldInCell(doc, cellId).params).toEqual({ action: "datePicker" });

    // 空键 / 重名 → 不提交（记录里无法表达），保留原键与值
    const blankTarget = { value: "   " };
    edits.renameSelectedParam("action", { target: blankTarget } as unknown as Event);
    expect(fieldInCell(doc, cellId).params).toEqual({ action: "datePicker" });
    expect(blankTarget.value).toBe("action"); // 输入框视觉回退到原键

    // 删除最后一行 → params 整体回退 undefined（与 prefix / width 等「空即 undefined」一致）
    edits.removeSelectedParam("action");
    expect(fieldInCell(doc, cellId).params).toBeUndefined();
  });

  it("updateSelectedInteractive：勾选写 true，取消回退 undefined", () => {
    const { doc, edits, cellId } = withFieldInCell();
    edits.updateSelectedInteractive({ target: { checked: true } } as unknown as Event);
    expect(fieldInCell(doc, cellId).interactive).toBe(true);
    edits.updateSelectedInteractive({ target: { checked: false } } as unknown as Event);
    expect(fieldInCell(doc, cellId).interactive).toBeUndefined();
  });

  it("updateSelectedCellRowHeight：合法写值；空/非法→undefined（且不写 NaN）", () => {
    const { doc, edits, cellId } = selectFirstCell();
    edits.updateSelectedCellRowHeight({ target: { value: "20" } } as unknown as Event);
    expect(findCell(doc, cellId).rowHeight).toBe(20);
    edits.updateSelectedCellRowHeight({ target: { value: "abc" } } as unknown as Event);
    const rh = findCell(doc, cellId).rowHeight;
    expect(rh).toBeUndefined();
    expect(Number.isNaN(rh as unknown as number)).toBe(false);
  });
});
