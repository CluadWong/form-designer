import { describe, expect, it } from "vitest";
import { parseFormSchemaV2 } from "@/types";
import { paginatePage, paginateSchema } from "@/engine-v2/pagination";
import schemaJson from "@/fixtures/ticket-schema-v2-1789525251312.json";

const schema = parseFormSchemaV2(schemaJson as unknown);

describe("导入真实 JSON 的分页契约", () => {
  const page = schema.pages[0];
  const m = page.margin;
  const bodyH = 297 - m.top - m.bottom;
  const contentW = 210 - m.left - m.right;

  it("确定性分页对该 schema 只产 1 页（每行 8mm 估算，总高 < 正文可用高）", () => {
    const r = paginatePage(page, {
      baseRowHeight: schema.baseRowHeight,
      bodyHeightMm: bodyH,
      contentWidthMm: contentW,
      data: null,
    });
    // 12 个 grid 每行 height:1 → 8mm，确定性总高 ~100mm < 273mm，引擎正确地不切分。
    // 这正是「导入后分页看似没触发」的前提：真实撑高来自嵌套 Table / 多行文本，需实测行高校正。
    expect(r.pages.length).toBe(1);
    expect(r.pages[0].children).toHaveLength(12);
  });

  it("注入真实测量行高（measureRow）后应按实测高度切分为多页", () => {
    const tallRows = new Set<string>([
      "members-label-row",
      "members-field-row",
      "work-task-row",
      "condition-label-row",
      "condition-field-row",
      "notice-label-row",
      "notice-field-row",
      "notice-remark-row",
      "issuer-row",
      "confirm-task-label-row",
      "extension-header-row",
      "extension-expire-row",
      "extension-owner-row",
      "extension-permitter-row",
    ]);
    const measureRow = (row: { id: string }): number =>
      tallRows.has(row.id) ? 40 : 20;

    const r = paginateSchema(schema, { data: null, measureRow });
    expect(r.pages.length).toBeGreaterThan(1);
  });
});
