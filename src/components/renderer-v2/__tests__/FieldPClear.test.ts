import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import GridSchemaNode from "@/components/renderer-v2/GridSchemaNode.vue";
import GridFormRenderer from "@/components/renderer-v2/GridFormRenderer.vue";
import { collectFieldValues } from "@/components/renderer-v2/collectFieldValues";
import {
  appendNodeToCellV2,
  createEmptyFormSchemaV2,
  createGridNodeV2,
  insertRootGridV2,
} from "@/types";
import type { FieldPNodeV2, FormSchemaV2 } from "@/types";

/**
 * 文本值字段的「清空」按钮（2026-10-21）。
 *
 * 语义（用户口径）：**鼠标悬浮字段时浮现，点击清空当前值并恢复显示默认值**。
 * - 内核只 emit `field-change(field, default ?? "")`，写回由宿主负责（与 sign-remove 同契约）；
 *   不是 emit `""` —— `fieldValue` 对「键存在但为空串」不回退 default（G16），emit `""`
 *   只能清成空，拿不到「恢复默认值」。
 * - 渲染条件苛刻：填写态 + 权限 EDIT + 非图片值 + 值 ≠ 默认值。设计态 / 只读 / 脱敏 /
 *   无值可清 一律不出现。
 * - 字形由 CSS 生成，**元素内无文本节点** —— 否则 `collectFieldValues` 按 `innerText`
 *   采集会把字段值污染成 `"值×"`。
 */
function fieldNode(overrides: Partial<FieldPNodeV2> = {}): FieldPNodeV2 {
  return {
    id: "clear-1",
    type: "p",
    mode: "field",
    field: "备注",
    underline: true,
    ...overrides,
  };
}

function fill(
  node: FieldPNodeV2,
  data: Record<string, string | string[]>,
  extra: Record<string, unknown> = {},
) {
  return mount(GridSchemaNode, {
    props: { node, baseRowHeight: 8, mode: "preview", readonly: false, data, ...extra },
  });
}

/** 一张最小表单：一个根的 1×1 网格，首格放一个带 `default` 的字段（整链路测试用）。 */
function schemaWithDefaultField(defaultValue: string): FormSchemaV2 {
  const grid = createGridNodeV2();
  const cellId = grid.rows[0].cells[0].id;
  const field: FieldPNodeV2 = {
    id: "field-1",
    type: "p",
    mode: "field",
    field: "字段1",
    underline: true,
    default: defaultValue,
  };
  return appendNodeToCellV2(insertRootGridV2(createEmptyFormSchemaV2(), grid), cellId, field);
}

describe("文本值字段的清空按钮", () => {
  it("有值且与默认值不同：渲染按钮，点击 emit 默认值", async () => {
    const wrapper = fill(fieldNode({ default: "默认内容" }), { 备注: "手填内容" });
    const btn = wrapper.find(".layout-p__clear");
    expect(btn.exists()).toBe(true);
    expect(btn.attributes("title")).toBe("清空");

    await btn.trigger("click");
    expect(wrapper.emitted("field-change")?.[0]).toEqual(["备注", "默认内容"]);
  });

  it("没有默认值：点击 emit 空串（真正清空）", async () => {
    const wrapper = fill(fieldNode(), { 备注: "手填内容" });
    await wrapper.find(".layout-p__clear").trigger("click");
    expect(wrapper.emitted("field-change")?.[0]).toEqual(["备注", ""]);
  });

  it("预览态显示的就是默认值（data 无该键）：按钮照样出现", () => {
    // 2026-10-21 实测反馈：带默认值的字段在预览态永远看不到 × —— 因为判定曾用
    // 「值 ≠ 默认值」，而 data 无该键时显示值回退的正是 default。改为「显示值非空」。
    const node = fieldNode({ default: "   年  月  日" });
    const wrapper = fill(node, {});
    // 前导空格保留在 DOM 里（`white-space: pre-wrap`），故用 textContent 而非 .text()
    expect(wrapper.find(".layout-p__value").element.textContent).toBe("   年  月  日");
    expect(wrapper.find(".layout-p__clear").exists()).toBe(true);
    // 点 × 的语义是「清空 → 恢复默认」：宿主写回的就是 default 本身
    return wrapper.find(".layout-p__clear").trigger("click").then(() => {
      expect(wrapper.emitted("field-change")?.[0]).toEqual(["备注", "   年  月  日"]);
    });
  });

  it("空值（无内容可清）：不渲染按钮", () => {
    // data 缺该键且无默认值 / 显式空串 / 纯空白默认值 → 屏幕上是空的，清空是空操作
    expect(fill(fieldNode(), {}).find(".layout-p__clear").exists()).toBe(false);
    expect(fill(fieldNode(), { 备注: "" }).find(".layout-p__clear").exists()).toBe(false);
    expect(fill(fieldNode({ default: "\n" }), {}).find(".layout-p__clear").exists()).toBe(false);
    expect(fill(fieldNode({ default: "   " }), {}).find(".layout-p__clear").exists()).toBe(false);
  });

  it("只读态 / 设计态不渲染（没有可改值的入口）", () => {
    const node = fieldNode({ default: "默认内容" });
    const readonly = mount(GridSchemaNode, {
      props: {
        node,
        baseRowHeight: 8,
        mode: "preview",
        readonly: true,
        data: { 备注: "手填内容" },
      },
    });
    expect(readonly.find(".layout-p__clear").exists()).toBe(false);

    const design = mount(GridSchemaNode, {
      props: { node, baseRowHeight: 8, mode: "design" },
    });
    expect(design.find(".layout-p__clear").exists()).toBe(false);
  });

  it("字段权限 READ / HIDDEN 不渲染（HIDDEN 不能借清空探出真值形态）", () => {
    const node = fieldNode({ default: "默认内容" });
    for (const permission of ["READ", "HIDDEN"] as const) {
      const wrapper = fill(node, { 备注: "手填内容" }, {
        fieldPermissions: { 备注: permission },
      });
      expect(wrapper.find(".layout-p__clear").exists()).toBe(false);
    }
  });

  it("图片值字段不渲染（删除某一张 ≠ 清空，由 sign-del 承担）", () => {
    const wrapper = fill(
      fieldNode({ valueType: "image", params: { action: "signature" } }),
      { 备注: "data:image/png;base64,AAAA" },
    );
    expect(wrapper.find(".layout-p__clear").exists()).toBe(false);
  });

  it("复合字段（有前/后标签）同样只出一个按钮", () => {
    const wrapper = fill(
      fieldNode({ prefix: "备注：", suffix: "（可选）", default: "默认内容" }),
      { 备注: "手填内容" },
    );
    expect(wrapper.findAll(".layout-p__clear")).toHaveLength(1);
    expect(wrapper.find(".layout-p__label").text()).toBe("备注：");
  });

  it("按钮内部无文本节点：字形走 CSS，字段值不被「×」污染", async () => {
    const wrapper = fill(fieldNode({ default: "默认内容" }), { 备注: "手填内容" });
    const btn = wrapper.find(".layout-p__clear");
    expect(btn.text()).toBe("");
    // 整个字段的文本仍是原值 + 标签，不含 ×（jsdom 无 innerText，textContent 口径同源）
    expect(wrapper.find(".layout-p").text()).toBe("手填内容");
    // contenteditable 宿主里的按钮必须显式退出编辑区，否则会被并入可编辑文本
    expect(btn.attributes("contenteditable")).toBe("false");

    // DOM 采集（消费页「取数」路径）与实际值一致
    const collected = collectFieldValues(wrapper.element as HTMLElement);
    expect(collected["备注"]).toBe("手填内容");
  });

  it("宿主写回 emit 的默认值后，字段重新显示默认内容（端到端）", async () => {
    const wrapper = fill(fieldNode({ default: "默认内容" }), { 备注: "手填内容" });
    expect(wrapper.find(".layout-p__value").text()).toBe("手填内容");

    await wrapper.find(".layout-p__clear").trigger("click");
    const [, value] = wrapper.emitted("field-change")?.[0] as [string, string];
    // 宿主（FormRenderer.onFieldChange）拿到事件即写入 data → 展示回到默认值
    await wrapper.setProps({ data: { 备注: value } });
    expect(wrapper.find(".layout-p__value").text()).toBe("默认内容");
    // 屏幕上还有内容（默认值），按钮继续在——不是「清完就消失」
    expect(wrapper.find(".layout-p__clear").exists()).toBe(true);
  });

  it("没有默认值：写回空串后屏幕清空，按钮随之消失", async () => {
    const wrapper = fill(fieldNode(), { 备注: "手填内容" });
    await wrapper.find(".layout-p__clear").trigger("click");
    const [, value] = wrapper.emitted("field-change")?.[0] as [string, string];
    await wrapper.setProps({ data: { 备注: value } });
    expect(wrapper.find(".layout-p__value").text()).toBe("");
    expect(wrapper.find(".layout-p__clear").exists()).toBe(false);
  });

  it("点击不冒泡到字段（不会顺带触发字段激活/选中）", async () => {
    const wrapper = fill(fieldNode({ default: "默认内容" }), { 备注: "手填内容" });
    let bubbled = false;
    wrapper.element.addEventListener("click", () => {
      bubbled = true;
    });
    await wrapper.find(".layout-p__clear").trigger("click");
    expect(bubbled).toBe(false);
  });

  it("设计器预览态整链路（GridFormRenderer + preview + 空 data）：带默认值的字段出现 ×", () => {
    // 用户报的场景：模板里 `default: "   年  月  日"` 的文本字段，设计态点「预览」后悬浮没有 ×。
    // 设计器预览按 mode=preview + readonly=false + previewData（初始 {}）传参，即下面的组合。
    // （原用例直接 import 用户那份 JSON，该文件已从 src/dev 清掉，故改为等价内联 schema。）
    const schema = schemaWithDefaultField("   年  月  日");
    const wrapper = mount(GridFormRenderer, {
      props: { schema, data: {}, mode: "preview", readonly: false },
    });
    const field = wrapper.find('[data-field="字段1"]');
    expect(field.exists()).toBe(true);
    expect(field.find(".layout-p__clear").exists()).toBe(true);
    // 只读回显（消费页默认态）不该有
    const readonlyWrapper = mount(GridFormRenderer, {
      props: { schema, data: {}, mode: "preview", readonly: true },
    });
    expect(readonlyWrapper.find('[data-field="字段1"] .layout-p__clear').exists()).toBe(false);
  });
});
