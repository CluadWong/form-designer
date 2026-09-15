import { describe, expect, it } from "vitest";
import { isParamNameAllowed, resolveNodeParamAttrs } from "@/utils/node-params";

/**
 * 额外属性（params）黑名单过滤：内核把 params 原样透传成 HTML 属性，
 * 因此必须先挡掉事件绑定 / 内核寻址 / 保留属性 / 大写驼峰名，否则是一条注入通道。
 */
describe("额外属性名白名单（isParamNameAllowed）", () => {
  it("允许宿主自定义的小写属性名（含 - 与 _）", () => {
    expect(isParamNameAllowed("action")).toBe(true);
    expect(isParamNameAllowed("date-validate")).toBe(true);
    expect(isParamNameAllowed("picker_kind")).toBe(true);
    expect(isParamNameAllowed("a1")).toBe(true);
  });

  it("拒绝事件绑定（on*）", () => {
    expect(isParamNameAllowed("onclick")).toBe(false);
    expect(isParamNameAllowed("onmouseenter")).toBe(false);
    expect(isParamNameAllowed("on")).toBe(false);
  });

  it("拒绝大写驼峰名（Vue 会按 DOM property 设置，如 innerHTML / textContent）", () => {
    expect(isParamNameAllowed("innerHTML")).toBe(false);
    expect(isParamNameAllowed("ObjectFit")).toBe(false);
    expect(isParamNameAllowed("DateValidate")).toBe(false);
  });

  it("拒绝内核寻址命名空间（data-*）", () => {
    expect(isParamNameAllowed("data-node-id")).toBe(false);
    expect(isParamNameAllowed("data-field")).toBe(false);
  });

  it("拒绝内核自身写入的保留属性", () => {
    for (const name of [
      "id",
      "class",
      "style",
      "field",
      "src",
      "alt",
      "width",
      "height",
      "contenteditable",
      "draggable",
      "hidden",
      "key",
      "ref",
      "is",
      "slot",
    ]) {
      expect(isParamNameAllowed(name)).toBe(false);
    }
  });

  it("拒绝非法字符（冒号命名空间 / 大写 / 数字开头 / 空串）", () => {
    expect(isParamNameAllowed("xlink:href")).toBe(false);
    expect(isParamNameAllowed("Foo")).toBe(false);
    expect(isParamNameAllowed("1abc")).toBe(false);
    expect(isParamNameAllowed("")).toBe(false);
  });
});

describe("resolveNodeParamAttrs", () => {
  it("透传合法键值，保持插入顺序", () => {
    expect(
      resolveNodeParamAttrs({
        action: "datePicker",
        "date-validate": "after:计划工作时间_1",
      }),
    ).toEqual({
      action: "datePicker",
      "date-validate": "after:计划工作时间_1",
    });
  });

  it("静默丢弃黑名单键，保留其余", () => {
    expect(
      resolveNodeParamAttrs({
        onclick: "alert(1)",
        style: "display:none",
        "data-node-id": "hacked",
        innerHTML: "<img onerror=alert(1)>",
        action: "uploadImg",
      }),
    ).toEqual({ action: "uploadImg" });
  });

  it("丢弃空串与非字符串值", () => {
    expect(
      resolveNodeParamAttrs({
        action: "",
        "date-format": "   ",
        mixed: 123 as unknown as string,
      }),
    ).toEqual({ "date-format": "   " });
  });

  it("空 / 缺省 params → 空表（等价于不写任何属性）", () => {
    expect(resolveNodeParamAttrs(undefined)).toEqual({});
    expect(resolveNodeParamAttrs(null)).toEqual({});
    expect(resolveNodeParamAttrs({})).toEqual({});
  });

  it("返回新对象，不回写入参", () => {
    const params = { action: "datePicker" };
    const attrs = resolveNodeParamAttrs(params);
    expect(attrs).not.toBe(params);
    expect(params).toEqual({ action: "datePicker" });
  });
});
