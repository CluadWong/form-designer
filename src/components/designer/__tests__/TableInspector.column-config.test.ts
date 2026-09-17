import { describe, expect, it, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import FormDesigner from "@/components/designer/FormDesigner.vue";
import type { FormSchemaV2, SchemaNodeV2 } from "@/types";
import { makeYunlvSecondTicketFirstFiveRowsSchema } from "@/dev/yunlv-second-ticket-first-five-rows";

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

let active: VueWrapper | null = null;
afterEach(() => {
  active?.unmount();
  active = null;
});

async function selectWorkTaskTable(): Promise<VueWrapper> {
  const wrapper = mountDesigner();
  active = wrapper;
  // 点击表格内默认字段 P → 回退选中所属 Table
  await wrapper.find("tbody .layout-p").trigger("click");
  await nextTick();
  await nextTick();
  return wrapper;
}

describe("TableInspector 列配置（焦点/列宽/标题换行）", () => {
  it("列配置表含 标题 / 字段 / 宽度 三列", async () => {
    const wrapper = await selectWorkTaskTable();
    const colTable = wrapper.find('[data-table-columns="true"]');
    const heads = colTable
      .findAll(".v2-col-table__head .v2-col-table__th")
      .map((h) => h.text());
    expect(heads).toContain("标题");
    expect(heads).toContain("字段");
    expect(heads).toContain("宽度");
  });

  it("标题渲染为 textarea（支持换行），字段名/宽度为 input", async () => {
    const wrapper = await selectWorkTaskTable();
    const colTable = wrapper.find('[data-table-columns="true"]');
    const firstRow = colTable.findAll(".v2-col-table__row")[1];
    expect(firstRow.find("textarea.v2-col-table__input--title").exists()).toBe(true);
    expect(firstRow.findAll("input").length).toBe(2); // 字段名 + 宽度
  });

  it("逐字符输入标题不重建 DOM（@change 不触发提交，焦点不丢）", async () => {
    const wrapper = await selectWorkTaskTable();
    const colTable = wrapper.find('[data-table-columns="true"]');
    const title = colTable.find("textarea.v2-col-table__input--title");
    const before = title.element as HTMLTextAreaElement;

    // 仅 input 事件（不触发 change）→ 不应提交、不应重建
    before.value = "a";
    await title.trigger("input");
    before.value = "ab";
    await title.trigger("input");
    await nextTick();

    const after = colTable.find("textarea.v2-col-table__input--title").element;
    expect(after).toBe(before); // 同一元素（未重建）

    const schema = (wrapper.vm as unknown as { schema: FormSchemaV2 }).schema;
    const table = findTable(schema, "work-task-table");
    if (!table || table.type !== "table") throw new Error("work-task-table missing");
    expect(table.columns[0].title).not.toBe("ab"); // 未提交
  });

  it("逐字符输入字段名不重建 DOM（@change 不触发提交，焦点不丢）", async () => {
    const wrapper = await selectWorkTaskTable();
    const colTable = wrapper.find('[data-table-columns="true"]');
    const firstRow = colTable.findAll(".v2-col-table__row")[1];
    const keyInput = firstRow.findAll("input")[0].element as HTMLInputElement;
    const before = keyInput;

    keyInput.value = "x";
    await firstRow.findAll("input")[0].trigger("input");
    keyInput.value = "xy";
    await firstRow.findAll("input")[0].trigger("input");
    await nextTick();

    const after = colTable.findAll(".v2-col-table__row")[1].findAll("input")[0].element;
    expect(after).toBe(before);

    const schema = (wrapper.vm as unknown as { schema: FormSchemaV2 }).schema;
    const table = findTable(schema, "work-task-table");
    if (!table || table.type !== "table") throw new Error("work-task-table missing");
    expect(table.columns[0].key).not.toBe("xy"); // 未提交
  });

  it("宽度列 @change 写入 schema（mm 单位解析）", async () => {
    const wrapper = await selectWorkTaskTable();
    const colTable = wrapper.find('[data-table-columns="true"]');
    const firstRow = colTable.findAll(".v2-col-table__row")[1];
    const width = firstRow.find("input.v2-col-table__input--width");
    await width.setValue("40mm");
    await width.trigger("change");
    await nextTick();

    const schema = (wrapper.vm as unknown as { schema: FormSchemaV2 }).schema;
    const table = findTable(schema, "work-task-table");
    if (!table || table.type !== "table") throw new Error("work-task-table missing");
    expect(table.columns[0].width).toBe(40);

    // 渲染层消费：列宽 → grid-template-columns（40mm）
    await nextTick();
    const headerRowStyle = wrapper.find("thead tr").attributes("style") ?? "";
    expect(headerRowStyle).toContain("40mm");
  });

  it("标题含换行符时 @change 写入 schema 并在渲染表头保留", async () => {
    const wrapper = await selectWorkTaskTable();
    const colTable = wrapper.find('[data-table-columns="true"]');
    const title = colTable.find("textarea.v2-col-table__input--title");
    await title.setValue("第一行\n第二行");
    await title.trigger("change");
    await nextTick();

    const schema = (wrapper.vm as unknown as { schema: FormSchemaV2 }).schema;
    const table = findTable(schema, "work-task-table");
    if (!table || table.type !== "table") throw new Error("work-task-table missing");
    expect(table.columns[0].title).toBe("第一行\n第二行");

    // 渲染层表头保留换行
    const headerCell = wrapper.find("thead th");
    expect(headerCell.text()).toContain("第一行\n第二行");
  });
});
