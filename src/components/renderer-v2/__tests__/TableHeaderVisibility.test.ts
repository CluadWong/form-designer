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
import type { FormSchemaV2, TableNodeV2 } from "@/types";

/**
 * Table「显示表头」（`showHeader`，2026-10-23）。
 *
 * 语义：缺省 true —— 渲染标题行；`false` → 渲染层跳过整个 `<thead>`（不是把文字留白）。
 * 与续页片段的 `_paginateHideHeader` 是两个独立来源，两者都要能各自生效。
 */
function schemaWithTable(patch?: Partial<TableNodeV2>): FormSchemaV2 {
  const grid = createGridBySizeV2({ rows: 1, columns: 1, border: "all" });
  const table: TableNodeV2 = { ...createTableNodeV2(), ...patch };
  return appendNodeToCellV2(
    insertRootGridV2(createEmptyFormSchemaV2(), grid),
    grid.rows[0].cells[0].id,
    table,
  );
}

describe("Table 显示表头（showHeader）", () => {
  it("未设该属性时默认渲染表头，列数不变", () => {
    const wrapper = mount(GridFormRenderer, { props: { schema: schemaWithTable() } });
    expect(wrapper.find("table thead").exists()).toBe(true);
    expect(wrapper.findAll("thead th")).toHaveLength(2);
  });

  it("showHeader=false → 整个 thead 不渲染，数据行不受影响", () => {
    const wrapper = mount(GridFormRenderer, {
      props: { schema: schemaWithTable({ showHeader: false }) },
    });
    expect(wrapper.find("table thead").exists()).toBe(false);
    // 行数仍由 minRows 决定（新建表格默认 4 行），删掉的只有表头
    expect(wrapper.findAll("tbody tr")).toHaveLength(4);
  });

  it("showHeader=true 显式写回 → 表头照常渲染（与缺省一致）", () => {
    const wrapper = mount(GridFormRenderer, {
      props: { schema: schemaWithTable({ showHeader: true }) },
    });
    expect(wrapper.find("table thead").exists()).toBe(true);
  });

  it("续页片段隐藏（_paginateHideHeader）仍独立生效，不受 showHeader 影响", () => {
    const wrapper = mount(GridFormRenderer, {
      props: { schema: schemaWithTable({ _paginateHideHeader: true }) },
    });
    expect(wrapper.find("table thead").exists()).toBe(false);
  });
});
