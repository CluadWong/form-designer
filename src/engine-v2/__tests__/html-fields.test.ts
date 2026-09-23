import { describe, expect, it } from "vitest";
import { collectHtmlFields, collectSchemaFields } from "@/engine-v2/derivation";
import type { FormSchemaV2, FormNodeV2, HtmlNodeV2 } from "@/types";

/**
 * HTML 模块内字段的枚举口径（`collectSchemaFields` 的 html-field 分支）。
 *
 * HTML 模块把字段写进片段的 markup 里（`data-field="x"` 或 `{{x}}`），既不是 P 节点、
 * 也不参与表格的 `列key_行号` 派生 —— 若清单不收它们，下游（字段权限、必填规则、
 * 宿主按字段清单取值 / 保存）都会静默漏项：页面能填，但清单里找不到这些字段。
 */
function htmlNode(id: string, html: string): HtmlNodeV2 {
  return { id, type: "html", html };
}

function makeSchema(children: FormNodeV2[]): FormSchemaV2 {
  return {
    version: 2,
    paper: { size: "A4" },
    baseRowHeight: 8,
    pages: [
      {
        id: "page-1",
        type: "page",
        mode: "fixed",
        margin: { top: 12, right: 12, bottom: 12, left: 12 },
        children: [
          {
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
          },
        ],
      },
    ],
  } as FormSchemaV2;
}

describe("collectHtmlFields（HTML 片段内字段提取）", () => {
  it("双引号 / 单引号 data-field 与 {{占位}} 都收，按出现顺序、同名去重", () => {
    const html = [
      '<p data-field="收工月1"></p>',
      "<p data-field='收工日1'></p>",
      "<p>{{ 开工时1 }}</p>",
      '<p data-field="收工月1"></p>',
      "<p>{{开工分1}}</p>",
    ].join("");
    expect(collectHtmlFields(html)).toEqual(["收工月1", "收工日1", "开工时1", "开工分1"]);
  });

  it("中文字段名与保留字符（点/下划线/连字符）都能提取", () => {
    expect(collectHtmlFields('<p data-field="工作负责人"></p><p>{{ a.b_c-d }}</p>')).toEqual([
      "工作负责人",
      "a.b_c-d",
    ]);
  });

  it("空白 / 空串 / 无绑定 → 空数组；空字段名被丢弃", () => {
    expect(collectHtmlFields(null)).toEqual([]);
    expect(collectHtmlFields(undefined)).toEqual([]);
    expect(collectHtmlFields("")).toEqual([]);
    expect(collectHtmlFields("<p>纯静态文本</p>")).toEqual([]);
    expect(collectHtmlFields('<p data-field="  "></p>')).toEqual([]);
  });
});

describe("collectSchemaFields 覆盖 HTML 模块内字段", () => {
  it("kind=html-field，key 为片段内的绑定字段名", () => {
    const schema = makeSchema([
      htmlNode("html-1", '<table><tr><td><p data-field="收工月1"></p></td></tr></table>'),
    ]);
    expect(collectSchemaFields(schema)).toEqual([{ key: "收工月1", kind: "html-field" }]);
  });

  it("与 P 字段 / 表格派生字段同清单共存（顺序 = 遍历顺序）", () => {
    const schema = makeSchema([
      { id: "p-1", type: "p", mode: "field", field: "单位" } as FormNodeV2,
      htmlNode("html-1", '<p data-field="签字人"></p><p>{{ 日期 }}</p>'),
    ]);
    expect(collectSchemaFields(schema)).toEqual([
      { key: "单位", kind: "field" },
      { key: "签字人", kind: "html-field" },
      { key: "日期", kind: "html-field" },
    ]);
  });

  it("HTML 位于表格模板内时字段名**不派生**（作者写死，不随行号变化）", () => {
    const schema = makeSchema([
      {
        id: "table-1",
        type: "table",
        minRows: 2,
        columns: [{ key: "附件", width: "1fr" }],
        rowTemplate: [
          {
            columnKey: "附件",
            children: [htmlNode("html-1", '<p data-field="签收人"></p>')],
          },
        ],
      } as unknown as FormNodeV2,
    ]);
    expect(collectSchemaFields(schema, null)).toEqual([{ key: "签收人", kind: "html-field" }]);
  });
});
