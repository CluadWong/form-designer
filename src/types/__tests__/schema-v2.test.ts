import { describe, expect, it } from "vitest";
import type { FormSchemaV2 } from "@/types/schema-v2";
import { buildEditorNodeIndexV2, getAncestorsV2, getNodeByIdV2, getOwnerCellV2 } from "@/types/schema-v2-index";
import { validateFormSchemaV2 } from "@/types/schema-v2-validation";
import {
  normalizeFormSchemaV2,
  parseFormSchemaV2,
  parseTolerantFormSchemaV2,
  SchemaV2SerializationError,
  serializeFormSchemaV2,
} from "@/types/schema-v2-serialization";
import { makeYunlvSecondTicketFirstFiveRowsSchema } from "@/dev/yunlv-second-ticket-first-five-rows";

function rootGrid(schema: FormSchemaV2) {
  const node = schema.pages[0].children[0];
  if (node.type !== "grid") throw new Error("fixture root is not a grid");
  return node;
}

function makeSchema(overrides: Partial<FormSchemaV2> = {}): FormSchemaV2 {
  return {
    version: 2,
    paper: { size: "A4" },
    baseRowHeight: 8,
    pages: [
      {
        id: "page-1",
        type: "page",
        mode: "fixed",
        margin: { top: 10, right: 10, bottom: 10, left: 10 },
        children: [
          {
            id: "grid-1",
            type: "grid",
            border: "all",
            rows: [
              {
                id: "row-1",
                type: "grid-row",
                height: 1,
                cells: [
                  {
                    id: "cell-1",
                    type: "grid-cell",
                    children: [
                      { id: "label-1", type: "text", text: "单位" },
                    ],
                  },
                  {
                    id: "cell-2",
                    type: "grid-cell",
                    children: [
                      { id: "field-1", type: "p", mode: "field", field: "单位" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("Schema V2 index", () => {
  it("indexes nested nodes with parent and path", () => {
    const index = buildEditorNodeIndexV2(makeSchema());
    const field = index.get("field-1");
    expect(field?.parent?.id).toBe("cell-2");
    expect(field?.ownerCell?.id).toBe("cell-2");
    expect(field?.path).toEqual([
      "pages",
      0,
      "children",
      0,
      "rows",
      0,
      "cells",
      1,
      "children",
      0,
    ]);
  });

  it("rejects duplicate IDs while indexing", () => {
    const schema = makeSchema();
    schema.pages[0].children.push({
      id: "grid-1",
      type: "grid",
      border: "none",
      rows: [],
    });
    expect(() => buildEditorNodeIndexV2(schema)).toThrow(/Duplicate Schema V2 node id/);
  });

  it("provides node, owner slot, and ancestor queries", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    expect(getNodeByIdV2(schema, "work-task-table")?.type).toBe("table");
    expect(getOwnerCellV2(schema, "work-task-table")?.id).toBe("cell-wt-r1");
    expect(getAncestorsV2(schema, "work-task-table").map(node => node.id)).toEqual([
      "ticket-page-1",
      "ticket-layout",
      "row-work-task",
      "cell-wt-r1",
    ]);
    expect(getNodeByIdV2(schema, "missing")).toBeUndefined();
    expect(getAncestorsV2(schema, "missing")).toEqual([]);
  });
});

describe("Schema V2 validation", () => {
  it("accepts a minimal nested schema", () => {
    expect(validateFormSchemaV2(makeSchema())).toEqual([]);
  });

  it("reports duplicate fields and invalid dimensions", () => {
    const schema = makeSchema();
    const cell = rootGrid(schema).rows[0].cells[1];
    cell.children.push({ id: "field-2", type: "p", mode: "field", field: "单位" });
    schema.baseRowHeight = 0;
    const issues = validateFormSchemaV2(schema);
    expect(issues.some(issue => issue.code === "DUPLICATE_FIELD")).toBe(true);
    expect(issues.some(issue => issue.code === "INVALID_BASE_ROW_HEIGHT")).toBe(true);
  });

  it("reports invalid table templates and empty field names", () => {
    const schema = makeSchema();
    const cell = rootGrid(schema).rows[0].cells[0];
    cell.children = [
      { id: "field-empty", type: "p", mode: "field", field: "" },
      {
        id: "table-1",
        type: "table",
        columns: [{ key: "location", title: "地点" }],
        minRows: 1,
        rowTemplate: [
          {
            id: "template-1",
            type: "table-cell-template",
            columnKey: "missing",
            children: [],
          },
        ],
      },
    ];
    const issues = validateFormSchemaV2(schema);
    expect(issues.some(issue => issue.code === "EMPTY_FIELD")).toBe(true);
    expect(issues.some(issue => issue.code === "INVALID_TABLE_TEMPLATE")).toBe(true);
  });

  it("warns when the page minimum content height exceeds the usable fixed height", () => {
    const schema = makeSchema();
    const grid = rootGrid(schema);
    for (let index = 1; index < 40; index += 1) {
      grid.rows.push({
        id: `extra-row-${index}`,
        type: "grid-row",
        height: 1,
        cells: [{ id: `extra-cell-${index}`, type: "grid-cell", children: [] }],
      });
    }
    const overflow = validateFormSchemaV2(schema).find(issue => issue.code === "PAPER_OVERFLOW");
    expect(overflow?.level).toBe("warning");
    expect(overflow?.nodeId).toBe("page-1");
    expect(overflow?.message).toContain("320");
    expect(overflow?.message).toContain("277");
  });

  it("does not warn when the page minimum content height fits", () => {
    // makeSchema() has one 8mm row inside a 277mm usable page.
    expect(validateFormSchemaV2(makeSchema()).some(issue => issue.code === "PAPER_OVERFLOW")).toBe(false);
  });

  it("warns when static P text is estimated wider than its cell", () => {
    const schema = makeSchema();
    const cell = rootGrid(schema).rows[0].cells[0];
    cell.width = 10;
    cell.children = [
      { id: "long-label", type: "text", text: "这是一段非常长的固定文本内容，用于触发溢出警告" },
    ];
    const overflow = validateFormSchemaV2(schema).find(issue => issue.code === "CONTENT_OVERFLOW");
    expect(overflow?.level).toBe("warning");
    expect(overflow?.nodeId).toBe("long-label");
  });

  it("does not warn when P text fits, the cell width is not numeric, or the P is a bare field", () => {
    const schema = makeSchema();
    const cell = rootGrid(schema).rows[0].cells[0];
    cell.width = 18; // "单位" fits easily; the bare field P has no fixed labels
    expect(validateFormSchemaV2(schema).some(issue => issue.code === "CONTENT_OVERFLOW")).toBe(false);

    const frSchema = makeSchema();
    const frCell = rootGrid(frSchema).rows[0].cells[0];
    frCell.width = "1fr";
    frCell.children = [
      { id: "long-label", type: "text", text: "这是一段非常长的固定文本内容，用于触发溢出警告" },
    ];
    expect(validateFormSchemaV2(frSchema).some(issue => issue.code === "CONTENT_OVERFLOW")).toBe(false);
  });

  it("warns when composite field P labels plus input minimum width exceed the cell", () => {
    const schema = makeSchema();
    const cell = rootGrid(schema).rows[0].cells[1];
    cell.width = 14;
    cell.children = [
      {
        id: "composite-field",
        type: "p",
        mode: "field",
        field: "负责人",
        prefix: "工作负责人",
        suffix: "确认",
      },
    ];
    const overflow = validateFormSchemaV2(schema).find(issue => issue.code === "CONTENT_OVERFLOW");
    expect(overflow?.level).toBe("warning");
    expect(overflow?.nodeId).toBe("composite-field");
  });

  it("warns when a P inside a numeric-width table column template overflows", () => {
    const schema = makeSchema();
    const cell = rootGrid(schema).rows[0].cells[1];
    cell.children = [
      {
        id: "table-1",
        type: "table",
        columns: [{ key: "location", title: "地点", width: 10 }],
        minRows: 1,
        rowTemplate: [
          {
            id: "template-1",
            type: "table-cell-template",
            columnKey: "location",
            children: [
              { id: "long-field", type: "p", mode: "field", field: "x", prefix: "很长很长的标签文本" },
            ],
          },
        ],
      },
    ];
    const overflow = validateFormSchemaV2(schema).find(issue => issue.code === "CONTENT_OVERFLOW");
    expect(overflow?.level).toBe("warning");
    expect(overflow?.nodeId).toBe("long-field");
  });

  it("keeps the Yunlv sample free of overflow warnings", () => {
    const issues = validateFormSchemaV2(makeYunlvSecondTicketFirstFiveRowsSchema());
    expect(issues.some(issue => issue.code === "CONTENT_OVERFLOW" || issue.code === "PAPER_OVERFLOW")).toBe(false);
  });
});

describe("Yunlv sample schema layout", () => {
  it("keeps the page as a title Grid plus one outer five-row Grid", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    const children = schema.pages[0].children;
    expect(children).toHaveLength(2);
    expect(children.every(node => node.type === "grid")).toBe(true);

    const outer = children.find(node => node.id === "ticket-layout");
    if (!outer || outer.type !== "grid") throw new Error("outer grid missing");
    expect(outer.rows).toHaveLength(5);
    const workTaskRow = outer.rows.find(row => row.id === "row-work-task");
    if (!workTaskRow) throw new Error("work task row missing");
    const workCellChildren = workTaskRow.cells[1].children;
    expect(workCellChildren.map(node => node.type)).toEqual(["table"]);
  });
});

describe("Schema V2 serialization", () => {
  it("round-trips a valid schema and preserves IDs", () => {
    const schema = makeSchema();
    const restored = parseFormSchemaV2(serializeFormSchemaV2(schema));
    expect(restored).toEqual(schema);
  });

  it("round-trips Grid gap (CSS gap, rows + columns)", () => {
    const schema = makeSchema();
    const grid = schema.pages[0].children[0];
    if (grid.type !== "grid") throw new Error("grid missing");
    grid.gap = 8;
    const restored = parseFormSchemaV2(serializeFormSchemaV2(schema));
    const rGrid = restored.pages[0].children[0];
    if (rGrid.type !== "grid") throw new Error("grid missing");
    expect(rGrid.gap).toBe(8);
  });

  it("drops an invalid Grid gap while loading", () => {
    const schema = makeSchema();
    const input = JSON.parse(JSON.stringify(schema)) as Record<string, any>;
    (input.pages[0].children[0] as Record<string, unknown>).gap = "oops";
    const restored = parseFormSchemaV2(input);
    const g = restored.pages[0].children[0];
    if (g.type !== "grid") throw new Error("grid missing");
    expect(g.gap).toBeUndefined();
  });

  it("drops deprecated orientation key while loading (存量模板兼容)", () => {
    const schema = makeSchema();
    const input = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
    delete input.baseRowHeight;
    (input.paper as Record<string, unknown>).orientation = "portrait"; // 存量模板残留的废弃键
    const restored = parseFormSchemaV2(input);
    expect(restored.baseRowHeight).toBe(8);
    // `orientation` 为废弃键（方向自 P11-3 起由纸张尺寸派生，渲染/打印均忽略）：归一化时直接丢弃。
    expect(restored.paper.orientation).toBeUndefined();
    expect(restored.pages[0].children[0]).toMatchObject({ type: "grid", border: "all" });
  });

  it("rejects unknown versions and invalid structures", () => {
    expect(() => parseFormSchemaV2('{"version":1}')).toThrow(SchemaV2SerializationError);
    expect(() => serializeFormSchemaV2({ ...makeSchema(), baseRowHeight: 0 })).toThrow(SchemaV2SerializationError);
    expect(() => normalizeFormSchemaV2({ version: 2, pages: "invalid" })).toThrow(SchemaV2SerializationError);
    expect(() => parseFormSchemaV2({ ...makeSchema(), pages: [{ ...makeSchema().pages[0], children: [{ id: "unknown", type: "unknown" }] }] })).toThrow(SchemaV2SerializationError);
  });

  it("容错解析（G5/G6）：未知节点类型不抛错，返回 schema + UNKNOWN_NODE_TYPE issue", () => {
    const result = parseTolerantFormSchemaV2({
      ...makeSchema(),
      pages: [{ ...makeSchema().pages[0], children: [{ id: "unknown", type: "unknown" } as never] }],
    });
    expect(result.ok).toBe(true);
    expect(result.schema).not.toBeNull();
    expect(result.schema!.pages[0].children.some(node => (node as { type?: string }).type === "unknown")).toBe(true);
    expect(result.issues.some(issue => issue.code === "UNKNOWN_NODE_TYPE" && issue.level === "error")).toBe(true);
  });

  it("容错解析（G5）：非法 JSON 返回 ok=false + INVALID_JSON issue，schema 为 null", () => {
    const result = parseTolerantFormSchemaV2("{ not valid json");
    expect(result.ok).toBe(false);
    expect(result.schema).toBeNull();
    expect(result.issues.some(issue => issue.code === "INVALID_JSON")).toBe(true);
  });

  it("容错解析（G5）：结构非法（pages 非数组）返回 ok=false，不抛错", () => {
    const result = parseTolerantFormSchemaV2({ version: 2, pages: "invalid" });
    expect(result.ok).toBe(false);
    expect(result.schema).toBeNull();
  });

  it("容错解析（G5）：含校验 warning 的合法 schema 仍返回 ok=true 且不抛错", () => {
    const schema = makeSchema();
    schema.pages[0].children.push({ id: "text-1", type: "text", text: "" } as never); // EMPTY_STATIC_TEXT warning
    const result = parseTolerantFormSchemaV2(schema);
    expect(result.ok).toBe(true);
    expect(result.schema).not.toBeNull();
    expect(result.issues.some(issue => issue.code === "EMPTY_STATIC_TEXT")).toBe(true);
  });

  it("serializes HTML and image nodes and never emits trusted/bindings flags", () => {
    const schema = makeSchema();
    schema.pages[0].children.push(
      { id: "html-1", type: "html", html: "<b>hi</b>", css: "b{color:red}" } as never,
      { id: "img-1", type: "image", src: "data:image/png;base64,AAAA", field: "photo", width: 30, objectFit: "cover" } as never,
    );
    const restored = parseFormSchemaV2(serializeFormSchemaV2(schema));
    const children = restored.pages[0].children;
    const htmlNode = children.find(node => node.id === "html-1");
    const imageNode = children.find(node => node.id === "img-1");
    expect(htmlNode).toMatchObject({ type: "html", html: "<b>hi</b>", css: "b{color:red}" });
    expect((htmlNode as unknown as Record<string, unknown>).trusted).toBeUndefined();
    expect((htmlNode as unknown as Record<string, unknown>).bindings).toBeUndefined();
    expect(imageNode).toMatchObject({ type: "image", src: "data:image/png;base64,AAAA", field: "photo", width: 30, objectFit: "cover" });
  });
});

describe("旧字段触发配置迁移（action / actionParams → interactive / params）", () => {
  /** 以「旧格式 JSON」形态构造 schema——新类型已无 `action` / `actionParams`，故经 unknown 传入。 */
  function legacySchema(field: Record<string, unknown>): unknown {
    return {
      version: 2,
      paper: { size: "A4" },
      baseRowHeight: 8,
      pages: [
        {
          id: "page-1",
          type: "page",
          mode: "fixed",
          margin: { top: 10, right: 10, bottom: 10, left: 10 },
          children: [
            {
              id: "grid-1",
              type: "grid",
              border: "all",
              rows: [
                {
                  id: "row-1",
                  type: "grid-row",
                  height: 1,
                  cells: [
                    { id: "cell-1", type: "grid-cell", children: [] },
                    {
                      id: "cell-2",
                      type: "grid-cell",
                      children: [
                        {
                          id: "field-1",
                          type: "p",
                          mode: "field",
                          field: "计划工作时间_开始",
                          ...field,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
  }

  /** 读入并归一化后，取出那个字段节点。 */
  function migratedField(field: Record<string, unknown>) {
    const grid = normalizeFormSchemaV2(legacySchema(field)).pages[0].children[0];
    if (grid.type !== "grid") throw new Error("fixture root is not a grid");
    const node = grid.rows[0].cells[1].children[0];
    if (node.type !== "p" || node.mode !== "field") throw new Error("fixture field is not a field p node");
    return node;
  }

  it("action: date → params.action=\"datePicker\"（对齐宿主词表），并置 interactive", () => {
    const node = migratedField({ action: "date" });
    expect(node.interactive).toBe(true);
    expect(node.params).toEqual({ action: "datePicker" });
  });

  it("signature / upload → params.action=\"uploadImg\"（签名扫件复用图片上传通道）", () => {
    expect(migratedField({ action: "signature" }).params).toEqual({ action: "uploadImg" });
    expect(migratedField({ action: "upload" }).params).toEqual({ action: "uploadImg" });
  });

  it("actionParams.format → params[\"date-format\"]（对齐宿主读取的属性名）", () => {
    const node = migratedField({
      action: "date",
      actionParams: { format: "{YYYY}年{MM}月{DD}" },
    });
    expect(node.params).toEqual({
      action: "datePicker",
      "date-format": "{YYYY}年{MM}月{DD}",
    });
  });

  it("actionParams 中的未登记键原样保留（不猜宿主词表）", () => {
    const node = migratedField({
      action: "date",
      actionParams: { "date-validate": "after:计划工作时间_1" },
    });
    expect(node.params).toEqual({
      action: "datePicker",
      "date-validate": "after:计划工作时间_1",
    });
  });

  it("action: text 或未配置 → 不置 interactive、不产生 params", () => {
    const textNode = migratedField({ action: "text" });
    expect(textNode.interactive).toBeUndefined();
    expect(textNode.params).toBeUndefined();
    const bareNode = migratedField({});
    expect(bareNode.interactive).toBeUndefined();
    expect(bareNode.params).toBeUndefined();
  });

  it("未登记的 action 值原样保留（不猜宿主词表）", () => {
    const node = migratedField({ action: "someHostWidget" });
    expect(node.interactive).toBe(true);
    expect(node.params).toEqual({ action: "someHostWidget" });
  });

  it("已是新格式的 params 优先，不被旧 actionParams 覆盖", () => {
    const node = migratedField({
      action: "date",
      actionParams: { format: "{YYYY}" },
      params: { "date-format": "{YYYY}/{MM}/{DD}" },
    });
    expect(node.params).toEqual({
      action: "datePicker",
      "date-format": "{YYYY}/{MM}/{DD}",
    });
  });

  it("导出不再写出 action / actionParams（只剩新形态）", () => {
    const json = serializeFormSchemaV2(
      normalizeFormSchemaV2(
        legacySchema({ action: "date", actionParams: { format: "{YYYY}年{MM}月{DD}" } }),
      ),
    );
    expect(json).not.toContain("actionParams");
    expect(json).not.toContain('"action":"date"');
    expect(json).toContain('"action":"datePicker"');
    expect(json).toContain('"date-format":"{YYYY}年{MM}月{DD}"');
  });
});
