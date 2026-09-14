import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import GridSchemaNode from "@/components/renderer-v2/GridSchemaNode.vue";

/**
 * 字段容器「HTML 往返」结构不变式（2026-09-11）。
 *
 * 背景：字段容器原用 `<p>`，而 `innerBorder` 的逐行渲染会在其中放
 * `<div class="layout-p__line">`。`<p>` 的 HTML 内容模型只允许 phrasing content，
 * HTML 解析器遇到 `<div>` 会执行「close a p element」——强制闭合 `<p>`，
 * 把它里面的 div 与随后的兄弟节点（后标签）一起推到 `<p>` 外面，末尾还会多出空 `<p>`。
 *
 * Vue 用 DOM API 建树、不经过解析器，所以**屏幕上一直正常**；但凡走一次 HTML 往返就会炸：
 * 局部打印（vue-print-next 是 `cloneNode` → `outerHTML` → `document.write`）、
 * 导出 HTML、SSR、复制粘贴。现象即「屏幕一行、打印时前后标签各占一行」。
 *
 * 本文件把「字段容器必须能容纳块级子元素」固化成断言——容器改回 `<p>` 即失败。
 */

const compositeInnerBorder = {
  id: "member",
  type: "p" as const,
  mode: "field" as const,
  field: "工作班成员人数",
  prefix: "共",
  suffix: "人",
  underline: true,
  innerBorder: true,
  width: "10mm",
};

const plainInnerBorder = {
  id: "remark",
  type: "p" as const,
  mode: "field" as const,
  field: "备注",
  innerBorder: true,
};

const compositePlain = {
  id: "count",
  type: "p" as const,
  mode: "field" as const,
  field: "数量",
  prefix: "共",
  suffix: "件",
  underline: true,
};

/** 模拟打印插件的内容搬运：序列化成字符串后由 HTML 解析器重建。 */
function htmlRoundTrip(el: Element): HTMLElement {
  const host = document.createElement("div");
  // jsdom 底层为 parse5，与浏览器同一套 HTML 解析规则（含 <p> 的隐式闭合）。
  host.innerHTML = `<div class="grid-form-paper">${el.outerHTML}</div>`;
  return host.querySelector(".layout-p") as HTMLElement;
}

function render(node: unknown): HTMLElement {
  // 注意：GridSchemaNode 是多根模板（v-if 链），wrapper.element 会拿到注释占位，
  // 必须用 .get() 精确取字段容器。
  return mount(GridSchemaNode, {
    props: { node: node as never, baseRowHeight: 8, data: {} },
  }).get(".layout-p").element as HTMLElement;
}

describe("字段容器 HTML 序列化往返（防 <p> 被块级子元素打断）", () => {
  it("容器不得使用 <p>：innerBorder 会插入块级 <div>，与 <p> 内容模型冲突", () => {
    expect(render(compositeInnerBorder).tagName).not.toBe("P");
    expect(render(plainInnerBorder).tagName).not.toBe("P");
  });

  it("复合字段 + innerBorder 往返后：前后标签与输入区同在一个容器内，逐行 div 未被挤出", () => {
    const original = render(compositeInnerBorder);
    expect(original.children.length).toBe(3); // 前标签 / 输入区 / 后标签

    const rebuilt = htmlRoundTrip(original);

    expect(rebuilt.children.length).toBe(3);
    const labels = rebuilt.querySelectorAll(".layout-p__label");
    expect(labels.length).toBe(2);
    expect(labels[0]?.textContent).toBe("共");
    expect(labels[1]?.textContent).toBe("人");
    const input = rebuilt.querySelector(".layout-p__input");
    expect(input).not.toBeNull();
    expect(input?.querySelector(".layout-p__line")).not.toBeNull();
    // 关键：逐行 div 必须还在输入区内，而不是被解析器甩到容器外面
    expect(rebuilt.querySelectorAll(".layout-p__line").length).toBe(
      original.querySelectorAll(".layout-p__line").length,
    );
  });

  it("非复合字段 + innerBorder 往返后：逐行 div 仍包在 .layout-p__lines 内", () => {
    const original = render(plainInnerBorder);
    const lines = original.querySelectorAll(".layout-p__line").length;
    expect(lines).toBeGreaterThan(0);

    const rebuilt = htmlRoundTrip(original);

    expect(rebuilt.querySelector(".layout-p__lines")).not.toBeNull();
    expect(rebuilt.querySelectorAll(".layout-p__line").length).toBe(lines);
    expect(rebuilt.querySelector(".layout-p__lines .layout-p__line")).not.toBeNull();
  });

  it("复合字段（无 innerBorder）往返后结构稳定（对照组）", () => {
    const rebuilt = htmlRoundTrip(render(compositePlain));

    expect(rebuilt.children.length).toBe(3);
    expect(rebuilt.querySelector(".layout-p__input")).not.toBeNull();
  });
});
