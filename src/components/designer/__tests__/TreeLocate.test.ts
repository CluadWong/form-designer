/**
 * 结构树定位（2026-09-11 新增功能）：点击纸张里的组件节点时，左侧结构树
 * ① 自动展开被折叠隐藏的祖先链（否则目标行压根不在 DOM 里），
 * ② 就近滚动到目标行可见。
 *
 * 滚动用**纯函数**单测：jsdom 无布局引擎，`getBoundingClientRect()` 恒返回全 0、
 * `clientHeight` 恒为 0，组件级断言测不出滚动效果。展开与选中标记走真实挂载。
 */
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import FormDesigner from "@/components/designer/FormDesigner.vue";
import type { TreeNode } from "@/components/designer/NodeTreeItem.vue";
import {
  computeRevealScrollTop,
  scrollRowIntoView,
  treeContainsId,
  type ScrollableView,
} from "@/components/designer/composables/treeControl";
import { makeYunlvSecondTicketFirstFiveRowsSchema } from "@/dev/yunlv-second-ticket-first-five-rows";

function mountDesigner(): VueWrapper {
  return mount(FormDesigner, {
    props: { initialSchema: makeYunlvSecondTicketFirstFiveRowsSchema() },
  });
}

/** 展开/折叠全部（按钮文本定位，避免依赖按钮顺序）。 */
async function clickTreeButton(wrapper: VueWrapper, text: string): Promise<void> {
  const btn = wrapper.findAll(".v2-tree__btn").find((b) => b.text() === text);
  expect(btn).toBeDefined();
  await btn!.trigger("click");
  await nextTick();
}

/** 画布点选 + 等两轮（定位走 `watch` → `nextTick` → 滚动）。 */
async function clickCanvasNode(wrapper: VueWrapper, id: string): Promise<void> {
  await wrapper.find(`[data-node-id="${id}"]`).trigger("click");
  await nextTick();
  await nextTick();
}

function treeNode(id: string, children: TreeNode[] = []): TreeNode {
  return { id, type: "t", label: id, children };
}

function viewport(top: number, bottom: number, scrollTop = 0): ScrollableView {
  return { clientHeight: bottom - top, scrollTop, getBoundingClientRect: () => ({ top, bottom }) };
}

function box(top: number, bottom: number): { getBoundingClientRect(): { top: number; bottom: number } } {
  return { getBoundingClientRect: () => ({ top, bottom }) };
}

describe("treeContainsId", () => {
  const tree = treeNode("page", [treeNode("grid", [treeNode("cell", [treeNode("field")])])]);

  it("自身命中、后代命中、无关节点不命中", () => {
    expect(treeContainsId(tree, "page")).toBe(true);
    expect(treeContainsId(tree, "grid")).toBe(true);
    expect(treeContainsId(tree, "field")).toBe(true);
    expect(treeContainsId(tree, "other")).toBe(false);
  });

  it("id 为空一律不命中（折叠全部会清空 focusId）", () => {
    expect(treeContainsId(tree, null)).toBe(false);
    expect(treeContainsId(tree, "")).toBe(false);
  });
});

describe("computeRevealScrollTop：就近滚动", () => {
  it("目标已在视野内：不动", () => {
    expect(computeRevealScrollTop(viewport(0, 100, 40), box(50, 70))).toBe(40);
  });

  it("目标在视野上方：上移对应的越界距离", () => {
    // view 0..100 / row -30..-10 / 当前 50 → 越界 0+4-(-30)=34
    expect(computeRevealScrollTop(viewport(0, 100, 50), box(-30, -10))).toBe(16);
  });

  it("上移到顶即止，不回弹成负数", () => {
    expect(computeRevealScrollTop(viewport(0, 100, 10), box(-30, -10))).toBe(0);
  });

  it("目标在视野下方：下移对应的越界距离", () => {
    // row 120..140 底 140 + 4 - 100 = 44
    expect(computeRevealScrollTop(viewport(0, 100, 0), box(120, 140))).toBe(44);
  });
});

describe("scrollRowIntoView", () => {
  it("已在视野内返回 false 且不改 scrollTop", () => {
    const view = viewport(0, 100, 40);
    expect(scrollRowIntoView(view, box(50, 70))).toBe(false);
    expect(view.scrollTop).toBe(40);
  });

  it("越界时写入新 scrollTop 并返回 true", () => {
    const view = viewport(0, 100, 0);
    expect(scrollRowIntoView(view, box(120, 140))).toBe(true);
    expect(view.scrollTop).toBe(44);
  });
});

describe("FormDesigner 结构树定位：画布点选 → 左侧展开 + 选中", () => {
  it("折叠全部后点击画布深层字段：祖先链自动展开，目标行出现并被标记选中", async () => {
    const wrapper = mountDesigner();
    await clickTreeButton(wrapper, "折叠全部");
    expect(wrapper.findAll(".v2-tree-children")).toHaveLength(0);
    expect(wrapper.find('[data-tree-node-id="unit-field"]').exists()).toBe(false);

    await clickCanvasNode(wrapper, "unit-field");

    const row = wrapper.find('[data-tree-node-id="unit-field"]');
    expect(row.exists()).toBe(true);
    expect(row.classes()).toContain("v2-tree-row--selected");
    // 祖先链被展开（图层级不只有根节点）
    expect(wrapper.findAll(".v2-tree-children").length).toBeGreaterThan(0);
  });

  it("点击画布上的 Grid 时，其所在页面同步展开并选中该网格行", async () => {
    const wrapper = mountDesigner();
    await clickTreeButton(wrapper, "折叠全部");

    await clickCanvasNode(wrapper, "ticket-layout");

    const row = wrapper.find('[data-tree-node-id="ticket-layout"]');
    expect(row.exists()).toBe(true);
    expect(row.classes()).toContain("v2-tree-row--selected");
  });

  it("折叠全部会清空定位焦点：之后单独展开页面，不会被旧焦点一路展开到上次选中的节点", async () => {
    const wrapper = mountDesigner();

    // 先选中深层字段，focusId 落在 unit-field 上
    await clickCanvasNode(wrapper, "unit-field");
    expect(wrapper.find('[data-tree-node-id="unit-field"]').exists()).toBe(true);

    await clickTreeButton(wrapper, "折叠全部");
    expect(wrapper.findAll(".v2-tree-children")).toHaveLength(0);

    // 只手动展开页面（第一行有折叠箭头的节点）
    const pageRow = wrapper.findAll(".v2-tree-row").find((r) => r.find(".v2-tree-toggle").exists());
    expect(pageRow).toBeDefined();
    await pageRow!.find(".v2-tree-toggle").trigger("click");
    await nextTick();
    await nextTick();

    // 只剩页面 + 其直接子节点（网格）行；深层字段行不应被旧焦点复活
    expect(wrapper.find('[data-tree-node-id="unit-field"]').exists()).toBe(false);
  });
});
