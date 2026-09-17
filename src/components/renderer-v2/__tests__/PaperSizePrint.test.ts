import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { FormSchemaV2 } from "@/types";
import { GridFormRenderer, currentPageSizeStyle } from "@/components/renderer-v2";

/**
 * P11-3 修复：打印纸张尺寸必须跟随 `schema.paper`，而不是写死 A4。
 * 回归场景：选 A3 横向（420×297mm）时屏幕渲染正常，打印却仍按 A4 出页导致内容被裁。
 */
function makeSchema(paperSize: "A4" | "A3"): FormSchemaV2 {
  return {
    version: 2,
    paper: {
      size: paperSize,
      orientation: paperSize === "A3" ? "landscape" : "portrait",
    },
    baseRowHeight: 8,
    pages: [
      {
        id: "page-1",
        type: "page",
        mode: "fixed",
        margin: { top: 5, right: 5, bottom: 5, left: 5 },
        children: [],
      },
    ],
  };
}

/** 注：每个用例都自行 `unmount()`（模块内以引用计数管理单例 `<style>`，
 *  直接 remove DOM 会让模块缓存的引用失效）。 */
describe("打印纸张尺寸（@page 跟随 schema.paper）", () => {
  it("A4：注入 @page 210mm 297mm（纵向）", () => {
    const wrapper = mount(GridFormRenderer, { props: { schema: makeSchema("A4") } });
    expect(currentPageSizeStyle()).toContain("@page { size: 210mm 297mm; margin: 0; }");
    expect(wrapper.find(".grid-form-paper").attributes("style")).toContain("width: 210mm");
    // 打印纸张高度留 0.5mm 安全余量（297 − 0.5），避免「纸高 == 页高」取整溢出多出空白尾页。
    expect(wrapper.find(".grid-form-paper").attributes("style")).toContain("height: 296.5mm");
    wrapper.unmount();
  });

  it("A3：注入 @page 420mm 297mm（横向），与纸张元素宽高一致", () => {
    const wrapper = mount(GridFormRenderer, { props: { schema: makeSchema("A3") } });
    expect(currentPageSizeStyle()).toContain("@page { size: 420mm 297mm; margin: 0; }");
    expect(wrapper.find(".grid-form-paper").attributes("style")).toContain("width: 420mm");
    expect(wrapper.find(".grid-form-paper").attributes("style")).toContain("height: 296.5mm");
    wrapper.unmount();
  });

  it("切换纸张（A4 → A3）时 @page 同步更新，不再停留在 A4", async () => {
    const wrapper = mount(GridFormRenderer, { props: { schema: makeSchema("A4") } });
    expect(currentPageSizeStyle()).toContain("210mm 297mm");
    await wrapper.setProps({ schema: makeSchema("A3") });
    expect(currentPageSizeStyle()).toContain("@page { size: 420mm 297mm; margin: 0; }");
    wrapper.unmount();
  });

  it("全部实例卸载后移除注入的 @page 样式", () => {
    const wrapper = mount(GridFormRenderer, { props: { schema: makeSchema("A3") } });
    expect(document.getElementById("grid-form-page-size")).not.toBeNull();
    wrapper.unmount();
    expect(document.getElementById("grid-form-page-size")).toBeNull();
    expect(currentPageSizeStyle()).toBe("");
  });
});
