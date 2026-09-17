import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import HtmlBlock from "@/components/renderer-v2/HtmlBlock.vue";
import { collectFieldValues } from "@/components/renderer-v2/collectFieldValues";
import type { FieldPermissionV2, FormDataV2, HtmlNodeV2 } from "@/types";

/**
 * P9.2d HTML 模块权限边界（方案 A 原型）：HTML 片段内的 {{field}} 占位在填写态渲染为
 * 可编辑 input、READ 渲染只读 input、HIDDEN 渲染 *** 脱敏 span；输入经 field-change 回写；
 * 采集穿透 Shadow DOM 读回 input 值。设计态（无 data）渲染占位 span、不渲染 input。
 */
function htmlNode(html: string): HtmlNodeV2 {
  return { id: "html-1", type: "html", html };
}

function mountHtml(
  html: string,
  opts: {
    data?: FormDataV2;
    readonly?: boolean;
    fieldPermissions?: Record<string, FieldPermissionV2>;
  } = {},
) {
  return mount(HtmlBlock, {
    props: {
      node: htmlNode(html),
      ...(opts.data !== undefined ? { data: opts.data } : {}),
      ...(opts.readonly !== undefined ? { readonly: opts.readonly } : {}),
      ...(opts.fieldPermissions ? { fieldPermissions: opts.fieldPermissions } : {}),
    },
  });
}

function shadowOf(wrapper: ReturnType<typeof mountHtml>): ShadowRoot {
  return wrapper.find(".layout-html").element.shadowRoot!;
}

describe("HTML 模块字段绑定（P9.2d 方案 A 原型）", () => {
  it("填写态 EDIT：{{field}} 渲染为可编辑 input，输入 emit field-change", () => {
    const wrapper = mountHtml('<table><tr><td>{{签字}}</td></tr></table>', { data: {} });
    const input = shadowOf(wrapper).querySelector(
      'input[data-bind="签字"]',
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = "张三";
    input.dispatchEvent(new Event("input"));
    expect(wrapper.emitted("field-change")).toEqual([["签字", "张三"]]);
  });

  it("READ 权限：渲染 readonly input，不产生 field-change", () => {
    const wrapper = mountHtml('<p>{{签字}}</p>', {
      data: {},
      fieldPermissions: { 签字: "READ" },
    });
    const input = shadowOf(wrapper).querySelector(
      'input[data-bind="签字"]',
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.hasAttribute("readonly")).toBe(true);
    input.value = "李四";
    input.dispatchEvent(new Event("input"));
    expect(wrapper.emitted("field-change")).toBeUndefined();
  });

  it("HIDDEN 权限：渲染 *** 脱敏 span，无 input", () => {
    const wrapper = mountHtml('<p>{{签字}}</p>', {
      data: {},
      fieldPermissions: { 签字: "HIDDEN" },
    });
    const shadow = shadowOf(wrapper);
    const masked = shadow.querySelector(
      'span[data-bind="签字"][data-masked]',
    ) as HTMLElement;
    expect(masked).toBeTruthy();
    expect(masked.textContent).toBe("***");
    expect(shadow.querySelector('input[data-bind="签字"]')).toBeNull();
  });

  it("设计态（无 data）：渲染占位 span，不渲染 input（设计器靠它选中片段）", () => {
    const wrapper = mountHtml('<p>{{签字}}</p>');
    const shadow = shadowOf(wrapper);
    const span = shadow.querySelector('span[data-bind="签字"]') as HTMLElement;
    expect(span).toBeTruthy();
    expect(shadow.querySelector('input[data-bind="签字"]')).toBeNull();
  });

  it("设计态（无 data）：原生 [data-field] <p> contenteditable=true（可就地输入看交互，不回写）", () => {
    const wrapper = mountHtml('<p contenteditable data-field="姓名"></p>');
    const p = shadowOf(wrapper).querySelector('p[data-field="姓名"]') as HTMLElement;
    expect(p).toBeTruthy();
    expect(p.getAttribute("contenteditable")).toBe("true");
    // 设计态编辑不应触发 field-change（占位不回写 schema，与 P 字段同口径）
    p.textContent = "张三";
    p.dispatchEvent(new Event("input"));
    expect(wrapper.emitted("field-change")).toBeUndefined();
  });

  it("采集穿透 Shadow DOM：读回填写态 input 值；HIDDEN 无 baseData 时省略", () => {
    const wrapper = mountHtml(
      '<table><tr><td>{{开工月}}</td><td>{{开工日}}</td></tr></table>',
      {
        data: { 开工月: "09", 开工日: "08" },
        fieldPermissions: { 开工月: "EDIT", 开工日: "HIDDEN" },
      },
    );
    const result = collectFieldValues(wrapper.find(".layout-html").element);
    expect(result["开工月"]).toBe("09");
    // HIDDEN 脱敏 span，无 baseData 回源 → 省略（不把 *** 当真值采回）
    expect(result["开工日"]).toBeUndefined();
  });

  it("采集 HIDDEN 带 baseData：回源真实值（本机保存数据循环不丢值）", () => {
    const wrapper = mountHtml('<p>{{开工日}}</p>', {
      data: { 开工日: "08" },
      fieldPermissions: { 开工日: "HIDDEN" },
    });
    const result = collectFieldValues(wrapper.find(".layout-html").element, {
      baseData: { 开工日: "08" },
    });
    expect(result["开工日"]).toBe("08");
  });
});
