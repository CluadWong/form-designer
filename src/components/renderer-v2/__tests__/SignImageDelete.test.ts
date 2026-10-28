import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
// 读 SFC **源码原文**用 Vite 的 `?raw`，不引 node 内置模块——本仓 tsconfig 只含 `src/**`
// 且没装 `@types/node`，`node:fs` / `process` 会直接 TS2307 / TS2580。
import gridSchemaNodeSource from "../GridSchemaNode.vue?raw";
import type { FieldPNodeV2, FormDataV2 } from "@/types";
import { GridSchemaNode } from "@/components/renderer-v2";
import { collectFieldValues } from "@/components/renderer-v2/collectFieldValues";
import {
  resolveSignImageUrlIndexesV2,
  resolveSignImageUrlsV2,
  resolveSignPlaceholderLineCountV2,
} from "@/engine-v2/derivation";

/**
 * 签名图「删除单张」角标（2026-10-14）。
 *
 * 口径与图片列表**完全同构**（用户拍板：签名图照图片列表的口径改造）：
 * - 内核在**图片自身的右上角**渲染角标，悬停浮现，点击 `emit("sign-remove")`；
 * - 内核**只发事件、不改 `data`**——删除后的值怎么写回是宿主的业务规则；
 * - 入口条件 = 非设计态 + 非只读 + 字段权限非 `READ`·`HIDDEN`。
 *
 * 与图片列表的**唯一差异是载荷形态**：签名值域是 `string[]`（只有地址，没有 name / 宽高），
 * 故 `item` 是地址字符串。另有一处必须锁死的正确性细节——**`index` 是值数组下标，不是渲染下标**：
 * `resolveSignImageUrlsV2` 会剔除空项，`["", "a"]` 里 `"a"` 渲染为第 0 张、值下标却是 1，
 * 直传渲染下标会让宿主删错人。
 */
const A = "a.png";
const B = "b.png";
const C = "c.png";

function signNode(overrides: Partial<FieldPNodeV2> = {}): FieldPNodeV2 {
  return {
    id: "sign-1",
    type: "p",
    mode: "field",
    field: "签名",
    prefix: "负责人签名：",
    valueType: "image",
    ...overrides,
  };
}

interface RenderOptions {
  data?: Record<string, unknown> | null;
  mode?: "design" | "preview";
  readonly?: boolean;
  fieldPermissions?: Record<string, "READ" | "EDIT" | "HIDDEN">;
}

function render(node: FieldPNodeV2, options: RenderOptions = {}) {
  const data = options.data === undefined ? { 签名: [A, B, C] } : options.data;
  return mount(GridSchemaNode, {
    props: {
      node,
      data: data as FormDataV2,
      baseRowHeight: 8,
      mode: options.mode ?? "preview",
      readonly: options.readonly ?? false,
      fieldPermissions: options.fieldPermissions,
    },
  });
}

describe("签名图删除角标：入口条件", () => {
  it("预览态 + 非只读 + 有字段：每张签名图一个角标，数量与图一一对应", () => {
    const wrapper = render(signNode());
    expect(wrapper.findAll("img.layout-p__sign")).toHaveLength(3);
    expect(wrapper.findAll(".layout-p__sign-del")).toHaveLength(3);
    wrapper.unmount();
  });

  it("角标与 <img> 同处一个 .layout-p__signcell（角标贴的是图片自身的右上角）", () => {
    const wrapper = render(signNode());
    const cells = wrapper.findAll(".layout-p__signcell");
    expect(cells).toHaveLength(3);
    cells.forEach((cell) => {
      expect(cell.find(":scope > img.layout-p__sign").exists()).toBe(true);
      expect(cell.find(":scope > .layout-p__sign-del").exists()).toBe(true);
    });
    // 图片本身仍是同一个类名（采集 / 手势排除 / 既有选择器都不受影响）
    expect(wrapper.findAll(".layout-p__signs > .layout-p__signcell")).toHaveLength(3);
    wrapper.unmount();
  });

  it("只读：不给删除入口（回显 / 打印态）", () => {
    const wrapper = render(signNode(), { readonly: true });
    expect(wrapper.findAll("img.layout-p__sign")).toHaveLength(3);
    expect(wrapper.findAll(".layout-p__sign-del")).toHaveLength(0);
    wrapper.unmount();
  });

  it("设计态：不给删除入口（设计态在编辑模板，没有可删的数据）", () => {
    const wrapper = render(signNode(), { mode: "design" });
    expect(wrapper.findAll(".layout-p__sign-del")).toHaveLength(0);
    wrapper.unmount();
  });

  it("字段权限 READ / HIDDEN：不给删除入口；EDIT / 未配置：给", () => {
    const read = render(signNode(), { fieldPermissions: { 签名: "READ" } });
    expect(read.findAll("img.layout-p__sign")).toHaveLength(3);
    expect(read.findAll(".layout-p__sign-del")).toHaveLength(0);
    read.unmount();

    // HIDDEN 已整栏走 ***（连图都不渲染），角标自然也不该出现
    const hidden = render(signNode(), { fieldPermissions: { 签名: "HIDDEN" } });
    expect(hidden.findAll("img.layout-p__sign")).toHaveLength(0);
    expect(hidden.findAll(".layout-p__sign-del")).toHaveLength(0);
    hidden.unmount();

    const edit = render(signNode(), { fieldPermissions: { 签名: "EDIT" } });
    expect(edit.findAll(".layout-p__sign-del")).toHaveLength(3);
    edit.unmount();

    const unset = render(signNode(), { fieldPermissions: {} });
    expect(unset.findAll(".layout-p__sign-del")).toHaveLength(3);
    unset.unmount();
  });

  it("非签名字段：不渲染角标（普通文本字段）", () => {
    const text = render(signNode({ valueType: undefined }), { data: { 签名: "手写文本" } });
    expect(text.findAll(".layout-p__sign-del")).toHaveLength(0);
    text.unmount();
  });

  it("没有 field（只有节点级 default 的图）：图照常渲染，但没有可删的数据 ⇒ 无角标", () => {
    // 与图片列表「静态图节点不给入口」同一条理由：删的是**数据**，不是模板配置。
    const wrapper = render(signNode({ field: "", default: A }), { data: {} });
    expect(wrapper.findAll("img.layout-p__sign")).toHaveLength(1);
    expect(wrapper.findAll(".layout-p__sign-del")).toHaveLength(0);
    wrapper.unmount();
  });

  it("空值：无图即无角标（空态走 .layout-p__value，下划线照常显示）", () => {
    const wrapper = render(signNode(), { data: { 签名: [] } });
    expect(wrapper.findAll(".layout-p__sign-del")).toHaveLength(0);
    expect(wrapper.find(".layout-p__input").classes()).toContain("layout-p--underline");
    wrapper.unmount();
  });

  it("单张：不进 .layout-p__signs 容器，角标在 --inline 单元里", () => {
    const wrapper = render(signNode({ prefix: undefined }), { data: { 签名: A } });
    expect(wrapper.findAll(".layout-p__signs")).toHaveLength(0);
    const cell = wrapper.find(".layout-p__signcell--inline");
    expect(cell.exists()).toBe(true);
    expect(cell.find(":scope > .layout-p__sign-del").exists()).toBe(true);
    wrapper.unmount();
  });
});

describe("签名图删除角标：事件载荷", () => {
  it("点击第 index 张的角标 → emit sign-remove，载荷带 nodeId / field / index / item", async () => {
    const wrapper = render(signNode());
    await wrapper.findAll(".layout-p__sign-del")[1].trigger("click");

    const events = wrapper.emitted("sign-remove");
    expect(events).toHaveLength(1);
    expect(events![0][0]).toEqual({
      nodeId: "sign-1",
      field: "签名",
      index: 1,
      item: B,
    });
    wrapper.unmount();
  });

  it("点哪个删哪个：第 0 / 2 张各自对应自己的下标与地址", async () => {
    const wrapper = render(signNode());
    const badges = wrapper.findAll(".layout-p__sign-del");
    await badges[0].trigger("click");
    await badges[2].trigger("click");

    const payloads = wrapper
      .emitted("sign-remove")!
      .map((args) => args[0] as Record<string, unknown>);
    expect(payloads.map((p) => p.index)).toEqual([0, 2]);
    expect(payloads.map((p) => p.item)).toEqual([A, C]);
    wrapper.unmount();
  });

  it("index 是**值数组下标**：值里有空项时，渲染第 0 张对应值下标 1", async () => {
    // resolveSignImageUrlsV2 剔除空串 ⇒ 渲染下标与值下标错位，这是最容易删错人的地方。
    const wrapper = render(signNode(), { data: { 签名: ["", A, B] } });
    const badges = wrapper.findAll(".layout-p__sign-del");
    expect(badges).toHaveLength(2);

    await badges[0].trigger("click");
    await badges[1].trigger("click");

    const payloads = wrapper
      .emitted("sign-remove")!
      .map((args) => args[0] as Record<string, unknown>);
    expect(payloads.map((p) => p.index)).toEqual([1, 2]);
    expect(payloads.map((p) => p.item)).toEqual([A, B]);
    wrapper.unmount();
  });

  it("值本身是单个字符串（单值简写）：index 恒为 0", async () => {
    const wrapper = render(signNode(), { data: { 签名: A } });
    await wrapper.find(".layout-p__sign-del").trigger("click");
    expect(wrapper.emitted("sign-remove")![0][0]).toMatchObject({ index: 0, item: A });
    wrapper.unmount();
  });

  it("maxCount 只从尾部截断：被截掉的项没有角标，保留下来的下标不变", async () => {
    const wrapper = render(signNode({ maxCount: 2 }));
    const badges = wrapper.findAll(".layout-p__sign-del");
    expect(badges).toHaveLength(2);

    await badges[1].trigger("click");
    expect(wrapper.emitted("sign-remove")![0][0]).toMatchObject({ index: 1, item: B });
    wrapper.unmount();
  });

  it("内核不改数据：点击后节点的 data 原样不动，删除是宿主的事", async () => {
    const wrapper = render(signNode());
    await wrapper.find(".layout-p__sign-del").trigger("click");
    expect(wrapper.props("data")).toEqual({ 签名: [A, B, C] });
    wrapper.unmount();
  });

  it("只读 / 无角标时：dispatch 点击也不可能发出事件（防回归）", async () => {
    const wrapper = render(signNode(), { readonly: true });
    expect(wrapper.findAll(".layout-p__sign-del")).toHaveLength(0);
    expect(wrapper.emitted("sign-remove")).toBeUndefined();
    wrapper.unmount();
  });
});

describe("签名图删除角标：不污染采集 / 不冒泡", () => {
  it("角标不被 collectFieldValues 采进字段值（不带 data-field）", () => {
    const wrapper = render(signNode());
    expect(collectFieldValues(wrapper.element as HTMLElement).签名).toEqual([A, B, C]);
    wrapper.unmount();
  });

  it("单元盒不改变采集结果（复合字段：容器与可输入区两条路径同值）", () => {
    const wrapper = render(signNode({ prefix: "负责人签名：" }));
    expect(collectFieldValues(wrapper.element as HTMLElement).签名).toEqual([A, B, C]);
    wrapper.unmount();
  });

  it("click.stop：点击角标不会冒泡给根上的委托（宿主 onFormClick 一类）", async () => {
    const wrapper = render(signNode());
    let rootClicks = 0;
    (wrapper.element as HTMLElement).addEventListener("click", () => {
      rootClicks += 1;
    });

    await wrapper.find(".layout-p__sign-del").trigger("click");

    expect(rootClicks).toBe(0);
    expect(wrapper.emitted("sign-remove")).toHaveLength(1);
    wrapper.unmount();
  });
});

describe("签名图删除角标：样式契约（角标不得进票面）", () => {
  // 源码原文由 `?raw` 导入（scoped `<style>` 不会注入 jsdom，故「悬停浮现 / 打印隐藏」
  // 这两条只能锁源码文本）。
  const source = gridSchemaNodeSource;

  it("绝对定位在图片右上角，且单元盒是定位容器、收缩到图片尺寸", () => {
    const del = source.match(/\.layout-p__sign-del \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(del).toContain("position: absolute");
    expect(del).toMatch(/top: 0;/);
    expect(del).toMatch(/right: 0;/);

    const cell = source.match(/\.layout-p__signcell \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(cell).toContain("position: relative");
    expect(cell).toContain("display: inline-flex");
    expect(cell).toContain("max-width: 100%");
  });

  it("悬停才浮现（visibility 而非 display，保留盒模型可量）", () => {
    expect(source).toMatch(/\.layout-p__sign-del \{[\s\S]*?visibility: hidden;/);
    expect(source).toMatch(
      /\.layout-p__signcell:hover \.layout-p__sign-del \{[\s\S]*?visibility: visible;/,
    );
  });

  it("打印隐藏：@media print 下角标一律不输出（与图片列表角标同一条规则）", () => {
    expect(source).toMatch(
      /@media print \{[\s\S]*?\.layout-p__sign-del \{\s*display: none !important;/,
    );
  });

  it("单元盒承担贴底对齐（--inline 变体），并排时不参与伸缩", () => {
    expect(source).toMatch(
      /\.layout-p__signcell--inline,\s*\n\.layout-p__sign--inline \{\s*align-self: flex-end;/,
    );
    expect(source).toMatch(/\.layout-p__signs > \.layout-p__signcell \{\s*flex: 0 0 auto;/);
  });
});

describe("签名图值下标解析器（删除事件的正确性根基）", () => {
  it("与地址列表同序等长，回写的是原始数组下标", () => {
    expect(resolveSignImageUrlsV2(["", A, B], undefined)).toEqual([A, B]);
    expect(resolveSignImageUrlIndexesV2(["", A, B], undefined)).toEqual([1, 2]);
  });

  it("单值简写 / 空值 / maxCount 与地址口径完全一致", () => {
    expect(resolveSignImageUrlIndexesV2(A, undefined)).toEqual([0]);
    expect(resolveSignImageUrlIndexesV2("", undefined)).toEqual([]);
    expect(resolveSignImageUrlIndexesV2(null, undefined)).toEqual([]);
    expect(resolveSignImageUrlIndexesV2([A, B, C], 2)).toEqual([0, 1]);
    expect(resolveSignImageUrlIndexesV2([A, B, C], 2)).toHaveLength(
      resolveSignImageUrlsV2([A, B, C], 2).length,
    );
  });

  /**
   * 纯空白值不再当图片地址（2026-10-21）。
   *
   * 起因：图片值字段 `default: "\n"`（想表达「签名栏占两行」）被判成**一张图地址** →
   * 渲染 `<img src="\n">` 变缺省图，内部边框的多行下划线也永远轮不到。
   * 判定改用 `trim()`，但**只用于判空、不改写地址原文**（首尾空白照旧保留给浏览器处理）。
   */
  it("纯空白值（空格 / 换行）视为空态，不当图片地址", () => {
    expect(resolveSignImageUrlsV2("\n", undefined)).toEqual([]);
    expect(resolveSignImageUrlsV2("   ", undefined)).toEqual([]);
    expect(resolveSignImageUrlsV2(["\n", "  ", A], undefined)).toEqual([A]);
    // 下标仍是原始数组下标：空项被剔掉不影响「给宿主的回写下标」
    expect(resolveSignImageUrlIndexesV2(["\n", "  ", A], undefined)).toEqual([2]);
  });

  it("地址原文不做 trim，首尾空白照旧输出", () => {
    expect(resolveSignImageUrlsV2(` ${A} `, undefined)).toEqual([` ${A} `]);
  });
});

describe("签名栏占位行数（内部边框的线与图共存）", () => {
  it("按 default 的换行数决定行数，至少 1 行", () => {
    expect(resolveSignPlaceholderLineCountV2(undefined)).toBe(1);
    expect(resolveSignPlaceholderLineCountV2("")).toBe(1);
    expect(resolveSignPlaceholderLineCountV2("\n")).toBe(2);
    expect(resolveSignPlaceholderLineCountV2("\n\n")).toBe(3);
    expect(resolveSignPlaceholderLineCountV2("a\nb\nc")).toBe(3);
  });

  it("default 是图片地址时仍算 1 行（地址不参与行数）", () => {
    expect(resolveSignPlaceholderLineCountV2(A)).toBe(1);
  });
});
