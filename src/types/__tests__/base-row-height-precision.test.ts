import { describe, expect, it } from "vitest";
import { createEmptyFormSchemaV2, updateBaseRowHeightV2 } from "@/types";

/**
 * 页面基准行高精度（2026-09-16）：支持 0.1mm 粒度。
 *
 * 历史上 `updateBaseRowHeightV2` 用 `Math.floor` 截断成整数，导致设计器无法表达
 * 0.1mm 行高。现改为四舍五入到 1 位小数，clamp 为 0.1–99（下界亦到 0.1mm）。
 * 下游（`gridRowHeightMm` 乘法换算、CSS `min-height: {n}mm`）均为浮点安全，无需改动。
 */
describe("updateBaseRowHeightV2：0.1mm 粒度", () => {
  it("保留 1 位小数（不截断）", () => {
    const schema = createEmptyFormSchemaV2();
    expect(updateBaseRowHeightV2(schema, 8.4).baseRowHeight).toBe(8.4);
    expect(updateBaseRowHeightV2(schema, 8.1).baseRowHeight).toBe(8.1);
    expect(updateBaseRowHeightV2(schema, 12.5).baseRowHeight).toBe(12.5);
  });

  it("第二位小数四舍五入到 1 位", () => {
    const schema = createEmptyFormSchemaV2();
    expect(updateBaseRowHeightV2(schema, 8.46).baseRowHeight).toBe(8.5);
    expect(updateBaseRowHeightV2(schema, 8.44).baseRowHeight).toBe(8.4);
  });

  it("clamp 到 0.1–99（含小数下界）", () => {
    const schema = createEmptyFormSchemaV2();
    expect(updateBaseRowHeightV2(schema, 0.05).baseRowHeight).toBe(0.1);
    expect(updateBaseRowHeightV2(schema, 0).baseRowHeight).toBe(0.1);
    expect(updateBaseRowHeightV2(schema, 0.5).baseRowHeight).toBe(0.5);
    expect(updateBaseRowHeightV2(schema, 120).baseRowHeight).toBe(99);
    expect(updateBaseRowHeightV2(schema, 99).baseRowHeight).toBe(99);
  });

  it("整数入参保持整数语义", () => {
    const schema = createEmptyFormSchemaV2();
    expect(updateBaseRowHeightV2(schema, 8).baseRowHeight).toBe(8);
  });
});
