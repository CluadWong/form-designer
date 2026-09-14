import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import GridSchemaNode from "@/components/renderer-v2/GridSchemaNode.vue";

const fieldNode = {
  id: "unit",
  type: "p" as const,
  mode: "field" as const,
  field: "单位",
  underline: true,
};

const compositeNode = {
  id: "member",
  type: "p" as const,
  mode: "field" as const,
  field: "工作班成员人数",
  prefix: "共",
  suffix: "人",
  underline: true,
};

describe("GridSchemaNode 填写态数据回写（P9.1b / G15 / 十续）", () => {
  it("填写态下字段 P 渲染为可编辑 <div>（非 textarea），失焦 emit field-change", async () => {
    const wrapper = mount(GridSchemaNode, {
      props: { node: fieldNode, baseRowHeight: 8, data: { 单位: "初始" } },
    });

    // 渲染为 <div>（非 textarea），值落在文本中，contenteditable 可编辑
    expect(wrapper.element.tagName).toBe("DIV");
    expect(wrapper.attributes("contenteditable")).toBe("true");
    expect(wrapper.text()).toContain("初始");

    wrapper.element.textContent = "张三";
    await wrapper.trigger("blur");

    const ev = wrapper.emitted("field-change");
    expect(ev).toBeTruthy();
    expect(ev?.[0]).toEqual(["单位", "张三"]);
  });

  it("复合字段 P 的填写态输入区为可编辑 <div> 内的 .layout-p__input，失焦 emit，前缀/后缀不参与", async () => {
    const wrapper = mount(GridSchemaNode, {
      props: { node: compositeNode, baseRowHeight: 8, data: { 工作班成员人数: "" } },
    });

    expect(wrapper.element.tagName).toBe("DIV");
    const input = wrapper.find(".layout-p__input");
    expect(input.exists()).toBe(true);
    expect(input.attributes("contenteditable")).toBe("true");
    // 初始值
    expect(input.text()).toBe("");
    input.element.textContent = "8";
    await input.trigger("blur");

    const ev = wrapper.emitted("field-change");
    expect(ev).toBeTruthy();
    expect(ev?.[0]).toEqual(["工作班成员人数", "8"]);
    // 前缀/后缀为静态标签，不参与字段
    expect(wrapper.text()).toContain("共");
    expect(wrapper.text()).toContain("人");
  });

  it("文本字段填写态渲染为 <div> 文本（非 textarea / input 控件）", async () => {
    const wrapper = mount(GridSchemaNode, {
      props: {
        node: { id: "single", type: "p" as const, mode: "field" as const, field: "编号" },
        baseRowHeight: 8,
        data: { 编号: "A1" },
      },
    });

    expect(wrapper.find("textarea").exists()).toBe(false);
    expect(wrapper.find("input").exists()).toBe(false);
    expect(wrapper.find('[data-field="编号"]').text()).toBe("A1");
  });

  it("设计态（无 data）输入不 emit，避免污染填写数据", async () => {
    const wrapper = mount(GridSchemaNode, {
      props: { node: fieldNode, baseRowHeight: 8 },
    });

    // 设计态 <div> 可编辑（contenteditable），但非 fillMode → 不回写
    expect(wrapper.attributes("contenteditable")).toBe("true");
    wrapper.element.textContent = "设计态文本";
    await wrapper.trigger("blur");

    expect(wrapper.emitted("field-change")).toBeFalsy();
  });

  it("只读预览（data + readonly）：带数据渲染为 <div> 文本，不可编辑且不 emit", async () => {
    const wrapper = mount(GridSchemaNode, {
      props: { node: fieldNode, baseRowHeight: 8, data: { 单位: "云鹿检修班" }, readonly: true },
    });

    // 预览复用同一 <div> 渲染路径，值落在文本（而非 textarea.value）；readonly 不可编辑
    expect(wrapper.element.tagName).toBe("DIV");
    expect(wrapper.attributes("contenteditable")).toBeUndefined();
    expect(wrapper.text()).toContain("云鹿检修班");

    // 只读字段无法触发回写
    wrapper.element.textContent = "篡改";
    await wrapper.trigger("blur");

    expect(wrapper.emitted("field-change")).toBeFalsy();
  });

  it("只读预览下复合字段 P 的输入区同样不可编辑", async () => {
    const wrapper = mount(GridSchemaNode, {
      props: {
        node: compositeNode,
        baseRowHeight: 8,
        data: { 工作班成员人数: "8" },
        readonly: true,
      },
    });

    // 预览复用同一 <div> / .layout-p__input 渲染路径，仅 readonly 差异（contenteditable 未设置）
    expect(wrapper.element.tagName).toBe("DIV");
    const input = wrapper.find(".layout-p__input");
    expect(input.attributes("contenteditable")).toBeUndefined();
    expect(input.text()).toBe("8");
    expect(wrapper.text()).toContain("共");
    expect(wrapper.text()).toContain("人");

    input.element.textContent = "99";
    await input.trigger("blur");
    expect(wrapper.emitted("field-change")).toBeFalsy();
  });

  it("填写态下固定文字（text 节点）不可编辑，不 emit", async () => {
    const wrapper = mount(GridSchemaNode, {
      props: {
        node: { id: "title", type: "text" as const, text: "标题" },
        baseRowHeight: 8,
        data: {},
      },
    });

    expect(wrapper.attributes("contenteditable")).toBeUndefined();
    const el = wrapper.element as HTMLElement;
    el.textContent = "篡改";
    await wrapper.trigger("input");

    expect(wrapper.emitted("field-change")).toBeFalsy();
  });
});
