import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import FormRenderer from "@/components/renderer-v2/FormRenderer.vue";
import { collectFieldValues } from "@/components/renderer-v2/collectFieldValues";
import {
  htmlComplexTableData,
  htmlComplexTablePermissions,
  makeHtmlComplexTableSchema,
  makeNativeHtmlComplexTableSchema,
} from "@/dev/html-complex-table";

/**
 * P9.2d 方案 A 端到端：截图里的复杂签名时间表（双层 colspan 表头 + 3 行数据），
 * 用 HTML 模块渲染，验证中文字段名、多行、权限混合（EDIT/READ/HIDDEN）下
 * 填写态渲染 + 失焦 field-change 回写一次（逐键不回写） + 采集穿透 Shadow DOM 全部正确。
 */
describe("HTML 模块复杂签名时间表（P9.2d 方案 A 端到端）", () => {
  function render() {
    return mount(FormRenderer, {
      props: {
        schema: makeHtmlComplexTableSchema(),
        data: { ...htmlComplexTableData },
        options: { readonly: false, fieldPermissions: htmlComplexTablePermissions },
      },
    });
  }

  function shadow(wrapper: ReturnType<typeof render>): ShadowRoot {
    return wrapper.find(".layout-html").element.shadowRoot!;
  }

  it("中文字段名 + 多行：渲染出全部可编辑 input，并按 data 回填", () => {
    const wrapper = render();
    const s = shadow(wrapper);
    // 字段名形如 收工月1（月/日/时/分 + 行号）：3 行 × (收工 4 + 开工 4) = 24 个
    const timeInputs = Array.from(
      s.querySelectorAll<HTMLInputElement>("input[data-bind]"),
    ).filter((inp) => /[月日时分]\d+$/.test(inp.dataset.bind ?? ""));
    expect(timeInputs.length).toBe(24);
    // 数据回填：收工月1 = "09"
    const m1 = s.querySelector<HTMLInputElement>('input[data-bind="收工月1"]')!;
    expect(m1.value).toBe("09");
  });

  it("权限混合：READ 渲染 readonly input、HIDDEN 渲染 ***、EDIT 渲染可写 input", () => {
    const wrapper = render();
    const s = shadow(wrapper);
    // 开工负责人1 = READ → readonly input，值回填
    const readInput = s.querySelector<HTMLInputElement>(
      'input[data-bind="开工负责人1"]',
    )!;
    expect(readInput).toBeTruthy();
    expect(readInput.hasAttribute("readonly")).toBe(true);
    expect(readInput.value).toBe("李四");
    // 收工许可人1 = HIDDEN → *** 脱敏 span，无 input
    const masked = s.querySelector<HTMLElement>(
      'span[data-bind="收工许可人1"][data-masked]',
    )!;
    expect(masked.textContent).toBe("***");
    expect(s.querySelector('input[data-bind="收工许可人1"]')).toBeNull();
    // 收工负责人1 = EDIT（缺省）→ 可写 input
    const editInput = s.querySelector<HTMLInputElement>(
      'input[data-bind="收工负责人1"]',
    )!;
    expect(editInput).toBeTruthy();
    expect(editInput.hasAttribute("readonly")).toBe(false);
  });

  it("填写回写：失焦经 field-change 上抛一次（逐键不回写）", () => {
    const wrapper = render();
    const s = shadow(wrapper);
    const m1 = s.querySelector<HTMLInputElement>('input[data-bind="收工月1"]')!;
    m1.value = "12";
    m1.dispatchEvent(new Event("focusout", { bubbles: true }));
    expect(wrapper.emitted("field-change")).toEqual([["收工月1", "12"]]);
  });

  it("采集穿透 Shadow DOM：读回填写值；HIDDEN 无 baseData 时省略", () => {
    const wrapper = render();
    const result = collectFieldValues(wrapper.element);
    expect(result["收工月1"]).toBe("09"); // EDIT 回填值
    expect(result["开工负责人1"]).toBe("李四"); // READ 回填值（仍采集）
    expect(result["收工许可人1"]).toBeUndefined(); // HIDDEN 脱敏，无 baseData → 省略
  });
});

/**
 * 原生 [data-field] 变体（方案 A-2）：作者直接写 `<p contenteditable data-field>`，
 * 引擎仅按权限设可编辑性/脱敏、按 data 回填。验证与 {{field}} 占位同口径的渲染/回写/采集。
 */
describe("HTML 模块复杂表（原生 data-field 变体）", () => {
  function render() {
    return mount(FormRenderer, {
      props: {
        schema: makeNativeHtmlComplexTableSchema(),
        data: { ...htmlComplexTableData },
        options: { readonly: false, fieldPermissions: htmlComplexTablePermissions },
      },
    });
  }

  function shadow(wrapper: ReturnType<typeof render>): ShadowRoot {
    return wrapper.find(".layout-html").element.shadowRoot!;
  }

  it("中文字段名 + 多行：渲染出全部可编辑 <p data-field>，并按 data 回填", () => {
    const wrapper = render();
    const s = shadow(wrapper);
    const timePs = Array.from(
      s.querySelectorAll<HTMLElement>("p[data-field]"),
    ).filter((p) => /[月日时分]\d+$/.test(p.dataset.field ?? ""));
    expect(timePs.length).toBe(24);
    // EDIT 字段：contenteditable=true 且按 data 回填
    const m1 = s.querySelector<HTMLElement>('p[data-field="收工月1"]')!;
    expect(m1.getAttribute("contenteditable")).toBe("true");
    expect(m1.textContent).toBe("09");
    // 空数据字段（如 收工分1 未提供）→ contenteditable=true、文本为空
    const f1 = s.querySelector<HTMLElement>('p[data-field="收工分1"]')!;
    expect(f1.getAttribute("contenteditable")).toBe("true");
    expect(f1.textContent).toBe("");
  });

  it("权限混合：READ 设 contenteditable=false、HIDDEN 渲染 *** 并标 data-masked", () => {
    const wrapper = render();
    const s = shadow(wrapper);
    // 开工负责人1 = READ → 不可编辑、文本回填
    const readP = s.querySelector<HTMLElement>('p[data-field="开工负责人1"]')!;
    expect(readP.getAttribute("contenteditable")).toBe("false");
    expect(readP.textContent).toBe("李四");
    // 收工许可人1 = HIDDEN → 脱敏 *** + data-masked、不可编辑
    const masked = s.querySelector<HTMLElement>('p[data-field="收工许可人1"]')!;
    expect(masked.hasAttribute("data-masked")).toBe(true);
    expect(masked.textContent).toBe("***");
    expect(masked.getAttribute("contenteditable")).toBe("false");
  });

  it("填写回写：contenteditable <p> 失焦经 field-change 上抛一次（逐键不回写）", () => {
    const wrapper = render();
    const s = shadow(wrapper);
    const m1 = s.querySelector<HTMLElement>('p[data-field="收工月1"]')!;
    m1.textContent = "12";
    m1.dispatchEvent(new Event("focusout", { bubbles: true }));
    expect(wrapper.emitted("field-change")).toEqual([["收工月1", "12"]]);
  });

  it("采集穿透 Shadow DOM：读回原生 [data-field] 文本；HIDDEN 无 baseData 时省略", () => {
    const wrapper = render();
    const result = collectFieldValues(wrapper.element);
    expect(result["收工月1"]).toBe("09"); // EDIT 回填文本
    expect(result["开工负责人1"]).toBe("李四"); // READ 回填文本（仍采集）
    expect(result["收工许可人1"]).toBeUndefined(); // HIDDEN 脱敏，无 baseData → 省略
  });
});
