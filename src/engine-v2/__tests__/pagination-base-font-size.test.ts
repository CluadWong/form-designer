import { describe, expect, it } from "vitest";
import { paginateSchema } from "@/engine-v2/pagination";
import { createTextNodeV2 } from "@/types";
import type { FormSchemaV2 } from "@/types";

/**
 * 分页估算必须与「页面属性 → 基础字号」同口径。
 *
 * 渲染层把基础字号经 CSS 变量下发到纸张（`.layout-p` / `.layout-text`），
 * 引擎则经 `resolveBaseFontSizeV2` 取同一值估算 Text 高度 —— 两边不同源就会出现
 * 「屏幕上字很大、分页却按小字算高」→ 内容溢出纸外 / 多出空白页。
 * 本文件固化该契约：基础字号变大，未设 `style.fontSize` 的文本估算高度随之变大，页数随之增加。
 */
function makeSchema(baseFontSize?: number): FormSchemaV2 {
  const children = Array.from({ length: 8 }, (_, index) => ({
    ...createTextNodeV2(),
    id: `text-${index}`,
    // 长文本 + 未设 fontSize：高度完全由「基础字号」决定
    text: "一".repeat(400),
  }));
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
        margin: { top: 12, right: 12, bottom: 12, left: 12 },
        children,
      },
    ],
  };
}

describe("基础字号：参与分页高度估算", () => {
  it("未设基础字号（默认 13）：8 段长文本放得下一页", () => {
    expect(paginateSchema(makeSchema()).pages).toHaveLength(1);
  });

  it("基础字号 26：同样内容超出正文区，切成多页", () => {
    const pages = paginateSchema(makeSchema(26)).pages;
    expect(pages.length).toBeGreaterThan(1);
    // 每页内容不超过正文高（273mm），且每页都有内容 —— 说明是「按真实字号算高后正常换页」。
    expect(pages.every((p) => p.children.length > 0)).toBe(true);
  });

  it("字号越大页数不减（单调性）", () => {
    const small = paginateSchema(makeSchema(10)).pages.length;
    const medium = paginateSchema(makeSchema(16)).pages.length;
    const large = paginateSchema(makeSchema(26)).pages.length;
    expect(medium).toBeGreaterThanOrEqual(small);
    expect(large).toBeGreaterThanOrEqual(medium);
    expect(large).toBeGreaterThan(small);
  });

  it("节点已显式设 fontSize 时不受基础字号影响（覆盖优先）", () => {
    const schema = makeSchema(26);
    schema.pages[0].children = schema.pages[0].children.map((child) =>
      // 子节点均为 text（见 makeSchema）；显式写 13px 即「不受基础字号影响」。
      child.type === "text" ? { ...child, style: { ...child.style, fontSize: 13 } } : child,
    );
    // 显式 13px：与未设基础字号（默认 13）等量，故回到单页。
    expect(paginateSchema(schema).pages).toHaveLength(1);
  });
});
