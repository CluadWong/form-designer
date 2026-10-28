import { describe, expect, it, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import FormDesigner from "@/components/designer/FormDesigner.vue";
import { createEmptyFormSchemaV2, createFieldPNodeV2 } from "@/types";
import type { FieldPNodeV2, FormSchemaV2 } from "@/types";

/**
 * 面板「初始行数」（`rows`，2026-10-27）的接线：控件存在、值来自 schema、改动落到 schema。
 *
 * 端到端（设计态所见即所得）在 `renderer-v2/__tests__/FieldPRows.test.ts` 覆盖；
 * 这里只验「面板 ↔ schema」这一段，避免重复断言。
 */
let active: VueWrapper | null = null;
afterEach(() => {
  active?.unmount();
  active = null;
});

/** 页面顶层放一个字段 P（不在 Grid 内，点击即选中它自己）。 */
async function mountWithField(overrides: Partial<FieldPNodeV2> = {}) {
  const schema = createEmptyFormSchemaV2();
  const node = { ...createFieldPNodeV2("备注"), ...overrides } as FieldPNodeV2;
  schema.pages[0].children.push(node);
  const wrapper = mount(FormDesigner, {
    props: { initialSchema: schema },
    attachTo: document.body,
  });
  active = wrapper;
  await wrapper.find(`[data-node-id="${node.id}"]`).trigger("click");
  await nextTick();
  await nextTick();
  return { wrapper, node };
}

function selectedField(wrapper: VueWrapper): FieldPNodeV2 {
  const schema = (wrapper.vm as unknown as { schema: FormSchemaV2 }).schema;
  const found = schema.pages[0].children.find((child) => child.type === "p");
  if (!found || found.type !== "p") throw new Error("字段 P 未找到");
  return found;
}

describe("FieldPInspector 初始行数", () => {
  it("提供「初始行数」输入，缺省留空（= 1 行）", async () => {
    const { wrapper } = await mountWithField();
    const input = wrapper.find('[data-field-rows="true"]');
    expect(input.exists()).toBe(true);
    expect((input.element as HTMLInputElement).value).toBe("");
    expect(input.attributes("placeholder") ?? "").toContain("1 行");
  });

  it("填 3 写入 rows；改回 1 / 清空则回落到未设置（导出 JSON 不留冗余键）", async () => {
    const { wrapper } = await mountWithField();
    const input = wrapper.find('[data-field-rows="true"]');

    await input.setValue("3");
    await input.trigger("change");
    await nextTick();
    expect(selectedField(wrapper).rows).toBe(3);

    await input.setValue("1");
    await input.trigger("change");
    await nextTick();
    expect(selectedField(wrapper).rows).toBeUndefined();

    await input.setValue("5");
    await input.trigger("change");
    await nextTick();
    expect(selectedField(wrapper).rows).toBe(5);

    await input.setValue("");
    await input.trigger("change");
    await nextTick();
    expect(selectedField(wrapper).rows).toBeUndefined();
  });

  it("设计态画布立即按行数撑高（所见即所得）", async () => {
    const { wrapper, node } = await mountWithField({ rows: 3 });
    const el = wrapper.find(`[data-node-id="${node.id}"]`);
    expect(el.attributes("style") ?? "").toContain("calc(3 * 1.6em)");
  });
});
