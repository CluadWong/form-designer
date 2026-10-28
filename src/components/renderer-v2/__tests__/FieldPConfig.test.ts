import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import GridSchemaNode from "@/components/renderer-v2/GridSchemaNode.vue";
import type { FieldPNodeV2 } from "@/types";

/**
 * 字段组件（field P）三项配置：
 * 1. **宽度 width**：自由长度字符串（mm / px / % 等），渲染为内联样式；
 * 2. **默认内容 default**：无填写数据时的预设文本，由文本域配置；
 * 3. **内部边框 innerBorder**：p 标签内每行（回车生成的 div）显示底边框，
 *    默认不显示；勾选后设计态 / 预览 / 打印均保持显示（渲染层只加修饰类，
 *    底边框由 `.layout-p--inner-border :deep(div)` 绘制，不在任何 @media 内，故打印同样生效）。
 */
function fieldNode(overrides: Partial<FieldPNodeV2> = {}): FieldPNodeV2 {
  return {
    id: "field-1",
    type: "p",
    mode: "field",
    field: "测试字段",
    ...overrides,
  };
}

describe("字段组件配置：宽度 / 默认内容 / 内部边框", () => {
  it("宽度：设置 width 时写入内联样式，支持 mm / px / %", () => {
    for (const width of ["30mm", "120px", "50%"]) {
      const wrapper = mount(GridSchemaNode, {
        props: { node: fieldNode({ width }), baseRowHeight: 8 },
      });
      expect(wrapper.attributes("style")).toContain(`width: ${width}`);
    }
  });

  it("宽度：未设置时不写 width（沿用 .layout-p 的 100%）", () => {
    const wrapper = mount(GridSchemaNode, {
      props: { node: fieldNode(), baseRowHeight: 8 },
    });
    expect(wrapper.attributes("style") ?? "").not.toContain("width:");
  });

  it("宽度：复合字段（有前/后标签）下宽度只作用于可输入区域，不作用于整个组件", () => {
    const make = (mode: "design" | "preview") =>
      mount(GridSchemaNode, {
        props: {
          node: fieldNode({ prefix: "共", suffix: "人", width: "30mm" }),
          baseRowHeight: 8,
          // preview 模式传空 data 进入填充态控件；
          data: mode === "preview" ? {} : undefined,
        },
      });

    // 1. 整个 <p> 不应带 width（否则前缀/后缀会被算进宽度）
    const design = make("design");
    expect(design.attributes("style") ?? "").not.toContain("width:");
    const preview = make("preview");
    expect(preview.attributes("style") ?? "").not.toContain("width:");

    // 2. 可输入区域挂上 width：设计态与预览态均为 .layout-p__input（统一渲染路径，见十续）
    expect(design.find(".layout-p__input").attributes("style")).toContain("width: 30mm");
    expect(preview.find(".layout-p__input").attributes("style")).toContain("width: 30mm");
  });

  it("默认内容：无 data 时渲染 default 预设文本", () => {
    const wrapper = mount(GridSchemaNode, {
      props: { node: fieldNode({ default: "预设内容" }), baseRowHeight: 8 },
    });
    expect(wrapper.text()).toBe("预设内容");
  });

  it("默认内容：data 有值时优先于 default（预览态只读控件 + 填充态控件值）", () => {
    // 预览态（readonly）：复用同一 <p> 渲染路径，值落在文本（而非 textarea.value）
    const preview = mount(GridSchemaNode, {
      props: {
        node: fieldNode({ default: "预设内容" }),
        baseRowHeight: 8,
        data: { 测试字段: "填写值" },
        readonly: true,
      },
    });
    expect(preview.find('[data-field="测试字段"]').text()).toBe("填写值");

    // 填充态：值同样落在 <p> 文本（统一渲染路径，见十续）
    const fill = mount(GridSchemaNode, {
      props: {
        node: fieldNode({ default: "预设内容" }),
        baseRowHeight: 8,
        data: { 测试字段: "填写值" },
      },
    });
    expect(fill.find('[data-field="测试字段"]').text()).toBe("填写值");
  });

  it("默认内容：填充态无 data 时控件回退 default", () => {
    const fill = mount(GridSchemaNode, {
      props: {
        node: fieldNode({ default: "预设内容" }),
        baseRowHeight: 8,
        data: {},
      },
    });
    expect(fill.find('[data-field="测试字段"]').text()).toBe("预设内容");
  });

  it("默认内容：data 存在该键且为空串时不回退 default（字段可被清空，G16）", () => {
    // 预览态（readonly）：清空后文本应为空串（不回退 default）
    const preview = mount(GridSchemaNode, {
      props: {
        node: fieldNode({ default: "预设内容" }),
        baseRowHeight: 8,
        data: { 测试字段: "" },
        readonly: true,
      },
    });
    expect(preview.find('[data-field="测试字段"]').text()).toBe("");

    // 填充态：文本应为空串（用户主动清空后，回写 "" 不应被 default 覆盖）
    const fill = mount(GridSchemaNode, {
      props: {
        node: fieldNode({ default: "预设内容" }),
        baseRowHeight: 8,
        data: { 测试字段: "" },
      },
    });
    expect(fill.find('[data-field="测试字段"]').text()).toBe("");
  });

  it("默认内容：未设置且无 data 时渲染为空", () => {
    const wrapper = mount(GridSchemaNode, {
      props: { node: fieldNode(), baseRowHeight: 8 },
    });
    expect(wrapper.text()).toBe("");
  });

  it("内部边框：innerBorder=true 加 layout-p--inner-border 修饰类", () => {
    const wrapper = mount(GridSchemaNode, {
      props: { node: fieldNode({ innerBorder: true }), baseRowHeight: 8 },
    });
    expect(wrapper.classes()).toContain("layout-p--inner-border");
  });

  it("内部边框：默认（未设置）不显示底边框修饰类", () => {
    const wrapper = mount(GridSchemaNode, {
      props: { node: fieldNode(), baseRowHeight: 8 },
    });
    expect(wrapper.classes()).not.toContain("layout-p--inner-border");
  });

  it("内部边框：预览（readonly）与填充态同样保留修饰类（设计/预览/打印均显示）", () => {
    const readonlyWrapper = mount(GridSchemaNode, {
      props: {
        node: fieldNode({ innerBorder: true }),
        baseRowHeight: 8,
        readonly: true,
      },
    });
    expect(readonlyWrapper.classes()).toContain("layout-p--inner-border");

    const fillWrapper = mount(GridSchemaNode, {
      props: {
        node: fieldNode({ innerBorder: true }),
        baseRowHeight: 8,
        data: {},
      },
    });
    expect(fillWrapper.classes()).toContain("layout-p--inner-border");
  });

  it("内部边框：勾选后 p 内存在 div 时底边框规则可命中（:deep 无 scope 属性）", () => {
    const wrapper = mount(GridSchemaNode, {
      props: { node: fieldNode({ innerBorder: true }), baseRowHeight: 8 },
    });
    // 渲染层产出的修饰类必须与 :deep(div) 规则匹配；运行时插入的 div 无 data-v 属性，
    // 故规则已用 :deep()，此处仅断言类名按 innerBorder 开关（视觉由浏览器保证）。
    const cls = wrapper.classes();
    expect(cls).toContain("layout-p--inner-border");
    expect(cls).toContain("layout-p--field");
  });

  it("内部边框：静态/预览渲染为逐行 div，打印态可命中真实底边框（修复打印不显示）", () => {
    // 多行值 → 渲染出与行数一致的 .layout-p__line div（真实边框元素，打印必定显示）
    const wrapper = mount(GridSchemaNode, {
      props: {
        node: fieldNode({ innerBorder: true, default: "第一行\n第二行\n第三行" }),
        baseRowHeight: 8,
        readonly: true,
      },
    });
    const lines = wrapper.findAll(".layout-p__line");
    expect(lines).toHaveLength(3);
    // 空值（无 data 且无 default）→ 至少渲染一个空行 div，保证打印有横线
    const empty = mount(GridSchemaNode, {
      props: { node: fieldNode({ innerBorder: true }), baseRowHeight: 8, readonly: true },
    });
    expect(empty.findAll(".layout-p__line").length).toBeGreaterThanOrEqual(1);
  });

  /**
   * 内部边框与下划线互斥（2026-10-20 修复）：
   * 下划线（`.layout-p--underline` 的 border-bottom）与逐行线（`.layout-p__line` 的
   * border-bottom）都会画字段底边。两者同时命中时，末行会被叠成两条底边 ——
   * 单行值最明显（两条线几乎重合，看起来像加粗的双线）。
   * 口径：**innerBorder 打开时不再挂下划线类**，由逐行线独家承担底边。
   * 2026-10-23 起 `underline` 键已从 schema 移除：下划线是默认行为，无需显式开启。
   */
  it("内部边框打开时不再叠下划线：非复合字段", () => {
    const both = mount(GridSchemaNode, {
      props: { node: fieldNode({ innerBorder: true }), baseRowHeight: 8 },
    });
    expect(both.classes()).toContain("layout-p--inner-border");
    expect(both.classes()).not.toContain("layout-p--underline");

    // 对照组：未勾内部边框的普通字段默认带下划线
    const underlineOnly = mount(GridSchemaNode, {
      props: { node: fieldNode({}), baseRowHeight: 8 },
    });
    expect(underlineOnly.classes()).toContain("layout-p--underline");
  });

  it("下划线恒定：缺 underline 键与旧数据 underline:false 都渲染下划线", () => {
    // ① 新建节点不再写 underline 键 —— 默认仍有提示线
    const noKey = mount(GridSchemaNode, {
      props: { node: fieldNode(), baseRowHeight: 8 },
    });
    expect(noKey.classes()).toContain("layout-p--underline");

    // ② 历史 schema 里显式 underline:false 的字段：键已被忽略，行为并入默认（有线）。
    //    这是 2026-10-23 下线该键后**唯一的行为变更**，在此显式登记，避免被当成回归。
    //    需要「打印可见的线」应改用 innerBorder；需要完全无线则该字段本就不该出现在票面。
    const legacyOff = {
      ...fieldNode(),
      underline: false,
    } as unknown as FieldPNodeV2;
    const wrapper = mount(GridSchemaNode, {
      props: { node: legacyOff, baseRowHeight: 8 },
    });
    expect(wrapper.classes()).toContain("layout-p--underline");
  });

  it("内部边框打开时不再叠下划线：复合字段（下划线在 .layout-p__input 上）", () => {
    const wrapper = mount(GridSchemaNode, {
      props: {
        node: fieldNode({ prefix: "共", suffix: "人", innerBorder: true }),
        baseRowHeight: 8,
      },
    });
    const input = wrapper.find(".layout-p__input");
    expect(input.exists()).toBe(true);
    expect(input.classes()).not.toContain("layout-p--underline");
  });

  it("单行 + 内部边框：只渲染一条逐行线（底边唯一来源）", () => {
    const wrapper = mount(GridSchemaNode, {
      props: {
        node: fieldNode({ innerBorder: true, default: "单行内容" }),
        baseRowHeight: 8,
        readonly: true,
      },
    });
    expect(wrapper.findAll(".layout-p__line")).toHaveLength(1);
    expect(wrapper.classes()).not.toContain("layout-p--underline");
  });
});

/**
 * 图片值（电子签名）+ 内部边框：**线与图共存**（2026-10-21 用户拍板）。
 *
 * 规则：
 * - 行数 = `default` 的换行数（`"\n"` → 2 行），`default` 是图片地址时算 1 行；
 * - 图固定在**最后一行**内 —— 坐在该行 div 自己的 `border-bottom` 上，不额外多画一条线；
 * - 多张图在这一行内换行、继续向下排（行数不变，末行随图变高）；
 * - 行内不渲染文字（值本身是图片地址）。
 */
describe("图片值 + 内部边框：线与图共存", () => {
  const A = "a.png";
  const B = "b.png";

  it("default 为换行符：铺两行下划线，且不再渲染缺省图", () => {
    const wrapper = mount(GridSchemaNode, {
      props: {
        node: fieldNode({ valueType: "image", innerBorder: true, default: "\n" }),
        baseRowHeight: 8,
        readonly: true,
      },
    });
    expect(wrapper.findAll(".layout-p__line")).toHaveLength(2);
    expect(wrapper.findAll("img")).toHaveLength(0);
    // 行内不显示任何文字（否则会把 default 的地址/换行打印出来）
    expect(wrapper.text()).toBe("");
  });

  it("default 为空：仍保留 1 行（空态也要有签名线）", () => {
    const wrapper = mount(GridSchemaNode, {
      props: {
        node: fieldNode({ valueType: "image", innerBorder: true }),
        baseRowHeight: 8,
        readonly: true,
      },
    });
    expect(wrapper.findAll(".layout-p__line")).toHaveLength(1);
    expect(wrapper.findAll("img")).toHaveLength(0);
  });

  it("default 是图片地址：1 行 + 图压在该行内（行内 div 的底边即签名线）", () => {
    const wrapper = mount(GridSchemaNode, {
      props: {
        node: fieldNode({ valueType: "image", innerBorder: true, default: A }),
        baseRowHeight: 8,
        readonly: true,
      },
    });
    const lines = wrapper.findAll(".layout-p__line");
    expect(lines).toHaveLength(1);
    expect(lines[0].findAll("img")).toHaveLength(1);
    expect(lines[0].find("img").attributes("src")).toBe(A);
  });

  it("有数据多张图 + default 三行：行数不变，图全部落在最后一行", () => {
    const wrapper = mount(GridSchemaNode, {
      props: {
        node: fieldNode({ valueType: "image", innerBorder: true, default: "\n\n" }),
        baseRowHeight: 8,
        readonly: true,
        data: { 测试字段: [A, B] },
      },
    });
    const lines = wrapper.findAll(".layout-p__line");
    expect(lines).toHaveLength(3);
    expect(lines[0].findAll("img")).toHaveLength(0);
    expect(lines[1].findAll("img")).toHaveLength(0);
    expect(lines[2].findAll("img")).toHaveLength(2);
  });

  it("未开内部边框时走原分支：图直接作为容器子项，不出现逐行 div", () => {
    const wrapper = mount(GridSchemaNode, {
      props: {
        node: fieldNode({ valueType: "image" }),
        baseRowHeight: 8,
        readonly: true,
        data: { 测试字段: [A] },
      },
    });
    expect(wrapper.findAll(".layout-p__line")).toHaveLength(0);
    expect(wrapper.find(".layout-p__signcell").exists()).toBe(true);
    expect(wrapper.classes()).toContain("layout-p--underline");
  });
});
