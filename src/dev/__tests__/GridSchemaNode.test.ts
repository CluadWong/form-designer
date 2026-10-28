import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import GridSchemaNode from "@/components/renderer-v2/GridSchemaNode.vue";
import GridSchemaRenderer from "@/components/renderer-v2/GridFormRenderer.vue";
import { makeYunlvSecondTicketFirstFiveRowsSchema } from "@/dev/yunlv-second-ticket-first-five-rows";

describe("GridSchemaNode selection state", () => {
  it("renders node id and text without any selection class (kernel is pure, A5)", () => {
    const wrapper = mount(GridSchemaNode, {
      props: {
        node: { id: "label", type: "text", text: "单位" },
        baseRowHeight: 8,
      },
    });

    // 内核在 A5 重构后不再感知选中态：不再接收 selectedNodeId，也不再输出选中类。
    expect(wrapper.attributes("data-node-id")).toBe("label");
    expect(wrapper.text()).toBe("单位");
    expect(wrapper.classes()).not.toContain("layout-node--selected");
  });

  it("keeps field P empty while preserving data-field", () => {
    const wrapper = mount(GridSchemaNode, {
      props: {
        node: { id: "field", type: "p", mode: "field", field: "单位" },
        baseRowHeight: 8,
      },
    });

    expect(wrapper.text()).toBe("");
    expect(wrapper.attributes("data-field")).toBe("单位");
  });

  it("renders a field P with optional prefix and suffix labels", () => {
    const wrapper = mount(GridSchemaNode, {
      props: {
        node: {
          id: "member-count",
          type: "p",
          mode: "field",
          field: "工作班成员人数",
          prefix: "共",
          suffix: "人",
        },
        baseRowHeight: 8,
      },
    });

    expect(wrapper.text()).toBe("共人");
    expect(wrapper.attributes("data-field")).toBe("工作班成员人数");
    expect(wrapper.find(".layout-p__input").text()).toBe("");
    expect(wrapper.find(".layout-p__input").attributes("data-field")).toBe("工作班成员人数");
    expect(wrapper.find(".layout-p__input").classes()).toContain("layout-p--underline");
  });

  it("renders the Yunlv sample schema's first five rows", () => {
    const wrapper = mount(GridSchemaRenderer, {
      props: {
        schema: makeYunlvSecondTicketFirstFiveRowsSchema(),
      },
    });

    const grids = wrapper.findAll(":scope > .grid-form-paper > .layout-grid");
    expect(grids).toHaveLength(2);

    const outer = grids[1];
    const table = outer.find("table");
    expect(table.exists()).toBe(true);
    expect(outer.find("thead > tr > th").exists()).toBe(true);
    expect(outer.find("tbody > tr > td").exists()).toBe(true);
  });
});
