import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { GridFormRenderer } from "@/components/renderer-v2";
import { validateFormSchemaV2 } from "@/types";
import { makeYunlvSecondTicketFullSchema } from "@/dev/yunlv-second-ticket-full";

/**
 * P11 完整工作票样例验收（扁平结构，与设计器导出 JSON 对齐）：
 * - 结构合法（无 error 级校验问题）；
 * - page.children 为 13 个独立段网格：border = all ×3（单位/编号、电站设备、工作任务）
 *   + outer ×9（其余业务段）+ none ×4（标题 + 3 个嵌套 none 网格）；
 * - 全部业务字段均被渲染且可被索引（data-field 存在）；
 * - 内嵌工作任务表按列 key 派生 工作地点_行号 / 工作内容_行号 并渲染 minRows 行；
 * - 各段网格 id 存在。
 */
describe("yunlv-second-ticket-full（P11 完整工作票样例 · 扁平结构）", () => {
  it("schema 校验无 error，且网格边框分布为 all×3 / outer×9 / none×4 / inner×0", () => {
    const schema = makeYunlvSecondTicketFullSchema();
    const issues = validateFormSchemaV2(schema);
    expect(issues.filter(i => i.level === "error")).toHaveLength(0);

    const wrapper = mount(GridFormRenderer, { props: { schema } });
    expect(wrapper.findAll(".layout-grid--all")).toHaveLength(3);
    expect(wrapper.findAll(".layout-grid--outer")).toHaveLength(9);
    expect(wrapper.findAll(".layout-grid--none")).toHaveLength(4);
    expect(wrapper.findAll(".layout-grid--inner")).toHaveLength(0);
  });

  it("全部业务字段均被渲染（覆盖每个段落）", () => {
    const wrapper = mount(GridFormRenderer, {
      props: { schema: makeYunlvSecondTicketFullSchema() },
    });
    const expectField = (field: string) => {
      const el = wrapper.find(`[data-field="${field}"]`);
      expect(el.exists(), `字段 ${field} 应存在`).toBe(true);
    };
    // 基本信息
    expectField("单位");
    expectField("编号");
    expectField("工作负责人（监护人）");
    expectField("班组");
    expectField("工作班成员");
    expectField("工作班成员人数");
    expectField("电站设备");
    // 计划工作时间（「工作任务」是内嵌表的标签不是字段，表本身不带 data-field，
    // 逐行派生字段 工作地点_N / 工作内容_N 见下一例）
    expectField("计划工作时间_开始");
    expectField("计划工作时间_截止");
    // 工作条件 / 安全措施 / 签发
    expectField("工作条件");
    expectField("安全措施");
    expectField("安措备注");
    expectField("工作票签发人签名");
    expectField("签发日期");
    expectField("补充安全措施");
    expectField("补充安措备注");
    // 确认
    expectField("工作负责人签名");
    expectField("工作许可人签名");
    expectField("许可工作时间");
    expectField("工作班成员签名");
    // 延期
    expectField("有效期延长到");
    expectField("延期工作负责人签名");
    expectField("延期工作负责人签名日期");
    expectField("延期工作许可人签名");
    expectField("延期工作许可人签名日期");
    // 终结
    expectField("工作票终结日期");
    expectField("工作负责人签名-终结");
    expectField("工作负责人签名-终结日期");
    expectField("工作许可人签名-终结");
    expectField("工作许可人签名-终结日期");
  });

  it("内嵌工作任务表按列 key 派生 工作地点_行号 / 工作内容_行号 并渲染 minRows 行", () => {
    const wrapper = mount(GridFormRenderer, {
      props: { schema: makeYunlvSecondTicketFullSchema() },
    });
    const table = wrapper.find("table.layout-table");
    expect(table.exists()).toBe(true);
    const bodyRows = wrapper.findAll("table.layout-table tbody tr");
    expect(bodyRows.length).toBeGreaterThanOrEqual(4);
    // 首行两列字段由列 key 派生为 工作地点_1 / 工作内容_1
    expect(wrapper.find('[data-field="工作地点_1"]').exists()).toBe(true);
    expect(wrapper.find('[data-field="工作内容_1"]').exists()).toBe(true);
  });

  it("各段网格节点可被索引命中（段网格 id 存在）", () => {
    const wrapper = mount(GridFormRenderer, {
      props: { schema: makeYunlvSecondTicketFullSchema() },
    });
    for (const id of [
      "title-grid",
      "basic-unit-number-grid",
      "basic-owner-team-grid",
      "basic-members-grid",
      "station-grid",
      "work-task-grid",
      "condition-grid",
      "safety-grid",
      "supplement-grid",
      "confirm-grid",
      "confirm-task-grid",
      "extension-grid",
      "completion-grid",
    ]) {
      expect(
        wrapper.find(`[data-node-id="${id}"]`).exists(),
        `节点 ${id} 应存在`,
      ).toBe(true);
    }
  });

  it("DOM 结构快照与基线一致（整票结构回归基线，防止后续重构破坏整票）", () => {
    const wrapper = mount(GridFormRenderer, {
      props: { schema: makeYunlvSecondTicketFullSchema() },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });
});
