import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import TableInspector from "@/components/designer/inspectors/TableInspector.vue";
import { createTableNodeV2 } from "@/types";
import type { TableNodeV2 } from "@/types";
import type { SchemaEdits } from "@/components/designer/composables/useSchemaEdits";

/** 占位 api：默认所有编辑动作都是空操作，可按用例替换单个方法。 */
function stubApi(overrides: Partial<Record<keyof SchemaEdits, unknown>> = {}): SchemaEdits {
  return new Proxy(overrides as Record<string | symbol, unknown>, {
    get: (target, key) => target[key] ?? (() => undefined),
  }) as unknown as SchemaEdits;
}

function mountInspector(node: TableNodeV2, api = stubApi()) {
  return mount(TableInspector, { props: { node, api } });
}

describe("TableInspector 显示表头开关", () => {
  it("默认勾选（缺省 true），且位于「跨页重复表头」左侧的同一行", () => {
    const wrapper = mountInspector(createTableNodeV2());
    const show = wrapper.find('[data-table-show-header="true"]');
    const repeat = wrapper.find('[data-table-repeat-header="true"]');

    expect((show.element as HTMLInputElement).checked).toBe(true);

    // 面板用两列网格排布：「显示表头」占第 3 格、「跨页重复表头」占第 4 格 → 同一行且在其左侧
    const gridBox = show.element.closest(".v2-grid-dimensions");
    expect(gridBox).not.toBeNull();
    expect(repeat.element.closest(".v2-grid-dimensions")).toBe(gridBox);
    const labels = Array.from(gridBox!.querySelectorAll("label > span")).map((el) =>
      el.textContent?.trim(),
    );
    expect(labels.indexOf("跨页重复表头")).toBe(labels.indexOf("显示表头") + 1);
  });

  it("showHeader=false → 不勾选，且「跨页重复表头」被禁用（没有表头可重复）", () => {
    const wrapper = mountInspector({ ...createTableNodeV2(), showHeader: false });
    const show = wrapper.find('[data-table-show-header="true"]');
    const repeat = wrapper.find('[data-table-repeat-header="true"]');

    expect((show.element as HTMLInputElement).checked).toBe(false);
    expect((repeat.element as HTMLInputElement).disabled).toBe(true);
  });

  it("showHeader 显式为 true 时同样勾选（与缺省一致）", () => {
    const wrapper = mountInspector({ ...createTableNodeV2(), showHeader: true });
    const show = wrapper.find('[data-table-show-header="true"]');
    expect((show.element as HTMLInputElement).checked).toBe(true);
  });

  it("切换勾选会调用 api.updateTableShowHeader（由编辑层写回 schema）", async () => {
    const events: Event[] = [];
    const api = stubApi({
      updateTableShowHeader: (event: Event) => events.push(event),
    });
    const wrapper = mountInspector(createTableNodeV2(), api);

    await wrapper.find('[data-table-show-header="true"]').trigger("change");

    expect(events).toHaveLength(1);
    // 载荷是原生 change 事件，编辑层从中读 `target.checked`
    expect((events[0].target as HTMLInputElement).type).toBe("checkbox");
  });
});
