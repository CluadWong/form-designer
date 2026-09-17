import { describe, expect, it } from "vitest";
import {
  FONT_SIZE_MAX_PX,
  FONT_SIZE_MIN_PX,
  normalizeFormSchemaV2,
  updateBaseFontSizeV2,
  validateFormSchemaV2,
} from "@/types";
import type { FormSchemaV2 } from "@/types";
import {
  DEFAULT_TABLE_HEADER_FONT_SIZE_PX,
  DEFAULT_TEXT_FONT_SIZE_PX,
  resolveBaseFontSizeV2,
  resolveTableHeaderFontSizeV2,
} from "@/engine-v2/derivation";

/**
 * 页面属性「基础字号」（全局默认字号）——schema 层契约。
 *
 * 设计要点：`baseFontSize` **可选**，未设 = 引擎默认 13（「不写 = 不变」）；
 * 面板显示的是 resolve 后的生效值，写回 schema 的只有用户实际改过的值。
 */
function makeSchema(extra: Partial<FormSchemaV2> = {}): FormSchemaV2 {
  return {
    version: 2,
    paper: { size: "A4" },
    baseRowHeight: 8,
    pages: [
      {
        id: "page-1",
        type: "page",
        mode: "fixed",
        margin: { top: 12, right: 12, bottom: 12, left: 12 },
        children: [],
      },
    ],
    ...extra,
  };
}

describe("基础字号：resolve 语义", () => {
  it("未设 → 引擎默认 13（不落默认值，旧 schema 行为不变）", () => {
    expect(resolveBaseFontSizeV2(makeSchema())).toBe(DEFAULT_TEXT_FONT_SIZE_PX);
    expect(resolveBaseFontSizeV2(makeSchema())).toBe(13);
  });

  it("非法值（0 / 负数 / NaN）→ 回退默认 13", () => {
    expect(resolveBaseFontSizeV2(makeSchema({ baseFontSize: 0 }))).toBe(13);
    expect(resolveBaseFontSizeV2(makeSchema({ baseFontSize: -4 }))).toBe(13);
    expect(resolveBaseFontSizeV2(makeSchema({ baseFontSize: Number.NaN }))).toBe(13);
  });

  it("有效值生效，并钳制到 6–72", () => {
    expect(resolveBaseFontSizeV2(makeSchema({ baseFontSize: 16 }))).toBe(16);
    expect(resolveBaseFontSizeV2(makeSchema({ baseFontSize: 1 }))).toBe(FONT_SIZE_MIN_PX);
    expect(resolveBaseFontSizeV2(makeSchema({ baseFontSize: 200 }))).toBe(FONT_SIZE_MAX_PX);
  });

  it("表头默认字号随基础字号按 16/13 等比（默认 13 → 16，外观与旧版一致）", () => {
    expect(resolveTableHeaderFontSizeV2(13)).toBe(DEFAULT_TABLE_HEADER_FONT_SIZE_PX);
    expect(resolveTableHeaderFontSizeV2(16)).toBe(20); // 16 × 16/13 = 19.69 → 20
    expect(resolveTableHeaderFontSizeV2(26)).toBe(32); // 26 × 16/13 = 32
  });
});

describe("基础字号：写入与钳制", () => {
  it("写入后取整并落在合法区间", () => {
    expect(updateBaseFontSizeV2(makeSchema(), 16).baseFontSize).toBe(16);
    expect(updateBaseFontSizeV2(makeSchema(), 16.4).baseFontSize).toBe(16);
    expect(updateBaseFontSizeV2(makeSchema(), 0).baseFontSize).toBe(FONT_SIZE_MIN_PX);
    expect(updateBaseFontSizeV2(makeSchema(), 999).baseFontSize).toBe(FONT_SIZE_MAX_PX);
  });

  it("写入不触碰其它顶层字段", () => {
    const next = updateBaseFontSizeV2(makeSchema(), 15);
    expect(next.baseRowHeight).toBe(8);
    expect(next.version).toBe(2);
    expect(next.pages).toHaveLength(1);
  });
});

describe("基础字号：序列化与校验", () => {
  it("未设时导出不新增 baseFontSize 键（不补默认值）", () => {
    const normalized = normalizeFormSchemaV2(makeSchema());
    expect("baseFontSize" in normalized).toBe(false);
  });

  it("已设时原样保留", () => {
    const normalized = normalizeFormSchemaV2(makeSchema({ baseFontSize: 16 }));
    expect(normalized.baseFontSize).toBe(16);
  });

  it("非法值不进入归一化结果（视为未设）", () => {
    const normalized = normalizeFormSchemaV2(makeSchema({ baseFontSize: 0 }));
    expect("baseFontSize" in normalized).toBe(false);
  });

  it("校验：合法 / 未设不报错，非正数报 INVALID_BASE_FONT_SIZE", () => {
    const issuesOf = (schema: FormSchemaV2) =>
      validateFormSchemaV2(schema).map((i) => i.code);
    expect(issuesOf(makeSchema({ baseFontSize: 16 }))).not.toContain("INVALID_BASE_FONT_SIZE");
    expect(issuesOf(makeSchema())).not.toContain("INVALID_BASE_FONT_SIZE");
    expect(issuesOf(makeSchema({ baseFontSize: 0 }))).toContain("INVALID_BASE_FONT_SIZE");
  });
});
