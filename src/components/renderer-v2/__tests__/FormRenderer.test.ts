import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import FormRenderer from "@/components/renderer-v2/FormRenderer.vue";
import { makeYunlvSecondTicketFirstFiveRowsSchema } from "@/dev/yunlv-second-ticket-first-five-rows";
import demoData from "@/dev/demoData";
import { parseTolerantFormSchemaV2 } from "@/types";

/**
 * 打印改走 vue-print-next（2026-09-11）：本文件只需断言「消费页拿得到 print() 且它能
 * 把内核画布交给打印插件」，真实打印栈由 `print-form.test.ts` 覆盖，故替身掉插件本身。
 */
const { printCtorSpy } = vi.hoisted(() => ({ printCtorSpy: vi.fn() }));
vi.mock("vue-print-next", () => ({
  VuePrintNext: class {
    constructor(options: unknown) {
      printCtorSpy(options);
    }
  },
}));

/**
 * FormRenderer（G8 公共渲染入口）测试：
 * - 消费态 `readonly` 默认 true → 字段只读回显（仅浏览详情）；
 * - `options.readonly=false` → 进入填写态，字段可输入，失焦 emit field-change / update:data；
 * - `getFormData()` 返回整个表单当前输入数据（与 update:data 同口径）；
 * - 消费页典型流程：JSON 字符串 → parseTolerantFormSchemaV2().schema → FormRenderer。
 *
 * 设计态（内核 `mode="design"`）与消费态由「isDesign + readonly」两正交轴区分，
 * FormRenderer 自身不再持有 preview/fill 模式（永远是消费态、对内传固定非设计 mode）。
 */
const sampleSchema = makeYunlvSecondTicketFirstFiveRowsSchema();

describe("FormRenderer（G8 公共入口）", () => {
  it("默认（readonly 默认 true）：携带数据回显，字段只读不可编辑", () => {
    const wrapper = mount(FormRenderer, {
      props: {
        schema: sampleSchema,
        data: { ...(demoData as Record<string, unknown>) } as never,
      },
    });
    expect(wrapper.text()).toContain("云南铝业股份有限公司 电气第二种工作票");
    const field = wrapper.find('[data-field="单位"]');
    expect(field.exists()).toBe(true);
    expect(field.text()).toContain("121");
    // 默认只读：contenteditable 未设置
    expect(field.attributes("contenteditable")).toBeUndefined();
  });

  it("options.readonly=false：进入填写态，字段可编辑", () => {
    const wrapper = mount(FormRenderer, {
      props: {
        schema: sampleSchema,
        data: { ...(demoData as Record<string, unknown>) } as never,
        options: { readonly: false },
      },
    });
    const field = wrapper.find('[data-field="单位"]');
    expect(field.exists()).toBe(true);
    expect(field.text()).toContain("121");
    expect(field.attributes("contenteditable")).toBe("true");
  });

  it("options.readonly=true：显式强制只读回显，字段不可编辑", () => {
    const wrapper = mount(FormRenderer, {
      props: {
        schema: sampleSchema,
        data: { ...(demoData as Record<string, unknown>) } as never,
        options: { readonly: true },
      },
    });
    const field = wrapper.find('[data-field="单位"]');
    expect(field.exists()).toBe(true);
    expect(field.text()).toContain("121");
    expect(field.attributes("contenteditable")).toBeUndefined();
  });

  it("填写态：输入触发 field-change 与 update:data，且字段键正确", async () => {
    const wrapper = mount(FormRenderer, {
      props: {
        schema: sampleSchema,
        data: { ...(demoData as Record<string, unknown>) } as never,
        options: { readonly: false },
      },
    });
    const field = wrapper.find('[data-field="单位"]');
    field.element.textContent = "新单位值";
    await field.trigger("blur");

    const fieldChange = wrapper.emitted("field-change");
    const updateData = wrapper.emitted("update:data");
    expect(fieldChange).toBeTruthy();
    expect(fieldChange?.[0]).toEqual(["单位", "新单位值"]);
    expect(updateData).toBeTruthy();
    const payload = updateData?.[0]?.[0] as Record<string, unknown>;
    expect(payload["单位"]).toBe("新单位值");
  });

  it("getFormData()：返回整个表单当前输入数据（与 update:data 同口径）", async () => {
    const wrapper = mount(FormRenderer, {
      props: {
        schema: sampleSchema,
        data: { ...(demoData as Record<string, unknown>) } as never,
        options: { readonly: false },
      },
    });
    // 初始：回显数据中的「单位」= 121
    const exposed0 = wrapper.vm as unknown as { getFormData: () => Record<string, string> };
    expect(exposed0.getFormData()["单位"]).toBe("121");

    // 改一个字段后，getFormData 反映新值
    const field = wrapper.find('[data-field="单位"]');
    field.element.textContent = "新单位值";
    await field.trigger("blur");
    expect(exposed0.getFormData()["单位"]).toBe("新单位值");
  });

  it("消费页流程：parseTolerantFormSchemaV2(json).schema 可直接喂给 FormRenderer 回显", () => {
    const json = JSON.stringify(sampleSchema);
    const result = parseTolerantFormSchemaV2(json);
    expect(result.ok).toBe(true);
    expect(result.schema).not.toBeNull();

    const wrapper = mount(FormRenderer, {
      props: {
        schema: result.schema as never,
        data: { ...(demoData as Record<string, unknown>) } as never,
      },
    });
    expect(wrapper.text()).toContain("云南铝业股份有限公司 电气第二种工作票");
    const field = wrapper.find('[data-field="单位"]');
    expect(field.exists()).toBe(true);
    expect(field.text()).toContain("121");
  });

  it("options.bare：传入 bare 时去掉画布外壳修饰类", () => {
    const wrapper = mount(FormRenderer, {
      props: {
        schema: sampleSchema,
        data: { ...(demoData as Record<string, unknown>) } as never,
        options: { bare: true },
      },
    });
    expect(wrapper.find(".grid-form-canvas--bare").exists()).toBe(true);
  });

  it("D2：向消费页暴露 print()，交给内核做局部打印（消费页无需自己 window.print）", () => {
    printCtorSpy.mockClear();
    const wrapper = mount(FormRenderer, { props: { schema: sampleSchema } });
    const exposed = wrapper.vm as unknown as { print: () => boolean };
    expect(typeof exposed.print).toBe("function");
    expect(exposed.print()).toBe(true);
    expect(printCtorSpy).toHaveBeenCalledTimes(1);
    // 只把本次实例的纸张交给插件（实例作用域选择器，避免同页多个 FormRenderer 串打）。
    const options = printCtorSpy.mock.calls[0][0] as { el: string };
    expect(options.el).toMatch(/^\[data-v2-print-scope="\d+"\]$/);
  });
});

describe("FormRenderer validate()（P9.2c 必填校验，rules 经 options 注入）", () => {
  const exposedOf = (wrapper: ReturnType<typeof mount>) =>
    wrapper.vm as unknown as { validate: () => string[] };

  it("rules 声明必填：空值/缺失返回字段名；补齐数据后返回空数组", async () => {
    const wrapper = mount(FormRenderer, {
      props: {
        schema: sampleSchema,
        data: { 单位: "" },
        options: {
          readonly: false,
          rules: { 单位: { required: true }, 编号: { required: true } },
        },
      },
    });
    expect(exposedOf(wrapper).validate()).toEqual(["单位", "编号"]);

    await wrapper.setProps({ data: { 单位: "x", 编号: "y" } });
    expect(exposedOf(wrapper).validate()).toEqual([]);
  });

  it("未声明 required 的字段不参与校验；rules 缺省 → 恒通过（向后兼容）", () => {
    const partial = mount(FormRenderer, {
      props: {
        schema: sampleSchema,
        data: {},
        options: { readonly: false, rules: { 备注: {} } },
      },
    });
    expect(exposedOf(partial).validate()).toEqual([]);

    const none = mount(FormRenderer, {
      props: { schema: sampleSchema, data: {}, options: { readonly: false } },
    });
    expect(exposedOf(none).validate()).toEqual([]);
  });

  it("rules 与 fieldPermissions 叠加：HIDDEN 脱敏不影响校验（真实值在数据侧）", () => {
    const wrapper = mount(FormRenderer, {
      props: {
        schema: sampleSchema,
        data: { 单位: "121" },
        options: {
          readonly: false,
          rules: { 单位: { required: true } },
          fieldPermissions: { 单位: "HIDDEN" },
        },
      },
    });
    // DOM 中显示 ***（脱敏），但响应式数据仍是真实值 → 校验通过
    expect(wrapper.find('[data-field="单位"]').text()).toBe("***");
    expect(exposedOf(wrapper).validate()).toEqual([]);
  });
});
