import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { FormSchemaV2 } from "@/types";
import { GridFormRenderer } from "@/components/renderer-v2";

/**
 * 「页面属性 → 基础字号」在渲染层的落地方式：以 CSS 变量下发到**纸张根元素**，
 * 由 `.layout-p` / `.layout-text`（`var(--v2-base-font-size, 13px)`）与表格表头
 * （`var(--v2-table-header-font-size, 16px)`）消费。
 *
 * 为什么是变量而不是逐节点内联：纸张根上的变量会被整棵子树继承，且随打印序列化的
 * DOM 一起进 iframe —— 一处注入，正文 / 字段 / 表格内容 / 表头全部跟随。
 */
function makeSchema(baseFontSize?: number): FormSchemaV2 {
  return {
    version: 2,
    paper: { size: "A4" },
    baseRowHeight: 8,
    ...(baseFontSize === undefined ? {} : { baseFontSize }),
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

function paperStyleAttr(baseFontSize?: number): string {
  const wrapper = mount(GridFormRenderer, { props: { schema: makeSchema(baseFontSize) } });
  const style = wrapper.find(".grid-form-paper").attributes("style") ?? "";
  wrapper.unmount(); // 模块内以引用计数管理单例 <style>，用完即卸载
  return style;
}

describe("基础字号：纸张上的 CSS 变量", () => {
  it("未设基础字号：注入默认 13px 与表头 16px", () => {
    const style = paperStyleAttr();
    expect(style).toContain("--v2-base-font-size: 13px");
    expect(style).toContain("--v2-table-header-font-size: 16px");
  });

  it("基础字号 16：正文变量 16px，表头按 16/13 等比 → 20px", () => {
    const style = paperStyleAttr(16);
    expect(style).toContain("--v2-base-font-size: 16px");
    expect(style).toContain("--v2-table-header-font-size: 20px");
  });

  it("非法基础字号（0）回退默认，不会下发 0px", () => {
    const style = paperStyleAttr(0);
    expect(style).toContain("--v2-base-font-size: 13px");
    expect(style).not.toContain("--v2-base-font-size: 0px");
  });

  it("变量随 schema 变化同步更新（设计态实时生效）", async () => {
    const wrapper = mount(GridFormRenderer, { props: { schema: makeSchema() } });
    expect(wrapper.find(".grid-form-paper").attributes("style")).toContain(
      "--v2-base-font-size: 13px",
    );
    await wrapper.setProps({ schema: makeSchema(22) });
    expect(wrapper.find(".grid-form-paper").attributes("style")).toContain(
      "--v2-base-font-size: 22px",
    );
    wrapper.unmount();
  });
});
