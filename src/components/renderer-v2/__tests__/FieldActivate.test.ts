import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import GridSchemaNode from "@/components/renderer-v2/GridSchemaNode.vue";
import FormRenderer from "@/components/renderer-v2/FormRenderer.vue";
import type {
  FieldActivateV2,
  FieldPNodeV2,
  FormNodeV2,
  FormSchemaV2,
  GridNodeV2,
} from "@/types";
import { makeYunlvSecondTicketFirstFiveRowsSchema } from "@/dev/yunlv-second-ticket-first-five-rows";

/**
 * 字段触发与「额外属性」（2026-09-15 用户拍板：内核少管业务）：
 * - 内核只持有 1 bit —— 字段的 `interactive`（点击字段要不要通知宿主）；**控件类型不进内核**，
 *   它是开放集（date / time / date-time / 宿主自定义…），由 `params` 原样承载；
 * - 配了 `interactive` 的字段：填写态**点击字段元素本身** emit `field-activate`，宿主据
 *   `payload.params` 自行召唤外部组件并在回调里回写 data（内核不实现弹窗、不解释 params 键）；
 * - 设计态 / 只读态 / 未配 `interactive` 不触发；就地输入语义不变（点击与输入并存）；
 * - `params` 渲染为标签上的 HTML 属性，黑名单键（`on*` / `data-*` / 保留属性）被过滤——
 *   过滤规则单测见 `src/utils/__tests__/node-params.test.ts`。
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

/** 最小格子：Grid(1 行 1 格) 内放给定子节点（字段 p 直接从该结构渲染）。 */
function gridNode(children: FormNodeV2[]): GridNodeV2 {
  return {
    id: "grid-1",
    type: "grid",
    border: "none",
    rows: [
      {
        id: "row-1",
        type: "grid-row",
        height: 1,
        cells: [{ id: "cell-1", type: "grid-cell", width: "1fr", children }],
      },
    ],
  };
}

function mountGrid(children: FormNodeV2[], mode?: "design" | "preview", readonly = false) {
  return mount(GridSchemaNode, {
    props: {
      node: gridNode(children),
      baseRowHeight: 8,
      ...(mode ? { mode } : {}),
      ...(mode === "preview" ? { data: {} } : {}),
      readonly,
    },
  });
}

describe("字段触发（点击字段 → field-activate）", () => {
  it("填写态 + interactive：点击字段 emit field-activate，载荷含 nodeId / field / params", async () => {
    const wrapper = mountGrid(
      [fieldNode({ interactive: true, params: { action: "datePicker" } })],
      "preview",
    );
    const field = wrapper.find('[data-field="测试字段"]');
    expect(field.exists()).toBe(true);

    await field.trigger("click");
    const emitted = wrapper.emitted("field-activate");
    expect(emitted).toHaveLength(1);
    const payload = emitted?.[0]?.[0] as FieldActivateV2;
    expect(payload.nodeId).toBe("field-1");
    expect(payload.field).toBe("测试字段");
    // 内核只透传：控件类型（宿主约定的键）就在 params 里，内核不认识它
    expect(payload.params).toEqual({ action: "datePicker" });
  });

  it("设计态：点击字段不触发（设计页保持纯设计用途）", async () => {
    const wrapper = mountGrid(
      [fieldNode({ interactive: true, params: { action: "datePicker" } })],
      "design",
    );
    await wrapper.find('[data-field="测试字段"]').trigger("click");
    expect(wrapper.emitted("field-activate")).toBeUndefined();
  });

  it("只读态：点击字段不触发", async () => {
    const wrapper = mountGrid(
      [fieldNode({ interactive: true, params: { action: "datePicker" } })],
      "preview",
      true,
    );
    await wrapper.find('[data-field="测试字段"]').trigger("click");
    expect(wrapper.emitted("field-activate")).toBeUndefined();
  });

  it("未配 interactive（或显式 false）：点击不触发（就地输入不受影响）", async () => {
    const none = mountGrid([fieldNode()], "preview");
    await none.find('[data-field="测试字段"]').trigger("click");
    expect(none.emitted("field-activate")).toBeUndefined();

    const off = mountGrid([fieldNode({ interactive: false })], "preview");
    await off.find('[data-field="测试字段"]').trigger("click");
    expect(off.emitted("field-activate")).toBeUndefined();
  });

  it("复合字段（前/后标签）：点击字段任一区域均触发", async () => {
    const wrapper = mountGrid(
      [fieldNode({ interactive: true, prefix: "共", suffix: "人" })],
      "preview",
    );
    await wrapper.find('[data-field="测试字段"]').trigger("click");
    expect(wrapper.emitted("field-activate")).toHaveLength(1);
  });
});

describe("额外属性（params）渲染为标签属性", () => {
  it("字段的 params 原样落到字段标签上（含日期先后校验等自定义键）", () => {
    const wrapper = mountGrid([
      fieldNode({
        interactive: true,
        params: {
          action: "datePicker",
          "date-validate": "after:计划工作时间_1",
        },
      }),
    ]);
    const field = wrapper.find('[data-field="测试字段"]');
    expect(field.attributes("action")).toBe("datePicker");
    expect(field.attributes("date-validate")).toBe("after:计划工作时间_1");
  });

  it("黑名单键被过滤：on* / data-* / 保留属性都不落 DOM", () => {
    const wrapper = mountGrid([
      fieldNode({
        params: {
          onclick: "alert(1)",
          "data-node-id": "hacked",
          class: "evil",
          action: "uploadImg",
        },
      }),
    ]);
    const field = wrapper.find('[data-field="测试字段"]');
    expect(field.attributes("action")).toBe("uploadImg");
    expect(field.attributes("onclick")).toBeUndefined();
    expect(field.attributes("class")).not.toContain("evil");
    // 节点寻址属性仍由内核自己写（未被 params 覆盖）
    expect(field.attributes("data-node-id")).toBe("field-1");
  });

  it("非字段节点（文本）同样可配 params，落到自身根标签", () => {
    const wrapper = mountGrid([
      { id: "text-1", type: "text", text: "固定文本", params: { role: "note" } },
    ]);
    expect(wrapper.find(".layout-text").attributes("role")).toBe("note");
  });
});

describe("FormRenderer 事件透传（端到端）", () => {
  it("schema 中 interactive 字段：填写态点击字段 → re-emit field-activate，宿主可读 params", async () => {
    const schema: FormSchemaV2 = makeYunlvSecondTicketFirstFiveRowsSchema();
    // 给「单位」字段配置「点击触发 + 宿主约定的控件类型」（模拟设计器输出的模板）
    const unit = schema.pages[0].children.find(
      c => c.type === "grid" && c.id === "ticket-layout",
    );
    if (unit?.type !== "grid") throw new Error("fixture grid missing");
    const field = unit.rows
      .flatMap(r => r.cells)
      .flatMap(c => c.children)
      .find(n => n.type === "p" && n.id === "unit-field");
    if (field?.type !== "p") throw new Error("fixture field missing");
    field.interactive = true;
    field.params = { action: "datePicker" };

    const wrapper = mount(FormRenderer, {
      props: { schema, data: {}, options: { readonly: false } },
    });
    await wrapper.find('[data-field="单位"]').trigger("click");
    const emitted = wrapper.emitted("field-activate");
    expect(emitted).toHaveLength(1);
    const payload = emitted?.[0]?.[0] as FieldActivateV2;
    expect(payload.field).toBe("单位");
    expect(payload.params?.action).toBe("datePicker");
  });
});
