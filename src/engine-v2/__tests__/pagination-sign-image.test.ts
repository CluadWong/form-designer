import { describe, expect, it } from "vitest";
import { paginateSchema } from "@/engine-v2/pagination";
import type { FieldPNodeV2, FormSchemaV2 } from "@/types";

/**
 * 签名图字段（`valueType: "image"`）的分页估算必须与**渲染层同口径**。
 *
 * 渲染层（`GridSchemaNode.vue`）的签名图高度 = `imageHeight`（配了就用它），
 * 否则取「与标签（文字行盒）等高」的 `1.6em` —— 后者**跟随纸张「基础字号」**，
 * 所以字号变大时签名栏跟着变高，引擎必须同样按字号换算：
 * 13px → 5.50mm、16px → 6.77mm、26px → 11.01mm。
 * 只有两边同源，才不会出现「屏幕上签名栏很高、分页却按小字算」→ 签名栏被挤到下一页。
 *
 * 注意 `Math.max(baseRowHeight, …)` 的存在：默认基准行高 8mm，故小字号下
 * 估算值被基准行高托住（等于改前的行为），**只有字号大到 1.6em > 8mm（≈19px 起）
 * 才会体现差异** —— 这是刻意保守，宁可高估也不低估。
 */

function signField(index: number, extra: Partial<FieldPNodeV2> = {}): FieldPNodeV2 {
  return {
    id: `sign-${index}`,
    type: "p",
    mode: "field",
    field: `签名${index}`,
    underline: true,
    valueType: "image",
    ...extra,
  };
}

function makeSchema(
  count: number,
  opts: {
    baseFontSize?: number;
    imageHeight?: string;
    valueType?: "image" | "text";
    maxCount?: number;
    gap?: string;
  } = {},
): FormSchemaV2 {
  const children = Array.from({ length: count }, (_, index) =>
    signField(index, {
      valueType: opts.valueType ?? "image",
      ...(opts.imageHeight === undefined ? {} : { imageHeight: opts.imageHeight }),
      ...(opts.maxCount === undefined ? {} : { maxCount: opts.maxCount }),
      ...(opts.gap === undefined ? {} : { gap: opts.gap }),
    }),
  );
  return {
    version: 2,
    paper: { size: "A4" },
    baseRowHeight: 8,
    ...(opts.baseFontSize === undefined ? {} : { baseFontSize: opts.baseFontSize }),
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

describe("签名图字段：分页按图片实际高度估算（与渲染层 1.6em 同口径）", () => {
  it("默认字号（13）：1.6em ≈ 5.5mm 不到基准行高，仍按 8mm 计 —— 32 个字段一页放得下", () => {
    // 32 × 8mm = 256mm ≤ 273mm（A4 297 − 上下边距 24）
    expect(paginateSchema(makeSchema(32)).pages).toHaveLength(1);
  });

  it("基础字号 26：1.6em ≈ 11.0mm 超过基准行高，签名栏变高后正确溢页", () => {
    // 32 × 11.01mm = 352mm > 273mm ⇒ 必须换页（改前一律按 8mm 算 → 会误判成单页）
    const pages = paginateSchema(makeSchema(32, { baseFontSize: 26 })).pages;
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.children.length > 0)).toBe(true);
  });

  it("字号越大页数不减（单调性）", () => {
    const small = paginateSchema(makeSchema(32, { baseFontSize: 13 })).pages.length;
    const medium = paginateSchema(makeSchema(32, { baseFontSize: 16 })).pages.length;
    const large = paginateSchema(makeSchema(32, { baseFontSize: 26 })).pages.length;
    // 16px → 6.77mm 仍低于 8mm 基准行高，与 13px 同页数（基准行高托底）
    expect(medium).toBeGreaterThanOrEqual(small);
    expect(large).toBeGreaterThanOrEqual(medium);
    expect(large).toBeGreaterThan(small);
  });

  it("显式 imageHeight 优先，且不随字号变化", () => {
    // 20mm 远高于基准行高 ⇒ 40 个字段必然溢页
    const pages = paginateSchema(makeSchema(40, { imageHeight: "20mm" })).pages.length;
    expect(pages).toBeGreaterThan(1);
    // 显式高度是绝对值，字号改了页数不变
    expect(paginateSchema(makeSchema(40, { imageHeight: "20mm", baseFontSize: 26 })).pages.length).toBe(
      pages,
    );
  });

  it("只作用于图片值字段：文本值字段不受基础字号影响（改动不外溢）", () => {
    const small = paginateSchema(makeSchema(32, { valueType: "text" })).pages.length;
    const large = paginateSchema(makeSchema(32, { valueType: "text", baseFontSize: 26 })).pages.length;
    expect(large).toBe(small);
    expect(small).toBe(1);
  });
});

/**
 * 多人签名（2026-09-30）：`data[field]` 传数组即多张，多张**自动换行**。
 *
 * 行数在设计期算不出（图宽按自身比例 + `max-width:100%`，没有固定宽度就推不出
 * 每行能放几张），故引擎取**保守上界**：每张独占一行，总高 = N × 图高 + (N-1) × 间距。
 * 偏高只会让分页提前（留白），偏低则会溢出纸外，二者取前者。
 *
 * 空态（N = 0）与单张（N = 1）都仍按一行算 —— 空态的 `min-height` 同样占位，
 * 否则「未签名 / 已签名」两态的下划线位置会不一致。
 */
describe("多人签名：分页按「每张独占一行」的保守上界估高", () => {
  const URLS = ["a.png", "b.png", "c.png", "d.png", "e.png", "f.png"];

  it("无数据时与单图口径完全一致（空态仍占一行，回归）", () => {
    const noData = paginateSchema(makeSchema(32)).pages.length;
    expect(paginateSchema(makeSchema(32), { data: {} }).pages.length).toBe(noData);
  });

  it("单张与不传值的分页结果相同", () => {
    const none = paginateSchema(makeSchema(16)).pages.length;
    const one = paginateSchema(makeSchema(16), { data: { 签名0: URLS[0] } }).pages.length;
    expect(one).toBe(none);
  });

  it("张数越多估算越高：每张独占一行 ⇒ 逐张累加后溢页", () => {
    // 20mm 显式图高 + 0.5em 间距（13px ≈ 1.76mm）⇒ 单张 ≈ 21.76mm
    const height = "20mm";
    const one = paginateSchema(makeSchema(12, { imageHeight: height }), {
      data: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`签名${i}`, [URLS[0]]])),
    }).pages.length;
    const four = paginateSchema(makeSchema(12, { imageHeight: height }), {
      data: Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [`签名${i}`, URLS.slice(0, 4)]),
      ),
    }).pages.length;
    expect(four).toBeGreaterThan(one);
  });

  it("maxCount 之外不参与估高（与渲染层同一闸门）", () => {
    const height = "20mm";
    const capped = paginateSchema(makeSchema(4, { imageHeight: height, maxCount: 1 }), {
      data: Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`签名${i}`, URLS])),
    }).pages.length;
    const single = paginateSchema(makeSchema(4, { imageHeight: height }), {
      data: Object.fromEntries(
        Array.from({ length: 4 }, (_, i) => [`签名${i}`, [URLS[0]]]),
      ),
    }).pages.length;
    expect(capped).toBe(single);
  });
});
