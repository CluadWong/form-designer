import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import GridSchemaNode from "@/components/renderer-v2/GridSchemaNode.vue";
import type { FieldPNodeV2 } from "@/types";

/**
 * 字段的图片值形态（`valueType === "image"`，2026-09-29）：电子签名。
 *
 * `data[field]` 是图片地址（URL / data URL），渲染为**坐落在下划线上**的 `<img>`：
 * - 空值不渲染图片、下划线照常显示（「负责人签名：____」空态占位）；
 * - 图片高度：配了 `imageHeight` 用它（同时作容器最小高度），**留空则与标签（文字行盒）
 *   等高**（`1.6em`，随纸张基础字号自适应），不再按图片固有尺寸铺开；
 * - 该形态**不参与就地输入**（值只能由宿主回填）；
 * - HIDDEN 脱敏时走文本 `***`，真实图片地址不进 DOM。
 */
const SIGN = "data:image/png;base64,iVBORw0KGgo=";

function fieldNode(overrides: Partial<FieldPNodeV2> = {}): FieldPNodeV2 {
  return {
    id: "sign-1",
    type: "p",
    mode: "field",
    field: "签名",
    prefix: "负责人签名：",
    underline: true,
    params: { action: "signature" },
    valueType: "image",
    ...overrides,
  };
}

/** 填写态挂载（预览 + 非只读，即签名字段实际生效的态）。 */
function fill(node: FieldPNodeV2, data: Record<string, string | string[]>) {
  return mount(GridSchemaNode, {
    props: { node, baseRowHeight: 8, mode: "preview", readonly: false, data },
  });
}

describe("字段图片值（电子签名）", () => {
  it("有值时渲染 <img>，src 取 data[field]，容器改底对齐以压住下划线", () => {
    const wrapper = fill(fieldNode(), { 签名: SIGN });
    const img = wrapper.find(".layout-p__sign");
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toBe(SIGN);
    // 复合字段（有前标签）的签名图放在可输入区内；容器改底对齐 → 图底边即下划线
    const box = wrapper.find(".layout-p__input");
    expect(box.classes()).toContain("layout-p__signbox");
    expect(box.classes()).toContain("layout-p--underline");
    // 前标签照常渲染
    expect(wrapper.text()).toContain("负责人签名：");
  });

  it("空值不渲染 <img>，下划线照常显示（空态占位）", () => {
    const wrapper = fill(fieldNode(), { 签名: "" });
    expect(wrapper.find(".layout-p__sign").exists()).toBe(false);
    expect(wrapper.find(".layout-p__input").classes()).toContain("layout-p--underline");
    expect(wrapper.text()).toContain("负责人签名：");
  });

  it("data 里没有该字段（未回填）同样按空态处理", () => {
    const wrapper = fill(fieldNode(), {});
    expect(wrapper.find(".layout-p__sign").exists()).toBe(false);
    expect(wrapper.find(".layout-p__input").classes()).toContain("layout-p--underline");
  });

  it("imageHeight：写进图片高度，并作为两态的容器最小高度（下划线位置不跳）", () => {
    const node = fieldNode({ imageHeight: "10mm" });
    const filled = fill(node, { 签名: SIGN });
    expect(filled.find(".layout-p__sign").attributes("style")).toContain("height: 10mm");
    expect(filled.find(".layout-p__input").attributes("style")).toContain("min-height: 10mm");
    // 空态：没有图片，但容器仍占同样的高度
    const empty = fill(node, { 签名: "" });
    expect(empty.find(".layout-p__sign").exists()).toBe(false);
    expect(empty.find(".layout-p__input").attributes("style")).toContain("min-height: 10mm");
  });

  it("imageHeight 留空：图片与标签（文字行盒）等高 —— 1.6em，不按固有尺寸铺开", () => {
    const filled = fill(fieldNode(), { 签名: SIGN });
    const style = filled.find(".layout-p__sign").attributes("style") ?? "";
    // 1.6em = `.layout-p` 的 line-height = `.layout-p__input` 的 min-height ⇒ 与标签严格等高，
    // 且随纸张「基础字号」自适应（13px → 20.8px / 5.50mm，16px → 25.6px / 6.77mm）。
    // 回归：曾留空 = 不设高度，一张 400×120 的签名图被渲染成 105.8×31.8mm，把 5.8mm 的行撑到 38.5mm。
    expect(style).toContain("height: 1.6em");
    expect(style).toContain("max-width: 100%");
    // 留空时不给容器加内联 min-height：`.layout-p__input` 自带的 1.6em 已与图片同高
    expect(filled.find(".layout-p__input").attributes("style") ?? "").not.toContain("min-height");
    // 空态不塌陷：无图但输入区仍在（占住同一行高）
    const empty = fill(fieldNode(), { 签名: "" });
    expect(empty.find(".layout-p__sign").exists()).toBe(false);
    expect(empty.find(".layout-p__input").exists()).toBe(true);
  });

  it("非复合字段（无前/后标签）：签名图作为直接子项贴底排列", () => {
    const wrapper = fill(fieldNode({ prefix: undefined }), { 签名: SIGN });
    const img = wrapper.find(".layout-p__sign");
    expect(img.exists()).toBe(true);
    expect(img.classes()).toContain("layout-p__sign--inline");
    // 下划线在字段自身（非复合字段不加 .layout-p__input）
    expect(wrapper.classes()).toContain("layout-p--underline");
    expect(wrapper.find(".layout-p__input").exists()).toBe(false);
  });

  it("复合字段只渲染一张签名图（不会同时在可输入区外重复渲染）", () => {
    const wrapper = fill(fieldNode(), { 签名: SIGN });
    expect(wrapper.findAll(".layout-p__sign")).toHaveLength(1);
  });

  it("不参与就地输入：填写态也不带 contenteditable", () => {
    const wrapper = fill(fieldNode(), { 签名: SIGN });
    expect(wrapper.attributes("contenteditable")).toBeUndefined();
    expect(wrapper.find(".layout-p__input").attributes("contenteditable")).toBeUndefined();
  });

  it("HIDDEN 脱敏：不渲染图片、改显示 ***（真实图片地址不进 DOM）", () => {
    const wrapper = mount(GridSchemaNode, {
      props: {
        node: fieldNode(),
        baseRowHeight: 8,
        mode: "preview",
        readonly: false,
        data: { 签名: SIGN },
        fieldPermissions: { 签名: "HIDDEN" },
      },
    });
    expect(wrapper.find(".layout-p__sign").exists()).toBe(false);
    expect(wrapper.html()).not.toContain("data:image");
    expect(wrapper.text()).toContain("***");
  });

  it("valueType 缺省（text）：按文本渲染，不产生 <img>（向后兼容）", () => {
    const wrapper = fill(fieldNode({ valueType: undefined }), { 签名: "手写文本" });
    expect(wrapper.find(".layout-p__sign").exists()).toBe(false);
    expect(wrapper.text()).toContain("手写文本");
  });
});

/**
 * 多人签名（2026-09-30）：`data[field]` 传**数组**即为多张——多张在同一条下划线上并排，
 * 超出可用宽度自动换行（「多人签名：___________」）。取值仍由宿主回填。
 *
 * 结构不变量：**单张与空值的 DOM 与升级前逐字节一致**（单张走原来的单 `<img>` 路径，
 * 只有 N > 1 才换成 `.layout-p__signs` 容器）。这不是洁癖——历史上独立 `v-if` 与
 * `<template v-if>` 都会留下占位注释 / Fragment 空文本锚点，把容器子元素数顶掉，
 * 破坏字段容器 HTML 往返与整票快照基线（实测 `<template v-if>` 每张多出 2 个锚点）。
 */
describe("多人签名（值传数组）", () => {
  const A = "data:image/png;base64,AAAA";
  const B = "data:image/png;base64,BBBB";
  const C = "data:image/png;base64,CCCC";

  /** 容器的子节点形态（元素名 / 节点类型），用于断言没有多出锚点节点。 */
  function shapeOf(wrapper: ReturnType<typeof fill>, selector: string): string[] {
    return Array.from(wrapper.find(selector).element.childNodes).map((n) =>
      n.nodeType === 1 ? `<${n.nodeName.toLowerCase()}>` : `#${n.nodeType}`,
    );
  }

  it("数组 → 每项一张 <img>，按数组顺序落在同一个容器内", () => {
    const wrapper = fill(fieldNode(), { 签名: [A, B, C] });
    const imgs = wrapper.findAll("img.layout-p__sign");
    expect(imgs).toHaveLength(3);
    expect(imgs.map((img) => img.attributes("src"))).toEqual([A, B, C]);
    // 只有一个容器，三张图都在它里面（同一行/同一条下划线上并排）
    expect(wrapper.findAll(".layout-p__signs")).toHaveLength(1);
    expect(wrapper.find(".layout-p__signs").findAll("img")).toHaveLength(3);
  });

  it("多图容器带间距：缺省 0.5em，可被 gap 覆盖", () => {
    expect(
      fill(fieldNode(), { 签名: [A, B] }).find(".layout-p__signs").attributes("style"),
    ).toContain("gap: 0.5em");
    expect(
      fill(fieldNode({ gap: "2mm" }), { 签名: [A, B] })
        .find(".layout-p__signs")
        .attributes("style"),
    ).toContain("gap: 2mm");
  });

  it("maxCount：超出部分不渲染", () => {
    const wrapper = fill(fieldNode({ maxCount: 2 }), { 签名: [A, B, C] });
    const imgs = wrapper.findAll("img.layout-p__sign");
    expect(imgs).toHaveLength(2);
    expect(imgs.map((img) => img.attributes("src"))).toEqual([A, B]);
  });

  it("数组里的空项被剔除（不留破图占位）", () => {
    const wrapper = fill(fieldNode(), { 签名: [A, "", B] });
    expect(wrapper.findAll("img.layout-p__sign").map((img) => img.attributes("src"))).toEqual([A, B]);
  });

  it("空数组 / 全空项：按空态处理，下划线照常显示", () => {
    const empty = fill(fieldNode(), { 签名: [] });
    expect(empty.find("img.layout-p__sign").exists()).toBe(false);
    expect(empty.find(".layout-p__input").classes()).toContain("layout-p--underline");
    expect(empty.text()).toContain("负责人签名：");
    expect(fill(fieldNode(), { 签名: ["", ""] }).find("img.layout-p__sign").exists()).toBe(false);
  });

  it("单元素数组与单个字符串渲染结果完全一致", () => {
    expect(fill(fieldNode(), { 签名: [A] }).html()).toBe(fill(fieldNode(), { 签名: A }).html());
  });

  it("单张与空值不引入额外锚点节点（容器子节点数与形态不变）", () => {
    const node = fieldNode({ prefix: undefined });
    const isEmpty = shapeOf(fill(node, { 签名: "" }), ".layout-p");
    const isSingle = shapeOf(fill(node, { 签名: A }), ".layout-p");
    // 同样的节点个数；单张时不带 .layout-p__signs 容器，图直接作为容器子项
    expect(isSingle).toHaveLength(isEmpty.length);
    expect(isSingle.filter((s) => s === "<img>")).toHaveLength(1);
    expect(isSingle.filter((s) => s !== "<img>")).toEqual(
      isEmpty.filter((s) => s !== "<span>"),
    );
    // 复合字段同理：可输入区里就是那一个 <img>，既无容器也无锚点
    expect(shapeOf(fill(fieldNode(), { 签名: A }), ".layout-p__input")).toEqual(["<img>"]);
  });

  it("多图：容器是唯一新增元素，图不在容器外重复渲染", () => {
    const node = fieldNode({ prefix: undefined });
    const multi = shapeOf(fill(node, { 签名: [A, B, C] }), ".layout-p");
    expect(multi.filter((s) => s === "<span>")).toHaveLength(1);
    expect(multi).not.toContain("<img>");
    const wrapper = fill(node, { 签名: [A, B, C] });
    expect(wrapper.find(".layout-p").findAll(":scope > img").length).toBe(0);
  });

  it("HIDDEN 脱敏：多图整栏统一 ***，不逐张遮罩、地址不进 DOM", () => {
    const wrapper = mount(GridSchemaNode, {
      props: {
        node: fieldNode(),
        baseRowHeight: 8,
        mode: "preview",
        readonly: false,
        data: { 签名: [A, B, C] },
        fieldPermissions: { 签名: "HIDDEN" },
      },
    });
    expect(wrapper.find(".layout-p__sign").exists()).toBe(false);
    expect(wrapper.find(".layout-p__signs").exists()).toBe(false);
    expect(wrapper.html()).not.toContain("data:image");
    expect(wrapper.text()).toContain("***");
  });
});
