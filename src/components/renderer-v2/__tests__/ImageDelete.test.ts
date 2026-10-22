import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
// 读 SFC **源码原文**用 Vite 的 `?raw`，不引 node 内置模块——本仓 tsconfig 只含 `src/**`
// 且没装 `@types/node`，`node:fs` / `process` 会直接 TS2307 / TS2580。
import gridSchemaNodeSource from "../GridSchemaNode.vue?raw";
import type { FormDataV2, ImageNodeV2 } from "@/types";
import { GridSchemaNode } from "@/components/renderer-v2";
import { collectFieldValues } from "@/components/renderer-v2/collectFieldValues";

/**
 * 图片列表「删除单张」角标（2026-10-14）。
 *
 * 口径（用户拍板）：**内核只渲染角标 + 发事件，删除业务归宿主**——图片列表的删除往往还要走
 * 宿主的鉴权 / 留痕 / 提交接口，内核不该替宿主改 `data`。
 *
 * 入口条件 = 有 `field`（静态图无数据可删）+ 非设计态 + 非只读 + 字段权限非 `READ`·`HIDDEN`。
 * 这组用例锁的就是这个入口条件与载荷形状，外加「角标不污染采集 / 不冒泡」两条负向约束。
 */
function imageNode(overrides: Partial<ImageNodeV2> = {}): ImageNodeV2 {
  return {
    id: "img-1",
    type: "image",
    layout: "vertical",
    field: "photos",
    images: [{ src: "t.png" }],
    ...overrides,
  } as ImageNodeV2;
}

interface RenderOptions {
  data?: Record<string, unknown> | null;
  mode?: "design" | "preview";
  readonly?: boolean;
  fieldPermissions?: Record<string, "READ" | "EDIT" | "HIDDEN">;
}

function render(node: ImageNodeV2, options: RenderOptions = {}) {
  const data = options.data === undefined
    ? { photos: ["a.png", "b.png", "c.png"] }
    : options.data;
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

describe("图片列表删除角标：入口条件", () => {
  it("预览态 + 非只读 + 有字段：每张图一个角标，数量与条目一一对应", () => {
    const wrapper = render(imageNode());
    expect(wrapper.findAll(".layout-image__item")).toHaveLength(3);
    expect(wrapper.findAll(".layout-image__del")).toHaveLength(3);
    wrapper.unmount();
  });

  it("只读：不给删除入口（回显 / 打印态）", () => {
    const wrapper = render(imageNode(), { readonly: true });
    expect(wrapper.findAll(".layout-image__item")).toHaveLength(3);
    expect(wrapper.findAll(".layout-image__del")).toHaveLength(0);
    wrapper.unmount();
  });

  it("设计态：不给删除入口（设计态删的是配置，由 inspector 负责）", () => {
    const wrapper = render(imageNode(), { mode: "design" });
    expect(wrapper.findAll(".layout-image__del")).toHaveLength(0);
    wrapper.unmount();
  });

  it("字段权限 READ / HIDDEN：不给删除入口；EDIT / 未配置：给", () => {
    const read = render(imageNode(), { fieldPermissions: { photos: "READ" } });
    expect(read.findAll(".layout-image__del")).toHaveLength(0);
    read.unmount();

    // 图片节点当前不消费 fieldPermissions 做脱敏，图片本身照常渲染——角标必须自己把门。
    const hidden = render(imageNode(), { fieldPermissions: { photos: "HIDDEN" } });
    expect(hidden.findAll(".layout-image__item")).toHaveLength(3);
    expect(hidden.findAll(".layout-image__del")).toHaveLength(0);
    hidden.unmount();

    const edit = render(imageNode(), { fieldPermissions: { photos: "EDIT" } });
    expect(edit.findAll(".layout-image__del")).toHaveLength(3);
    edit.unmount();

    const unset = render(imageNode(), { fieldPermissions: {} });
    expect(unset.findAll(".layout-image__del")).toHaveLength(3);
    unset.unmount();
  });

  it("无字段（静态图节点）：不渲染角标——没有可删的数据，只有模板配置", () => {
    const wrapper = render(imageNode({ field: undefined }), { data: null });
    expect(wrapper.findAll(".layout-image__item")).toHaveLength(1);
    expect(wrapper.findAll(".layout-image__del")).toHaveLength(0);
    wrapper.unmount();
  });
});

describe("图片列表删除角标：事件载荷", () => {
  it("点击第 index 张的角标 → emit image-remove，载荷带 nodeId / field / index / item", async () => {
    const wrapper = render(imageNode());
    await wrapper.findAll(".layout-image__del")[1].trigger("click");

    const events = wrapper.emitted("image-remove");
    expect(events).toHaveLength(1);
    expect(events![0][0]).toMatchObject({ nodeId: "img-1", field: "photos", index: 1 });
    // item 取**显式条目**（不含节点级默认宽高），与 data[field][index] 同一份
    expect((events![0][0] as { item: unknown }).item).toEqual({ src: "b.png" });
    wrapper.unmount();
  });

  it("点哪个删哪个：第 0 / 2 张各自对应自己的下标与地址", async () => {
    const wrapper = render(imageNode());
    const badges = wrapper.findAll(".layout-image__del");
    await badges[0].trigger("click");
    await badges[2].trigger("click");

    const payloads = wrapper.emitted("image-remove")!.map((args) => args[0] as Record<string, unknown>);
    expect(payloads.map((p) => p.index)).toEqual([0, 2]);
    expect(payloads.map((p) => (p.item as { src: string }).src)).toEqual(["a.png", "c.png"]);
    wrapper.unmount();
  });

  it("内核不改数据：点击后节点的 data 原样不动，删除是宿主的事", async () => {
    const wrapper = render(imageNode());
    await wrapper.find(".layout-image__del").trigger("click");
    expect(wrapper.props("data")).toEqual({ photos: ["a.png", "b.png", "c.png"] });
    wrapper.unmount();
  });
});

describe("图片列表删除角标：不污染采集 / 不冒泡", () => {
  it("角标不被 collectFieldValues 采进字段值（不带 data-field）", () => {
    const wrapper = render(imageNode());
    expect(collectFieldValues(wrapper.element as HTMLElement).photos).toEqual([
      { src: "a.png" },
      { src: "b.png" },
      { src: "c.png" },
    ]);
    wrapper.unmount();
  });

  it("click.stop：点击角标不会冒泡给根上的委托（宿主 onFormClick 一类）", async () => {
    const wrapper = render(imageNode());
    let rootClicks = 0;
    (wrapper.element as HTMLElement).addEventListener("click", () => { rootClicks += 1; });

    await wrapper.find(".layout-image__del").trigger("click");

    expect(rootClicks).toBe(0);
    expect(wrapper.emitted("image-remove")).toHaveLength(1);
    wrapper.unmount();
  });
});

describe("图片列表删除角标：样式契约（角标不得进票面）", () => {
  // 源码原文由 `?raw` 导入（scoped `<style>` 不会注入 jsdom，故「悬停浮现 / 打印隐藏」
  // 这两条只能锁源码文本）。
  const source = gridSchemaNodeSource;

  it("绝对定位在条目右上角，且条目的是定位容器", () => {
    const block = source.match(/\.layout-image__del \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(block).toContain("position: absolute");
    expect(block).toMatch(/top: 0;/);
    expect(block).toMatch(/right: 0;/);
    expect(source).toMatch(/\.layout-image__item \{[\s\S]*?position: relative;/);
  });

  it("悬停才浮现（visibility 而非 display，保留盒模型可量）", () => {
    expect(source).toMatch(/\.layout-image__del \{[\s\S]*?visibility: hidden;/);
    expect(source).toMatch(/\.layout-image__item:hover \.layout-image__del \{[\s\S]*?visibility: visible;/);
  });

  it("打印隐藏：@media print 下角标一律不输出", () => {
    expect(source).toMatch(/@media print \{[\s\S]*?\.layout-image__del \{\s*display: none !important;/);
  });
});
