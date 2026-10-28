import { describe, expect, it, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import FormDesigner from "@/components/designer/FormDesigner.vue";
import type { FormSchemaV2, SchemaNodeV2 } from "@/types";
import { makeYunlvSecondTicketFirstFiveRowsSchema } from "@/dev/yunlv-second-ticket-first-five-rows";

/**
 * 表格面板「标题 / 字段名 / 宽度」的交互契约（2026-10-27 重设计后）。
 *
 * 结构变了：标题不再有独立的「列配置」输入框，而是**表头网格的格内 textarea**；
 * 字段名与宽度收进与网格同列对齐的「列带」。但这些行为契约不变：
 * - 标题用 textarea（可换行），`rows=1` 起步并按 `scrollHeight` 增高；
 * - 打字只做本地增高，`@change` 才提交 —— 逐字符输入不重建 DOM、不丢焦点；
 * - 列宽 `40mm` 解析为 40（mm 数值），渲染层表头跟着变。
 */
function mountDesigner(): VueWrapper {
  return mount(FormDesigner, {
    props: { initialSchema: makeYunlvSecondTicketFirstFiveRowsSchema() },
    attachTo: document.body,
  });
}

/** 递归查找首个匹配 id 的 table 节点。 */
function findTable(schema: FormSchemaV2, id: string): SchemaNodeV2 | null {
  const walk = (nodes: SchemaNodeV2[]): SchemaNodeV2 | null => {
    for (const n of nodes) {
      if (n.type === "table" && n.id === id) return n;
      if (n.type === "grid") {
        for (const row of n.rows) {
          for (const cell of row.cells) {
            const hit = walk(cell.children);
            if (hit) return hit;
          }
        }
      }
    }
    return null;
  };
  return walk(schema.pages[0].children);
}

function tableOf(wrapper: VueWrapper) {
  const schema = (wrapper.vm as unknown as { schema: FormSchemaV2 }).schema;
  const table = findTable(schema, "work-task-table");
  if (!table || table.type !== "table") throw new Error("work-task-table missing");
  return table;
}

let active: VueWrapper | null = null;
afterEach(() => {
  active?.unmount();
  active = null;
});

async function selectWorkTaskTable(): Promise<VueWrapper> {
  const wrapper = mountDesigner();
  active = wrapper;
  // 点击表格内默认字段 P → 因不可单独选中，回退选中所属 Table
  await wrapper.find("tbody .layout-p").trigger("click");
  await nextTick();
  await nextTick();
  return wrapper;
}

describe("TableInspector 标题 / 字段名 / 宽度", () => {
  it("标题由表头网格承担，字段名与宽度在列带（一列一格）", async () => {
    const wrapper = await selectWorkTaskTable();
    expect(wrapper.find('[data-table-header-editor="true"]').exists()).toBe(true);
    expect(wrapper.findAll("[data-header-text]").length).toBeGreaterThan(0);

    const band = wrapper.find('[data-table-columns="true"]');
    const cells = band.findAll("[data-table-column]");
    expect(cells).toHaveLength(tableOf(wrapper).columns.length);
    for (const cell of cells) {
      expect(cell.find("[data-col-key]").exists()).toBe(true);
      expect(cell.find("[data-col-width]").exists()).toBe(true);
    }
  });

  it("标题 textarea 单行起步（rows=1），高度交给 CSS min-height 与相邻控件齐平", async () => {
    const wrapper = await selectWorkTaskTable();
    const title = wrapper.find("textarea[data-header-text]");
    expect(title.attributes("rows")).toBe("1");
  });

  it("标题按 scrollHeight 自动增高，超过 max-height 才转内部滚动", async () => {
    const wrapper = await selectWorkTaskTable();
    const title = wrapper.find("textarea[data-header-text]");
    const el = title.element as HTMLTextAreaElement;

    // jsdom 里 scrollHeight 恒为 0：此时不写内联高度（交给 CSS），否则会被压成 0px。
    expect(el.style.height).toBe("");

    // 模拟真实浏览器量到的内容高度 → 输入事件即撑开（不必等 blur）。
    Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => 54 });
    el.value = "第一行\n第二行";
    await title.trigger("input");
    expect(el.style.height).toBe("54px");
  });

  it("逐字符输入标题不重建 DOM（@change 才提交，焦点不丢）", async () => {
    const wrapper = await selectWorkTaskTable();
    const title = wrapper.find("textarea[data-header-text]");
    const before = title.element as HTMLTextAreaElement;

    // 仅 input 事件（不触发 change）→ 不应提交、不应重建
    before.value = "a";
    await title.trigger("input");
    before.value = "ab";
    await title.trigger("input");
    await nextTick();

    const after = wrapper.find("textarea[data-header-text]").element;
    expect(after).toBe(before); // 同一元素（未重建）
    expect(tableOf(wrapper).columns[0].title).not.toBe("ab"); // 未提交
  });

  it("逐字符输入字段名不重建 DOM（@change 才提交，焦点不丢）", async () => {
    const wrapper = await selectWorkTaskTable();
    const keyInput = wrapper.find("[data-col-key]");
    const before = keyInput.element as HTMLInputElement;

    before.value = "x";
    await keyInput.trigger("input");
    before.value = "xy";
    await keyInput.trigger("input");
    await nextTick();

    expect(wrapper.find("[data-col-key]").element).toBe(before);
    expect(tableOf(wrapper).columns[0].key).not.toBe("xy"); // 未提交
  });

  it("宽度列 @change 写入 schema（mm 单位解析）", async () => {
    const wrapper = await selectWorkTaskTable();
    const width = wrapper.findAll("[data-col-width]")[0];
    await width.setValue("40mm");
    await width.trigger("change");
    await nextTick();

    expect(tableOf(wrapper).columns[0].width).toBe(40);

    // 渲染层消费：列宽 → grid-template-columns（40mm）
    await nextTick();
    const headerRowStyle = wrapper.find("thead tr").attributes("style") ?? "";
    expect(headerRowStyle).toContain("40mm");
  });

  it("标题含换行符时 @change 写入 schema 并在渲染表头保留", async () => {
    const wrapper = await selectWorkTaskTable();
    const title = wrapper.find("textarea[data-header-text]");
    await title.setValue("第一行\n第二行");
    await title.trigger("change");
    await nextTick();

    expect(tableOf(wrapper).columns[0].title).toBe("第一行\n第二行");

    // 渲染层表头保留换行
    const headerCell = wrapper.find("thead th");
    expect(headerCell.text()).toContain("第一行\n第二行");
  });
});
