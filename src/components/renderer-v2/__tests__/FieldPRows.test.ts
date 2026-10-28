import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import GridSchemaNode from "@/components/renderer-v2/GridSchemaNode.vue";
import { DEFAULT_TEXT_LINE_HEIGHT } from "@/engine-v2/derivation";
import { resolvePFieldRowsV2 } from "@/types";
import type { FieldPNodeV2 } from "@/types";

/**
 * 字段 P「初始行数」（`rows`，2026-10-27）。
 *
 * 用户诉求：**设计时**就能指定输入框初始几行，而不是靠「默认内容」里敲回车——
 * 默认值是**初始内容**，contenteditable 一输入就整体替换，行数立刻掉回 1 行。
 *
 * 语义是**最小行数**（不是固定高度）：空值占 N 行，输入超出继续长高。行数真源是
 * `resolvePFieldRowsV2`（`max(rows, default 换行数)`），渲染 / 分页 / 校验三方共用。
 */
function fieldNode(overrides: Partial<FieldPNodeV2> = {}): FieldPNodeV2 {
  return {
    id: "field-1",
    type: "p",
    mode: "field",
    field: "备注",
    ...overrides,
  };
}

function rowStyle(node: FieldPNodeV2): string {
  return (
    mount(GridSchemaNode, { props: { node, baseRowHeight: 8 } }).attributes(
      "style",
    ) ?? ""
  );
}

const LINE_EM = `${DEFAULT_TEXT_LINE_HEIGHT}em`;

describe("字段 P 初始行数：行数真源", () => {
  it("rows 与 default 换行数取大者；缺省 / 非正 / 小数按 1 行与取整处理", () => {
    expect(resolvePFieldRowsV2({})).toBe(1);
    expect(resolvePFieldRowsV2({ rows: 3 })).toBe(3);
    expect(resolvePFieldRowsV2({ rows: 1 })).toBe(1);
    expect(resolvePFieldRowsV2({ rows: 0 })).toBe(1);
    expect(resolvePFieldRowsV2({ rows: -2 })).toBe(1);
    expect(resolvePFieldRowsV2({ rows: 2.7 })).toBe(2);

    // 历史行为：只有 default 时按换行数（升级前后逐值一致）
    expect(resolvePFieldRowsV2({ default: "a\nb" })).toBe(2);

    // 两者都有时取大者：默认内容比配置行数多时不能被截断
    expect(resolvePFieldRowsV2({ rows: 2, default: "a\nb\nc" })).toBe(3);
    expect(resolvePFieldRowsV2({ rows: 4, default: "a\nb" })).toBe(4);
  });
});

describe("字段 P 初始行数：渲染", () => {
  it("rows > 1 时给最小高度、height:auto、顶部对齐", () => {
    const style = rowStyle(fieldNode({ rows: 3 }));
    expect(style).toContain(`min-height: calc(3 * ${LINE_EM})`);
    // 必须压掉 `.layout-grid__cell > .layout-p { height: calc(100% - 1mm) }`：
    // 否则格子比 3 行高时 p 被拉满格子，「3 行」完全看不出来
    expect(style).toContain("height: auto");
    // ① 格子的 flex 子项默认 align-self:center → 整块会随内容上下浮动
    expect(style).toContain("align-self: flex-start");
    // ② textCss 给的 align-items（垂直对齐，默认居中）→ 空值光标会落在中间行
    expect(style).toContain("align-items: flex-start");
  });

  it("rows 缺省 / 1 / 非法时不写任何行数样式（老 schema 外观逐值不变）", () => {
    for (const node of [
      fieldNode(),
      fieldNode({ rows: 1 }),
      fieldNode({ rows: 0 }),
    ]) {
      const style = rowStyle(node);
      expect(style).not.toContain("min-height");
      expect(style).not.toContain("height: auto");
      expect(style).not.toContain("align-self");
      // 垂直对齐仍由 textCss（节点「垂直对齐」配置，默认 center）决定
      expect(style).toContain("align-items: center");
    }
  });

  it("复合字段：行高落在 .layout-p__input 上（外层只给 height:auto 与顶对齐）", () => {
    const wrapper = mount(GridSchemaNode, {
      props: {
        node: fieldNode({ rows: 3, prefix: "共", suffix: "人" }),
        baseRowHeight: 8,
      },
    });
    const outer = wrapper.attributes("style") ?? "";
    // flex row 的交叉轴是 center，外层给 min-height 拉伸不到输入区
    expect(outer).toContain("height: auto");
    expect(outer).not.toContain("min-height");
    expect(wrapper.find(".layout-p__input").attributes("style")).toContain(
      `min-height: calc(3 * ${LINE_EM})`,
    );
  });

  it("内部边框：空值也按 rows 铺满逐行横线，内容更多时不截断", () => {
    // 横线是真实 <div> 的底边框，没有 div 就没有线 → 不补空行时「3 行 + 内部边框」只画 1 条
    const empty = mount(GridSchemaNode, {
      props: { node: fieldNode({ rows: 3, innerBorder: true }), baseRowHeight: 8 },
    });
    expect(empty.findAll(".layout-p__line")).toHaveLength(3);

    const more = mount(GridSchemaNode, {
      props: {
        node: fieldNode({ rows: 2, innerBorder: true, default: "1\n2\n3" }),
        baseRowHeight: 8,
      },
    });
    expect(more.findAll(".layout-p__line")).toHaveLength(3);

    // default 比 rows 多时由 default 决定行数（同一真源）
    const byDefault = mount(GridSchemaNode, {
      props: { node: fieldNode({ innerBorder: true, default: "1\n2" }), baseRowHeight: 8 },
    });
    expect(byDefault.findAll(".layout-p__line")).toHaveLength(2);
  });
});
