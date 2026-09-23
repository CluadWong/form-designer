import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import FormRenderer from "@/components/renderer-v2/FormRenderer.vue";
import { collectFieldValues } from "@/components/renderer-v2/collectFieldValues";
import { collectSchemaFields } from "@/engine-v2/derivation";
import { parseFormSchemaV2 } from "@/types";
import type { FormDataV2 } from "@/types";
import exportedSchema from "@/fixtures/formdesigner-schema-v2-sign-table.json";

/**
 * 设计器**真实导出**的 HTML 复杂表（收工/开工签名时间表，36 格原生 data-field）
 * 端到端闭环：Schema JSON → 字段清单 → 渲染 → 逐格输入 → 保存取数 → 只读回显。
 *
 * 夹具来源：设计器导出 `src/dev/formdesigner-schema-v2-1790152686043.json`
 * ——`.gitignore` 刻意排除 `src/dev/formdesigner-schema-v2-*.json`（导出调试样例不入库），
 * 故固化一份到 `src/fixtures/` 作为可版本化的回归网，避免测试依赖未跟踪文件。
 *
 * 三处口径必须同时成立：
 * ① `collectSchemaFields` 收得到这 36 个字段（权限 / 必填 / 宿主清单的前提）；
 * ② 填写态每格 contenteditable=true 且**失焦**经 `update:data` 回写一次（逐键不回写）；
 * ③ `getFormData()` 与 `collectFieldValues()` 两条取数路径都能拿到值；
 * ④ 只读态（view）同样回显值，只是不可编辑。
 */
const schema = parseFormSchemaV2(exportedSchema as unknown);

/** 按片段内出现顺序的 36 个字段名（= 3 行 × 12 列）。 */
const ALL_FIELDS = [
  "收工月1",
  "收工日1",
  "收工时1",
  "收工分1",
  "收工负责人1",
  "收工许可人1",
  "开工月1",
  "开工日1",
  "开工时1",
  "开工分1",
  "开工负责人1",
  "开工许可人1",
  "收工月2",
  "收工日2",
  "收工时2",
  "收工分2",
  "收工负责人2",
  "收工许可人2",
  "开工月2",
  "开工日2",
  "开工时2",
  "开工分2",
  "开工负责人2",
  "开工许可人2",
  "收工月3",
  "收工日3",
  "收工时3",
  "收工分3",
  "收工负责人3",
  "收工许可人3",
  "开工月3",
  "开工日3",
  "开工时3",
  "开工分3",
  "开工负责人3",
  "开工许可人3",
];

function mountForm(readonly: boolean, data: FormDataV2 = {}) {
  return mount(FormRenderer, {
    props: { schema, data, options: { readonly } },
  });
}

function shadowOf(wrapper: ReturnType<typeof mountForm>): ShadowRoot {
  const host = wrapper.find(".layout-html").element as HTMLElement;
  return host.shadowRoot!;
}

function expose<T>(wrapper: ReturnType<typeof mountForm>, key: string): T {
  return (wrapper.vm as unknown as Record<string, T>)[key];
}

describe("HTML 复杂表（设计器真实导出 JSON）", () => {
  it("字段清单：36 个 HTML 内字段全部入册（kind=html-field，顺序 = 片段内出现顺序）", () => {
    const infos = collectSchemaFields(schema);
    expect(infos).toHaveLength(36);
    expect(infos.map((info) => info.key)).toEqual(ALL_FIELDS);
    expect(infos.every((info) => info.kind === "html-field")).toBe(true);
  });

  it("填写态：36 格全部 contenteditable=true，逐格失焦并入 update:data", async () => {
    const wrapper = mountForm(false);
    const shadow = shadowOf(wrapper);
    expect(shadow.querySelectorAll('[data-field][contenteditable="true"]')).toHaveLength(36);

    const first = shadow.querySelector('[data-field="收工月1"]') as HTMLElement;
    first.textContent = "09";
    first.dispatchEvent(new Event("focusout", { bubbles: true }));
    const last = shadow.querySelector('[data-field="开工许可人3"]') as HTMLElement;
    last.textContent = "张三";
    last.dispatchEvent(new Event("focusout", { bubbles: true }));

    const lastPayload = wrapper.emitted("update:data")?.at(-1)?.[0] as FormDataV2;
    expect(lastPayload).toMatchObject({ 收工月1: "09", 开工许可人3: "张三" });
  });

  it("逐键不回写：36 格敲字符期间 update:data 一次都不发（保存时才取值）", async () => {
    const wrapper = mountForm(false);
    const shadow = shadowOf(wrapper);
    const cell = shadow.querySelector('[data-field="收工月1"]') as HTMLElement;
    cell.textContent = "0";
    cell.dispatchEvent(new Event("input", { bubbles: true }));
    cell.textContent = "09";
    cell.dispatchEvent(new Event("input", { bubbles: true }));
    expect(wrapper.emitted("update:data")).toBeUndefined();
    // 未失焦也取得到实时值（DOM 即真相源）
    expect(collectFieldValues(wrapper.find(".layout-html").element)["收工月1"]).toBe("09");
  });

  it("端到端：失焦回写触发 data 变化后，单元格元素不被重建（真实浏览器掉焦点防线）", async () => {
    const wrapper = mountForm(false);
    const shadow = shadowOf(wrapper);
    const cell = shadow.querySelector('[data-field="收工月1"]') as HTMLElement;
    cell.textContent = "09";
    cell.dispatchEvent(new Event("focusout", { bubbles: true }));
    await nextTick();
    await nextTick();
    // 分页重算会产出「等值但身份全新」的节点对象；注入必须幂等，否则元素被换掉 ⇒ 掉焦点
    expect(shadow.querySelector('[data-field="收工月1"]')).toBe(cell);
    expect(cell.getAttribute("contenteditable")).toBe("true");
  });

  it("保存取数：getFormData()（响应式）与 collectFieldValues()（DOM 遍历）同口径", async () => {
    const wrapper = mountForm(false);
    const shadow = shadowOf(wrapper);
    for (const [field, value] of [
      ["收工月2", "08"],
      ["收工日2", "31"],
      ["开工负责人2", "李四"],
    ] as const) {
      const cell = shadow.querySelector(`[data-field="${field}"]`) as HTMLElement;
      cell.textContent = value;
      cell.dispatchEvent(new Event("focusout", { bubbles: true }));
    }
    const fromState = expose<() => FormDataV2>(wrapper, "getFormData")();
    expect(fromState).toMatchObject({ 收工月2: "08", 收工日2: "31", 开工负责人2: "李四" });

    const fromDom = collectFieldValues(wrapper.find(".layout-html").element);
    // DOM 遍历是「按单元格实况采集」：36 格全在（未填的为空串），已填的取到值
    expect(Object.keys(fromDom)).toHaveLength(36);
    expect(fromDom).toMatchObject({ 收工月2: "08", 收工日2: "31", 开工负责人2: "李四" });
  });

  it("只读回显（view 模式）：contenteditable=false，但 36 格值照常进 DOM", () => {
    const data: FormDataV2 = { 收工月1: "09", 开工许可人3: "张三" };
    const wrapper = mountForm(true, data);
    const shadow = shadowOf(wrapper);
    expect(shadow.querySelectorAll('[data-field][contenteditable="false"]')).toHaveLength(36);
    expect(shadow.querySelectorAll('[data-field][contenteditable="true"]')).toHaveLength(0);
    expect((shadow.querySelector('[data-field="收工月1"]') as HTMLElement).textContent).toBe("09");
    expect((shadow.querySelector('[data-field="开工许可人3"]') as HTMLElement).textContent).toBe(
      "张三",
    );
    expect(collectFieldValues(wrapper.find(".layout-html").element)).toMatchObject(data);
  });

  it("必填校验：HTML 内字段可直接作 rules 键（validate 返回未填字段名）", () => {
    const wrapper = mount(FormRenderer, {
      props: {
        schema,
        data: { 收工月1: "09" },
        options: { readonly: false, rules: { 收工月1: { required: true }, 开工日1: { required: true } } },
      },
    });
    expect(expose<() => string[]>(wrapper, "validate")()).toEqual(["开工日1"]);
  });
});
