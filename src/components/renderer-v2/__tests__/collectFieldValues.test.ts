import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import GridFormRenderer from "@/components/renderer-v2/GridFormRenderer.vue";
import GridSchemaNode from "@/components/renderer-v2/GridSchemaNode.vue";
import { makeYunlvSecondTicketFirstFiveRowsSchema } from "@/dev/yunlv-second-ticket-first-five-rows";
import demoData from "@/dev/demoData";
import { collectFieldValues } from "@/components/renderer-v2";
import type { CollectFieldValuesOptions } from "@/components/renderer-v2/collectFieldValues";
import type { FieldPNodeV2 } from "@/types";

describe("collectFieldValues DOM 遍历采集（十续）", () => {
  it("遍历渲染 DOM 收集字段值，键与 data 一致", () => {
    const wrapper = mount(GridFormRenderer, {
      props: { schema: makeYunlvSecondTicketFirstFiveRowsSchema(), data: demoData },
    });
    const values = collectFieldValues(wrapper.element);
    expect(values["单位"]).toContain("121");
    expect(values["工作负责人（监护人）"]).toContain("121");
    // 表格逐行字段也应被采集
    expect(values["工作地点_1"]).toBeDefined();
    expect(values["工作内容_1"]).toBeDefined();
  });

  it("编辑后通过 DOM 取到最新值（不依赖 emit 实时回写）", () => {
    const wrapper = mount(GridFormRenderer, {
      props: { schema: makeYunlvSecondTicketFirstFiveRowsSchema(), data: { 单位: "旧值" } },
    });
    const field = wrapper.find('[data-field="单位"]');
    field.element.textContent = "新值";
    const values = collectFieldValues(wrapper.element);
    expect(values["单位"]).toBe("新值");
  });

  it("表格节点本身不是字段：表级 field 不得被采集成整表文本（2026-09-11）", () => {
    const wrapper = mount(GridFormRenderer, {
      props: { schema: makeYunlvSecondTicketFirstFiveRowsSchema(), data: demoData },
    });
    const values = collectFieldValues(wrapper.element);
    // 此前 <table data-field="工作任务"> 会让采集器把整张表 innerText
    // （表头标题拼 \n，"工作地点或地段\n工作内容"）当成一个字段值
    expect(values["工作任务"]).toBeUndefined();
    // 派生的逐行字段照常采集
    expect(values["工作地点_1"]).toBeDefined();
    expect(values["工作内容_1"]).toBeDefined();
  });
});

/**
 * 签名字段（`FieldPNodeV2.valueType === "image"`）的取值链路（2026-09-30）。
 *
 * 修复的既有缺陷：签名值不在容器文本里、而在 `img.layout-p__sign` 的 src 上，而采集器
 * 只遍历 `[data-field]` 元素（图片身上没有该属性），于是一律采成**空串**——宿主只要用
 * `collectFieldValues` 回写保存，签名就被抹掉。改为在容器上把签名图聚合成 `string[]`。
 */
describe("collectFieldValues · 签名图字段（多人签名）", () => {
  const A = "data:image/png;base64,AAAA";
  const B = "data:image/png;base64,BBBB";

  function signNode(over: Partial<FieldPNodeV2> = {}): FieldPNodeV2 {
    return {
      id: "sign-1",
      type: "p",
      mode: "field",
      field: "签名",
      prefix: "负责人签名：",
      underline: true,
      valueType: "image",
      ...over,
    };
  }

  function collect(
    node: FieldPNodeV2,
    data: Record<string, string | string[]>,
    extra: {
      options?: CollectFieldValuesOptions;
      /** 注入字段级权限（脱敏用例必须真脱敏：`maskHidden` 只对 `.layout-p--hidden` 生效）。 */
      permissions?: Record<string, string>;
    } = {},
  ) {
    const wrapper = mount(GridSchemaNode, {
      props: {
        node,
        baseRowHeight: 8,
        mode: "preview",
        readonly: false,
        data: data as never,
        ...(extra.permissions ? { fieldPermissions: extra.permissions as never } : {}),
      },
    });
    return collectFieldValues(wrapper.element as unknown as ParentNode, extra.options ?? {});
  }

  it("单张：采成只含一个地址的数组（此前是空串 → 保存即丢签名）", () => {
    expect(collect(signNode(), { 签名: A })).toEqual({ 签名: [A] });
  });

  it("多张：按 DOM 顺序聚成数组（与渲染顺序一致）", () => {
    expect(collect(signNode(), { 签名: [A, B] })).toEqual({ 签名: [A, B] });
  });

  it("非复合字段（无前标签）同样可采集", () => {
    expect(collect(signNode({ prefix: undefined }), { 签名: [A, B] })).toEqual({ 签名: [A, B] });
  });

  it("maxCount 之外的图不渲染，也不随值采集", () => {
    expect(collect(signNode({ maxCount: 1 }), { 签名: [A, B] })).toEqual({ 签名: [A] });
  });

  it("空态不伪造地址", () => {
    expect(collect(signNode(), { 签名: "" })).toEqual({ 签名: "" });
  });

  it("脱敏导出（maskHidden）：采成 ***，真实地址不进 DOM", () => {
    const masked = collect(
      signNode(),
      { 签名: [A, B] },
      { permissions: { 签名: "HIDDEN" }, options: { maskHidden: true } },
    );
    expect(masked).toEqual({ 签名: "***" });
  });

  it("脱敏回源（本机保存）：从 baseData 回源真实值，且**保持数组形态**", () => {
    // 此前一律 `String(real)`，数组会被拼成 "url1,url2" —— 保存一次就把多值损坏
    const values = collect(
      signNode(),
      { 签名: [A, B] },
      { permissions: { 签名: "HIDDEN" }, options: { baseData: { 签名: [A, B] } as never } },
    );
    expect(values).toEqual({ 签名: [A, B] });
    expect(Array.isArray(values["签名"])).toBe(true);
  });
});
