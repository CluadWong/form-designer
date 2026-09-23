import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import HtmlBlock from "@/components/renderer-v2/HtmlBlock.vue";
import { collectFieldValues } from "@/components/renderer-v2/collectFieldValues";
import type { FieldPermissionV2, FormDataV2, HtmlNodeV2 } from "@/types";

/**
 * P9.2d HTML 模块权限边界（方案 A 原型）：HTML 片段内的 {{field}} 占位在填写态渲染为
 * 可编辑 input、READ 渲染只读 input、HIDDEN 渲染 *** 脱敏 span；**失焦经 field-change 回写一次**
 * （逐键不回写，与 P 字段同口径）；采集穿透 Shadow DOM 读回 input 值。设计态（无 data）渲染占位
 * span、不渲染 input。
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
  it("填写态 EDIT：{{field}} 渲染为可编辑 input，失焦 emit field-change", () => {
    const wrapper = mountHtml('<table><tr><td>{{签字}}</td></tr></table>', { data: {} });
    const input = shadowOf(wrapper).querySelector(
      'input[data-bind="签字"]',
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = "张三";
    input.dispatchEvent(new Event("focusout", { bubbles: true }));
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
    input.dispatchEvent(new Event("focusout", { bubbles: true }));
    expect(wrapper.emitted("field-change")).toBeUndefined();
  });

  it("READ 权限 + 原生 [data-field]：contenteditable=false，失焦也不回写", () => {
    const wrapper = mountHtml('<p contenteditable data-field="姓名"></p>', {
      data: {},
      fieldPermissions: { 姓名: "READ" },
    });
    const p = shadowOf(wrapper).querySelector('p[data-field="姓名"]') as HTMLElement;
    expect(p.getAttribute("contenteditable")).toBe("false");
    p.textContent = "李四";
    p.dispatchEvent(new Event("focusout", { bubbles: true }));
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
    p.dispatchEvent(new Event("focusout", { bubbles: true }));
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

/**
 * 只读回显（`readonly` 硬闸门）：只读态**不是**设计态 —— 值必须进 DOM（否则只读票面
 * 全是空格子，导出/采集也丢值），但用户不能改（contenteditable=false / input readonly）。
 * 此外 `readonly` 变化必须重建（可编辑性与输入事件绑定都只在 inject() 里落一次）。
 */
describe("HTML 模块只读回显（readonly 硬闸门）", () => {
  it("只读态：{{field}} 渲染 readonly input 并回显值（值进 DOM，未被跳过采集）", () => {
    const wrapper = mountHtml('<p>{{签字}}</p>', { data: { 签字: "张三" }, readonly: true });
    const shadow = shadowOf(wrapper);
    const input = shadow.querySelector('input[data-bind="签字"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.hasAttribute("readonly")).toBe(true);
    expect(input.value).toBe("张三");
    // 只读态也进 DOM ⇒ 采集（导出 / 复制成新单）不丢值
    expect(collectFieldValues(wrapper.find(".layout-html").element)["签字"]).toBe("张三");
    input.value = "李四";
    input.dispatchEvent(new Event("focusout", { bubbles: true }));
    expect(wrapper.emitted("field-change")).toBeUndefined();
  });

  it("只读态：原生 [data-field] contenteditable=false 且按 data 回显", () => {
    const wrapper = mountHtml('<p contenteditable data-field="姓名"></p>', {
      data: { 姓名: "张三" },
      readonly: true,
    });
    const p = shadowOf(wrapper).querySelector('p[data-field="姓名"]') as HTMLElement;
    expect(p.getAttribute("contenteditable")).toBe("false");
    expect(p.textContent).toBe("张三");
    p.textContent = "李四";
    p.dispatchEvent(new Event("focusout", { bubbles: true }));
    expect(wrapper.emitted("field-change")).toBeUndefined();
  });

  it("只读 → 填写：readonly 变化后重建，contenteditable=true 且失焦 emit field-change", async () => {
    const wrapper = mountHtml('<p contenteditable data-field="姓名"></p>', {
      data: { 姓名: "张三" },
      readonly: true,
    });
    expect(shadowOf(wrapper).querySelector('p[data-field="姓名"]')!.getAttribute("contenteditable")).toBe(
      "false",
    );
    await wrapper.setProps({ readonly: false });
    const p = shadowOf(wrapper).querySelector('p[data-field="姓名"]') as HTMLElement;
    expect(p.getAttribute("contenteditable")).toBe("true");
    p.textContent = "张三改";
    p.dispatchEvent(new Event("focusout", { bubbles: true }));
    expect(wrapper.emitted("field-change")).toEqual([["姓名", "张三改"]]);
  });

  it("填写 → 只读：readonly 变化后回显值、不可编辑、不再 emit", async () => {
    const wrapper = mountHtml('<p contenteditable data-field="姓名"></p>', {
      data: { 姓名: "张三" },
      readonly: false,
    });
    await wrapper.setProps({ readonly: true });
    const p = shadowOf(wrapper).querySelector('p[data-field="姓名"]') as HTMLElement;
    expect(p.getAttribute("contenteditable")).toBe("false");
    expect(p.textContent).toBe("张三");
    p.textContent = "李四";
    p.dispatchEvent(new Event("focusout", { bubbles: true }));
    expect(wrapper.emitted("field-change")).toBeUndefined();
  });

  it("焦点保护：元素为 Shadow 内 activeElement 时外部 data 变化不重写 DOM（不顶光标）", async () => {
    const wrapper = mountHtml('<p contenteditable data-field="姓名"></p>', {
      data: { 姓名: "张三" },
      readonly: false,
    });
    const shadow = shadowOf(wrapper);
    const p = shadow.querySelector('p[data-field="姓名"]') as HTMLElement;
    // jsdom 未实现 ShadowRoot.activeElement，用 defineProperty 直接构造「正在输入」状态
    Object.defineProperty(shadow, "activeElement", { value: p, configurable: true });
    await wrapper.setProps({ data: { 姓名: "张三丰" } });
    expect(p.textContent).toBe("张三");
    Object.defineProperty(shadow, "activeElement", { value: null, configurable: true });
    await wrapper.setProps({ data: { 姓名: "张三丰丰" } });
    expect(p.textContent).toBe("张三丰丰");
  });

  it("焦点保护：{{field}} input 为 activeElement 时外部 data 变化不重写 value", async () => {
    const wrapper = mountHtml("<p>{{签字}}</p>", { data: { 签字: "张三" }, readonly: false });
    const shadow = shadowOf(wrapper);
    const input = shadow.querySelector('input[data-bind="签字"]') as HTMLInputElement;
    Object.defineProperty(shadow, "activeElement", { value: input, configurable: true });
    await wrapper.setProps({ data: { 签字: "张三丰" } });
    expect(input.value).toBe("张三");
    Object.defineProperty(shadow, "activeElement", { value: null, configurable: true });
    await wrapper.setProps({ data: { 签字: "张三丰丰" } });
    expect(input.value).toBe("张三丰丰");
  });
});

/**
 * 「敲 1 个字符就掉焦点」回归锁（真实 Chromium 实测复现过）：
 * 真实浏览器里 `node` / `fieldPermissions` 的**对象身份**会因分页重算而每次输入都变，
 * 若 `inject()` 无条件重写 `shadowRoot.innerHTML`，正在输入的 `<p contenteditable>` 会被换掉
 * ⇒ 焦点随元素消失、后续按键全丢。故注入必须由「标记串」把关，而不是 prop 身份。
 */
describe("HTML 模块注入幂等（掉焦点防线）", () => {
  it("node 换成等值新对象：shadow 子树不重建（元素身份不变，焦点不被夺）", async () => {
    const wrapper = mountHtml('<p contenteditable data-field="姓名"></p>', { data: {} });
    const shadow = shadowOf(wrapper);
    const before = shadow.querySelector('p[data-field="姓名"]') as HTMLElement;
    (before as unknown as { __tag: number }).__tag = 1;

    // 等值但身份全新的 node —— 模拟分页重算产出的新对象
    await wrapper.setProps({ node: htmlNode('<p contenteditable data-field="姓名"></p>') });
    await wrapper.setProps({ fieldPermissions: { 姓名: "EDIT" } });

    const after = shadow.querySelector('p[data-field="姓名"]') as HTMLElement;
    expect(after).toBe(before);
    expect((after as unknown as { __tag?: number }).__tag).toBe(1);
  });

  it("node.html 真的变了：仍然重建（幂等不等于冻结）", async () => {
    const wrapper = mountHtml('<p contenteditable data-field="姓名"></p>', { data: {} });
    const shadow = shadowOf(wrapper);
    const before = shadow.querySelector('p[data-field="姓名"]') as HTMLElement;
    await wrapper.setProps({ node: htmlNode('<p contenteditable data-field="签字"></p>') });
    expect(shadow.querySelector('p[data-field="签字"]')).toBeTruthy();
    expect(shadow.querySelector('p[data-field="姓名"]')).toBeNull();
    expect(shadow.querySelector('p[data-field="签字"]')).not.toBe(before);
  });
});

/**
 * 「只在保存时读取 / 回写」契约：输入过程中**逐键不回写**（否则使用方每键重建响应式 data
 * ⇒ 分页重算 + 整树重渲染），只在**失焦**回写一次；保存时的全量读取走 `collectFieldValues`。
 */
describe("HTML 模块取值口径（逐键不回写 / 失焦回写 / DOM 全量读）", () => {
  it("逐键 input 不产生 field-change", () => {
    const wrapper = mountHtml('<p contenteditable data-field="姓名"></p>', {
      data: {},
      readonly: false,
    });
    const p = shadowOf(wrapper).querySelector('p[data-field="姓名"]') as HTMLElement;
    p.textContent = "张";
    p.dispatchEvent(new Event("input", { bubbles: true }));
    p.textContent = "张三";
    p.dispatchEvent(new Event("input", { bubbles: true }));
    expect(wrapper.emitted("field-change")).toBeUndefined();
  });

  it("失焦回写一次，且逐键期间用 collectFieldValues 仍能取到实时值", () => {
    const wrapper = mountHtml('<p contenteditable data-field="姓名"></p>', {
      data: { 姓名: "" },
      readonly: false,
    });
    const p = shadowOf(wrapper).querySelector('p[data-field="姓名"]') as HTMLElement;
    p.textContent = "张三";
    p.dispatchEvent(new Event("input", { bubbles: true }));
    // 未失焦：响应式 data 里还是旧值，但 DOM 已是最新 ⇒ 保存时可全量读取
    expect(wrapper.emitted("field-change")).toBeUndefined();
    expect(collectFieldValues(wrapper.find(".layout-html").element)["姓名"]).toBe("张三");

    p.dispatchEvent(new Event("focusout", { bubbles: true }));
    expect(wrapper.emitted("field-change")).toEqual([["姓名", "张三"]]);
  });

  it("{{field}} 输入框同样逐键不回写、失焦回写", () => {
    const wrapper = mountHtml("<p>{{签字}}</p>", { data: {}, readonly: false });
    const input = shadowOf(wrapper).querySelector('input[data-bind="签字"]') as HTMLInputElement;
    input.value = "李";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(wrapper.emitted("field-change")).toBeUndefined();
    input.value = "李四";
    input.dispatchEvent(new Event("focusout", { bubbles: true }));
    expect(wrapper.emitted("field-change")).toEqual([["签字", "李四"]]);
  });

  it("设计态失焦不回写（占位不落数据）", () => {
    const wrapper = mountHtml('<p contenteditable data-field="姓名"></p>');
    const p = shadowOf(wrapper).querySelector('p[data-field="姓名"]') as HTMLElement;
    p.textContent = "张三";
    p.dispatchEvent(new Event("focusout", { bubbles: true }));
    expect(wrapper.emitted("field-change")).toBeUndefined();
  });
});
