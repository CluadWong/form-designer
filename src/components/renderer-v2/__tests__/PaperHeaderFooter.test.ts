import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { GridFormRenderer } from "@/components/renderer-v2";
import {
  createEmptyFormSchemaV2,
  createGridBySizeV2,
  insertRootGridV2,
} from "@/types";
import type { FormSchemaV2, HeaderFooterV2 } from "@/types";

/**
 * 页眉 / 页脚（paper 级全局配置）：
 * - 未启用时不渲染任何带；
 * - **默认每个物理页各渲染一份**（「每页重复」，打印同理）；
 *   `repeatOnEveryPage: false` 时收敛为仅第 1 张物理页；
 * - `{page}` / `{total}` 按物理页序解析；
 * - 带高 / 文本样式 / 分隔线来自配置。
 */
function schemaWithPages(
  count: number,
  extra?: { header?: HeaderFooterV2; footer?: HeaderFooterV2 },
): FormSchemaV2 {
  const pages = [];
  for (let i = 0; i < count; i++) {
    const grid = createGridBySizeV2({ rows: 1, columns: 1, border: "all" });
    const one = insertRootGridV2(createEmptyFormSchemaV2(), grid);
    pages.push({ ...one.pages[0], id: `page-${i + 1}` });
  }
  return {
    ...createEmptyFormSchemaV2(),
    paper: { size: "A4", ...(extra ?? {}) },
    pages,
  };
}

function render(schema: FormSchemaV2) {
  return mount(GridFormRenderer, { props: { schema } });
}

describe("页眉 / 页脚渲染", () => {
  it("未配置：不渲染任何页眉/页脚带", () => {
    const wrapper = render(schemaWithPages(2));
    expect(wrapper.findAll(".grid-form-band")).toHaveLength(0);
  });

  it("enabled 未设（非 true）：不渲染（不静默兜底）", () => {
    const wrapper = render(
      schemaWithPages(2, { header: { content: { left: "x" } } }),
    );
    expect(wrapper.findAll(".grid-form-band")).toHaveLength(0);
  });

  it("启用后：每个物理页各渲染一份页眉与页脚", () => {
    const wrapper = render(
      schemaWithPages(3, {
        header: { enabled: true, content: { left: "云铝" } },
        footer: { enabled: true, content: { center: "页脚" } },
      }),
    );
    expect(wrapper.findAll(".grid-form-band--header")).toHaveLength(3);
    expect(wrapper.findAll(".grid-form-band--footer")).toHaveLength(3);
  });

  it("repeatOnEveryPage=false：仅第 1 张物理页渲染一条带", () => {
    const wrapper = render(
      schemaWithPages(3, {
        header: { enabled: true, repeatOnEveryPage: false, content: { left: "云铝" } },
        footer: {
          enabled: true,
          repeatOnEveryPage: false,
          content: { center: "第 {page} 页 / 共 {total} 页" },
        },
      }),
    );
    expect(wrapper.findAll(".grid-form-band--header")).toHaveLength(1);
    expect(wrapper.findAll(".grid-form-band--footer")).toHaveLength(1);
    // 仅首页那条：{page} 解析为 1，{total} 仍为物理页总数 3
    expect(
      wrapper.find(".grid-form-band--footer .grid-form-band__zone--center").text(),
    ).toBe("第 1 页 / 共 3 页");
    // 首张物理页确实带带子
    expect(wrapper.findAll(".grid-form-paper")[0].find(".grid-form-band").exists()).toBe(true);
  });

  it("repeatOnEveryPage=true（显式）：仍每页重复", () => {
    const wrapper = render(
      schemaWithPages(3, { header: { enabled: true, repeatOnEveryPage: true } }),
    );
    expect(wrapper.findAll(".grid-form-band--header")).toHaveLength(3);
  });

  it("占位符 {page} / {total} 按物理页序解析", () => {
    const wrapper = render(
      schemaWithPages(3, {
        footer: { enabled: true, content: { center: "第 {page} 页 / 共 {total} 页" } },
      }),
    );
    const texts = wrapper
      .findAll(".grid-form-band--footer .grid-form-band__zone--center")
      .map((el) => el.text());
    expect(texts).toEqual([
      "第 1 页 / 共 3 页",
      "第 2 页 / 共 3 页",
      "第 3 页 / 共 3 页",
    ]);
  });

  it("样式：字号(px) / 加粗 / 关闭分隔线", () => {
    const wrapper = render(
      schemaWithPages(1, {
        header: {
          enabled: true,
          style: { fontSize: 14, fontWeight: "bold" },
          separator: false,
        },
      }),
    );
    const style = (wrapper.find(".grid-form-band--header").element as HTMLElement).style;
    expect(style.fontSize).toBe("14px");
    expect(style.fontWeight).toBe("bold");
    expect(style.borderBottom).toBe("");
  });

  it("默认开启分隔线（separator 未设即 true）", () => {
    const wrapper = render(schemaWithPages(1, { header: { enabled: true } }));
    const style = (wrapper.find(".grid-form-band--header").element as HTMLElement).style;
    expect(style.borderBottom).toContain("1px");
  });

  it("带高与左右偏移：驻留纸张边距区", () => {
    const schema = schemaWithPages(1, {
      header: { enabled: true, height: 8 },
    });
    const wrapper = render(schema);
    const band = wrapper.find(".grid-form-band--header");
    const raw = band.attributes("style") ?? "";
    const margin = schema.pages[0].margin;
    expect(raw).toContain(`left: ${margin.left}mm`);
    expect(raw).toContain(`right: ${margin.right}mm`);
    expect(raw).toContain("height: 8mm");
  });

  it("带高超过边距：收敛到边距，不伸进正文区（防重叠/打印裁切）", () => {
    const schema = schemaWithPages(1, {
      // 默认边距 12mm，却配了 20mm 带高 → 渲染必须收敛到 12mm
      header: { enabled: true, height: 20 },
      footer: { enabled: true, height: 30 },
    });
    const margin = schema.pages[0].margin;
    expect(margin.top).toBe(12);
    const wrapper = render(schema);
    const headerRaw = wrapper.find(".grid-form-band--header").attributes("style") ?? "";
    const footerRaw = wrapper.find(".grid-form-band--footer").attributes("style") ?? "";
    expect(headerRaw).toContain(`height: ${margin.top}mm`);
    expect(headerRaw).not.toContain("height: 20mm");
    expect(footerRaw).toContain(`height: ${margin.bottom}mm`);
    // 收敛只影响渲染，schema 原值不动（不静默改写配置）
    expect(schema.paper.header?.height).toBe(20);
  });

  it("未设带高：回退 DEFAULT_BAND_HEIGHT_MM(10)", () => {
    const wrapper = render(schemaWithPages(1, { header: { enabled: true } }));
    const raw = wrapper.find(".grid-form-band--header").attributes("style") ?? "";
    expect(raw).toContain("height: 10mm");
  });
});
