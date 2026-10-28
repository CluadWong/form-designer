import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import CanvasSurface from "@/components/designer/CanvasSurface.vue";
import type { FormSchemaV2 } from "@/types";
import { makeYunlvSecondTicketFirstFiveRowsSchema } from "@/dev/yunlv-second-ticket-first-five-rows";

/**
 * A5 分层重构后，选中高亮由「渲染内核」迁移到「设计表面层」(CanvasSurface)：
 * - 内核 (renderer-v2) 只输出稳定的 `data-node-id` 地址，不再感知选中态；
 * - CanvasSurface 通过 MutationObserver + watch 把 `.is-design-selected` 加到
 *   与 `selectedNodeId` 匹配的节点上，并去掉其它节点的残留类。
 *
 * 高亮在 watch 的 nested nextTick 中落地，故测试统一用 `flush()`（两次 nextTick）等待。
 */
async function flush(): Promise<void> {
  await nextTick();
  await nextTick();
}

function findSelected(wrapper: VueWrapper): string[] {
  return wrapper
    .findAll(".is-design-selected")
    .map((el) => el.attributes("data-node-id") ?? "");
}

describe("CanvasSurface selection highlight (A5)", () => {
  const schema = makeYunlvSecondTicketFirstFiveRowsSchema();

  it("applies .is-design-selected to the node matching selectedNodeId", async () => {
    const wrapper = mount(CanvasSurface, {
      props: { schema, mode: "design", selectedNodeId: "unit-field" },
    });
    await flush();

    const selected = findSelected(wrapper);
    expect(selected).toContain("unit-field");
    expect(wrapper.find('[data-node-id="unit-field"]').classes()).toContain(
      "is-design-selected",
    );
  });

  it("applies no highlight when selectedNodeId is null", async () => {
    const wrapper = mount(CanvasSurface, {
      props: { schema, mode: "design", selectedNodeId: null },
    });
    await flush();

    expect(findSelected(wrapper)).toHaveLength(0);
  });

  it("moves the highlight when selectedNodeId changes", async () => {
    const wrapper = mount(CanvasSurface, {
      props: { schema, mode: "design", selectedNodeId: "unit-field" },
    });
    await flush();
    expect(findSelected(wrapper)).toContain("unit-field");

    await wrapper.setProps({ selectedNodeId: "work-task-table" });
    await flush();

    const selected = findSelected(wrapper);
    expect(selected).toContain("work-task-table");
    expect(selected).not.toContain("unit-field");
  });

  it("is mode-agnostic: highlights whenever selectedNodeId is set (preview suppression is FormDesigner's job)", async () => {
    // 表面层只认 selectedNodeId，不感知 mode；预览态「无选中」由 FormDesigner 传 null 实现，
    // 本测试确认表面层本身的行为：只要传了非 null selectedNodeId 就高亮（与 mode 无关）。
    const wrapper = mount(CanvasSurface, {
      props: { schema, mode: "preview", selectedNodeId: "unit-field" },
    });
    await flush();

    expect(findSelected(wrapper)).toContain("unit-field");
  });
});

/**
 * 结构树悬停定位（2026-10-23）：悬停给一个独立的类 `.is-design-hover`，
 * 与选中态 `.is-design-selected` 并存、互不覆盖。
 */
describe("CanvasSurface 悬停定位高亮", () => {
  const schema = makeYunlvSecondTicketFirstFiveRowsSchema();

  function findHovered(wrapper: VueWrapper): string[] {
    return wrapper
      .findAll(".is-design-hover")
      .map((el) => el.attributes("data-node-id") ?? "");
  }

  it("给 hoveredNodeId 对应节点加 .is-design-hover", async () => {
    const wrapper = mount(CanvasSurface, {
      props: { schema, mode: "design", hoveredNodeId: "unit-field" },
    });
    await flush();

    expect(findHovered(wrapper)).toContain("unit-field");
  });

  it("hoveredNodeId 为 null 时无悬停高亮", async () => {
    const wrapper = mount(CanvasSurface, {
      props: { schema, mode: "design", hoveredNodeId: null },
    });
    await flush();

    expect(findHovered(wrapper)).toHaveLength(0);
  });

  it("悬停移动时旧节点的类被移除（同一时刻只有一个悬停节点）", async () => {
    const wrapper = mount(CanvasSurface, {
      props: { schema, mode: "design", hoveredNodeId: "unit-field" },
    });
    await flush();

    await wrapper.setProps({ hoveredNodeId: "work-task-table" });
    await flush();

    expect(findHovered(wrapper)).toEqual(["work-task-table"]);
  });

  it("悬停的正是选中节点时两个类共存（CSS 里悬停规则在后 → 悬停色优先）", async () => {
    const wrapper = mount(CanvasSurface, {
      props: { schema, mode: "design", selectedNodeId: "unit-field", hoveredNodeId: "unit-field" },
    });
    await flush();

    const classes = wrapper.find('[data-node-id="unit-field"]').classes();
    expect(classes).toContain("is-design-selected");
    expect(classes).toContain("is-design-hover");
  });

  it("移出结构树（hoveredNodeId 置 null）后选中高亮不受影响", async () => {
    const wrapper = mount(CanvasSurface, {
      props: { schema, mode: "design", selectedNodeId: "unit-field", hoveredNodeId: "unit-field" },
    });
    await flush();

    await wrapper.setProps({ hoveredNodeId: null });
    await flush();

    expect(findHovered(wrapper)).toHaveLength(0);
    expect(findSelected(wrapper)).toContain("unit-field");
  });
});

/**
 * 面板拖拽的落点上抛（2026-10-21 交互规则）：落在格子上带 `cellId`；
 * 落在**格子之外**（页面空白 / 网格间隙）不再丢弃，而是 `cellId: null` 上抛，
 * 由编辑层「页面末尾新建网格 + 放进首格」兜底。
 */
describe("CanvasSurface 面板拖拽落点（drop-palette）", () => {
  const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
  /** jsdom 没有 DataTransfer，按内核读取的 MIME 键造一个最小替身。 */
  const PALETTE_MIME = "application/x-ticket-node-kind";

  function dropEvent(target: Element): Event {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: {
        getData: (mime: string) => (mime === PALETTE_MIME ? "text" : ""),
      },
    });
    Object.defineProperty(event, "target", { value: target });
    return event;
  }

  it("落在格子上：emit drop-palette 携带该格 id", async () => {
    const wrapper = mount(CanvasSurface, { props: { schema, mode: "design" } });
    const cell = wrapper.find("[data-layout-id]").element;
    const cellId = cell.getAttribute("data-layout-id");
    expect(cellId).toBeTruthy();

    wrapper.element.dispatchEvent(dropEvent(cell));
    await nextTick();

    expect(wrapper.emitted("drop-palette")?.[0]).toEqual([{ kind: "text", cellId }]);
  });

  it("落在格子之外：emit drop-palette 且 cellId 为 null", async () => {
    const wrapper = mount(CanvasSurface, { props: { schema, mode: "design" } });

    // 画布根元素自身不在任何 [data-layout-id] 之内
    wrapper.element.dispatchEvent(dropEvent(wrapper.element));
    await nextTick();

    expect(wrapper.emitted("drop-palette")?.[0]).toEqual([{ kind: "text", cellId: null }]);
  });
});
