import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import GridFormRenderer from "@/components/renderer-v2/GridFormRenderer.vue";
import { makeYunlvSecondTicketFirstFiveRowsSchema } from "@/dev/yunlv-second-ticket-first-five-rows";
import demoData from "@/dev/demoData";
import { collectFieldValues } from "@/components/renderer-v2";

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
