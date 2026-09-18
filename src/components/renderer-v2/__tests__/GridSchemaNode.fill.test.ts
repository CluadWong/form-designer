import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import GridSchemaNode from "@/components/renderer-v2/GridSchemaNode.vue";
import GridFormRenderer from "@/components/renderer-v2/GridFormRenderer.vue";
import { makeYunlvSecondTicketFullSchema } from "@/dev/yunlv-second-ticket-full";

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

/**
 * 结构不变量（回归守卫）：**contenteditable 宿主内承载值的必须是元素**，不能是裸文本节点。
 *
 * 复合字段的值曾写成 `<template v-else>{{ displayValue(node) }}</template>`——`<template>`
 * 分支在 contenteditable 宿主内落成 Fragment（两侧各有一个空文本锚点），浏览器把键入文本
 * 插成**新文本节点**、Vue 只认识自己那个值节点 ⇒ 失焦写回重渲染后两者并存，显示翻倍
 * （输入 `11` 显示 `1111`）。jsdom 没有真实键入/光标，测不出「浏览器往哪插」，
 * 故此处锁的是**成因侧的结构**：值一律由元素（`.layout-p__value`）承载，
 * 宿主不得有非空裸文本子节点。真机复现/修复验证见 `%TEMP%\fd-fill-probe`。
 */
function nonEmptyDirectText(el: Element): string[] {
  return Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3 && (n.nodeValue ?? "").trim() !== "")
    .map((n) => n.nodeValue ?? "");
}

describe("contenteditable 宿主结构不变量：值必须由元素承载（防键入文本翻倍）", () => {
  it("复合字段：值落在 .layout-p__value 元素内，可输入区无裸文本子节点", () => {
    const wrapper = mount(GridSchemaNode, {
      props: { node: compositeNode, baseRowHeight: 8, data: { 工作班成员人数: "8" } },
    });

    const input = wrapper.find(".layout-p__input");
    expect(input.attributes("contenteditable")).toBe("true");
    const value = input.find(".layout-p__value");
    expect(value.exists()).toBe(true);
    expect(value.text()).toBe("8");
    expect(nonEmptyDirectText(input.element)).toEqual([]);
    expect(input.element.textContent).toBe("8");
  });

  it("复合字段：空值与「数据晚于挂载到达」同样落在元素内", async () => {
    const wrapper = mount(GridSchemaNode, {
      props: { node: compositeNode, baseRowHeight: 8, data: {} },
    });

    expect(wrapper.find(".layout-p__input .layout-p__value").exists()).toBe(true);
    await wrapper.setProps({ data: { 工作班成员人数: "12" } });
    expect(wrapper.find(".layout-p__input .layout-p__value").text()).toBe("12");
    expect(nonEmptyDirectText(wrapper.find(".layout-p__input").element)).toEqual([]);
  });

  it("填写态整票：所有 contenteditable 宿主都无裸文本子节点（值一律由元素承载）", () => {
    const wrapper = mount(GridFormRenderer, {
      props: {
        schema: makeYunlvSecondTicketFullSchema(),
        mode: "preview",
        data: {},
        readonly: false,
      },
    });

    const hosts = wrapper.findAll('[contenteditable="true"]');
    expect(hosts.length).toBeGreaterThan(0);
    const offenders = hosts
      .filter((h) => nonEmptyDirectText(h.element).length > 0)
      .map(
        (h) =>
          `${h.element.tagName}.${h.element.className} = ${JSON.stringify(nonEmptyDirectText(h.element))}`,
      );
    expect(offenders).toEqual([]);
  });
});
