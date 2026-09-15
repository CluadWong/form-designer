/**
 * 云南铝业股份有限公司 电气第二种工作票 —— 完整版 Schema 样例
 *
 * 本样例与设计器 UI 完整编辑后导出的
 * 设计器 UI 导出的整票 JSON 逐字对齐，采用「扁平结构」：
 * 每个业务段为一个独立 grid，border 取 all / outer / none，内部列通过 `columns`
 * 描述；字段统一用 prefix / suffix / interactive / params / default / innerBorder 表达
 * （日期字段 interactive + `params.action="datePicker"`、签名字段 interactive +
 * `params.action="uploadImg"`、人数等用 innerBorder）。
 * 「额外属性」params 由宿主自行消费（内核不解释其键），见 `src/utils/node-params.ts`。
 * **取值对齐宿主词表**：宿主（soar-web-v3-td `useFcDesigner`）只认 `action="datePicker"`
 * 与 `action="uploadImg"`；签名扫件复用图片上传通道，故签名字段同样写 `uploadImg`。
 *
 * 与导出 JSON 的差异（按需求「改成有意义的键」）：
 * - 导出里「共/人」计数占位键 "字段" → 规范为 "工作班成员人数"；
 * - 导出里表格行模板占位键 "col1" / "col2" 依据引擎约定不写死（写 ""），
 *   实际字段键由列 key 派生为 工作地点_行号 / 工作内容_行号；
 * - 表头高度 / 行高倍数（导出里的 headerHeight / rowHeight）不在 GridNodeV2 /
 *   TableNodeV2 类型中，按引擎约定省略。
 *
 * 用途：
 * - 作为「载入样例」的完整模板（替换当前仅前五行的版本）；
 * - 验证 Schema V2 能否表达整张工作票的全部结构；
 * - P11 验收的参考基线（与设计器导出一致）。
 */
import type {
  BorderModeV2,
  FieldPNodeV2,
  FormNodeV2,
  FormSchemaV2,
  GridCellV2,
  GridNodeV2,
  GridRowV2,
  GridTrackV2,
  PNodeV2,
  TableCellTemplateV2,
  TableNodeV2,
  TextNodeV2,
  TextStyleV2,
} from "@/types";

// ── 辅助工厂 ──────────────────────────────────────────────────

const staticP = (
  id: string,
  text: string,
  style?: TextStyleV2,
): TextNodeV2 => ({ id, type: "text", text, style });

const fieldP = (
  id: string,
  field: string,
  options: Omit<Partial<FieldPNodeV2>, "id" | "type" | "mode" | "field"> = {},
): FieldPNodeV2 => ({
  id,
  type: "p",
  mode: "field",
  field,
  underline: true,
  ...options,
});

const cell = (
  id: string,
  children: FormNodeV2[],
  options: Omit<GridCellV2, "id" | "type" | "children"> = {},
): GridCellV2 => ({ id, type: "grid-cell", children, ...options });

const row = (id: string, height: number, cells: GridCellV2[]): GridRowV2 => ({
  id,
  type: "grid-row",
  height,
  cells,
});

/** 段网格工厂：border 决定段外框样式，columns 描述内部列轨（缺省回退到 cell.width）。 */
const grid = (
  id: string,
  border: BorderModeV2,
  rows: GridRowV2[],
  options: Omit<GridNodeV2, "id" | "type" | "border" | "rows"> = {},
): GridNodeV2 => ({ id, type: "grid", border, rows, ...options });

const tableTemplate = (
  id: string,
  columnKey: string,
  child: FormNodeV2,
): TableCellTemplateV2 => ({
  id,
  type: "table-cell-template",
  columnKey,
  children: [child],
});

/** 日期字段工厂：自动带「点击触发」与默认占位文本（无填写数据时回显）。
 *  控件类型经 `params.action` 交给宿主（内核不解释该键），故内核零改动即可换控件。
 *  取值 `datePicker` 对齐宿主词表（`useFcDesigner.openDialog` 的 case）。 */
const DATE_DEFAULT = "      年    月    日      时    分";
const dateField = (
  id: string,
  field: string,
  options: Omit<Partial<FieldPNodeV2>, "id" | "type" | "mode" | "field"> = {},
): FieldPNodeV2 =>
  fieldP(id, field, {
    interactive: true,
    params: { action: "datePicker" },
    default: DATE_DEFAULT,
    ...options,
  });

// ── Section 1: 标题 ───────────────────────────────────────────

const titleGrid = grid("title-grid", "none", [
  row("title-row", 1, [
    cell(
      "title-cell",
      [
        staticP("title", "云南铝业股份有限公司 电气第二种工作票", {
          align: "center",
          fontSize: 22,
          fontWeight: "bold",
          lineHeight: 1.6,
        }),
      ],
      { width: "1fr" },
    ),
  ]),
]);

// ── Section 2: 单位 / 编号 ────────────────────────────────────

const unitNumberGrid = grid(
  "basic-unit-number-grid",
  "all",
  [
    row("basic-unit-number-row", 1, [
      cell("unit-label-cell", [staticP("unit-label", "单位", { align: "center" })], {
        width: 20,
      }),
      cell("unit-field-cell", [fieldP("unit-field", "单位")], { width: "1fr" }),
      cell("number-label-cell", [staticP("number-label", "编号", { align: "center" })], {
        width: 20,
      }),
      cell("number-field-cell", [fieldP("number-field", "编号")], { width: "1fr" }),
    ]),
  ],
  { columns: [20, "1fr", 20, "1fr"] },
);

// ── Section 3: 工作负责人（监护人）/ 班组 ──────────────────────

const ownerTeamGrid = grid(
  "basic-owner-team-grid",
  "outer",
  [
    row("basic-owner-team-row", 1, [
      cell(
        "owner-field-cell",
        [fieldP("owner-field", "工作负责人（监护人）", { prefix: "工作负责人（监护人）：" })],
        { width: "1fr" },
      ),
      cell("team-field-cell", [fieldP("team-field", "班组", { prefix: "班组：" })], {
        width: "1fr",
      }),
    ]),
  ],
  { columns: ["1fr", "1fr"] },
);

// ── Section 4: 工作班成员（不含负责人）/ 共 X 人 ───────────────

const membersGrid = grid("basic-members-grid", "outer", [
  row("members-label-row", 1, [
    cell(
      "members-label-cell",
      [staticP("members-label", "工作班成员（不包括工作负责人）：")],
      { width: "1fr" },
    ),
  ]),
  row("members-field-row", 1, [
    cell("members-field-cell", [fieldP("members-field", "工作班成员")], {
      width: "1fr",
    }),
  ]),
  row("members-count-row", 1, [
    cell("members-count-cell", [
      grid(
        "members-count-grid",
        "none",
        [
          row("members-count-inner-row", 1, [
            cell("members-count-spacer-cell", [], { width: "1fr" }),
            cell(
              "members-count-field-cell",
              [
                fieldP("members-count-field", "工作班成员人数", {
                  prefix: "共",
                  suffix: "人",
                  innerBorder: true,
                }),
              ],
              { width: 30 },
            ),
          ]),
        ],
        { columns: ["1fr", 30] },
      ),
    ], { width: "1fr" }),
  ]),
]);

// ── Section 5: 变、配电站名称及设备名称 ───────────────────────

const stationGrid = grid("station-grid", "all", [
  row("station-row", 1, [
    cell(
      "station-field-cell",
      [fieldP("station-field", "电站设备", { prefix: "工作的变、配电站名称及设备名称：" })],
      { width: "1fr" },
    ),
  ]),
]);

// ── Section 6: 工作任务（内嵌表 + 计划工作时间） ───────────────

const workTaskTable: TableNodeV2 = {
  id: "work-task-table",
  type: "table",
  field: "工作任务",
  columns: [
    { key: "工作地点", title: "工作地点或地段", width: "1fr" },
    { key: "工作内容", title: "工作内容", width: "1fr" },
  ],
  minRows: 4,
  // 行模板字段键按引擎约定不写死（""），渲染期由列 key 派生 工作地点_行号 / 工作内容_行号
  rowTemplate: [
    tableTemplate("work-task-loc-tpl", "工作地点", fieldP("work-task-loc-p", "")),
    tableTemplate("work-task-content-tpl", "工作内容", fieldP("work-task-content-p", "")),
  ],
  border: "inner",
};

const workTaskGrid = grid(
  "work-task-grid",
  "all",
  [
    row("work-task-row", 1, [
      cell("work-task-label-cell", [staticP("work-task-label", "工作任务", { align: "center" })], {
        width: 30,
      }),
      cell("work-task-table-cell", [workTaskTable], { width: "1fr" }),
    ]),
    row("schedule-row", 1, [
      cell("schedule-label-cell", [staticP("schedule-label", "计划工作时间", { align: "center" })], {
        width: 30,
      }),
      cell("schedule-fields-cell", [
        grid(
          "schedule-grid",
          "none",
          [
            row("schedule-inner-row", 1, [
              cell(
                "schedule-from-cell",
                [dateField("schedule-from", "计划工作时间_开始", { prefix: "自" })],
                { width: "1fr" },
              ),
              cell(
                "schedule-to-cell",
                [dateField("schedule-to", "计划工作时间_截止", { prefix: "至" })],
                { width: "1fr" },
              ),
            ]),
          ],
          { columns: ["1fr", "1fr"] },
        ),
      ], { width: "1fr" }),
    ]),
  ],
  { columns: [30, "1fr"] },
);

// ── Section 7: 工作条件 ───────────────────────────────────────

const conditionGrid = grid("condition-grid", "outer", [
  row("condition-label-row", 1, [
    cell(
      "condition-label-cell",
      [staticP("condition-label", "工作条件（停电或不停电，或邻近及保留带电设备名称）：\n")],
      { width: "1fr" },
    ),
  ]),
  row("condition-field-row", 1, [
    cell("condition-field-cell", [fieldP("condition-field", "工作条件")], { width: "1fr" }),
  ]),
]);

// ── Section 8: 注意事项（安全措施）/ 签发 ─────────────────────

const safetyGrid = grid("safety-grid", "outer", [
  row("notice-label-row", 1, [
    cell("notice-label-cell", [staticP("notice-label", "注意事项（安全措施）：")], {
      width: "1fr",
    }),
  ]),
  row("notice-field-row", 1, [
    cell("notice-field-cell", [fieldP("notice-field", "安全措施")], { width: "1fr" }),
  ]),
  row("notice-remark-row", 1, [
    cell("notice-remark-cell", [fieldP("notice-remark-field", "安措备注", { prefix: "备注：" })], {
      width: "1fr",
    }),
  ]),
  row("issuer-row", 1, [
    cell("issuer-cell", [
      grid(
        "issuer-grid",
        "none",
        [
          row("issuer-inner-row", 1, [
            cell(
              "issuer-sign-cell",
              [fieldP("issuer-sign-field", "工作票签发人签名", { prefix: "工作票签发人签名：", interactive: true, params: { action: "uploadImg" } })],
              { width: "1fr" },
            ),
            cell(
              "issue-date-cell",
              [dateField("issue-date-field", "签发日期", { prefix: "签发日期：" })],
              { width: "1fr" },
            ),
          ]),
        ],
        { columns: ["1fr", "1fr"] },
      ),
    ], { width: "1fr" }),
  ]),
]);

// ── Section 9: 补充安全措施 ───────────────────────────────────

const supplementGrid = grid("supplement-grid", "outer", [
  row("supplement-label-row", 1, [
    cell("supplement-label-cell", [staticP("supplement-label", "补充安全措施：")], {
      width: "1fr",
    }),
  ]),
  row("supplement-field-row", 1, [
    cell("supplement-field-cell", [fieldP("supplement-field", "补充安全措施")], {
      width: "1fr",
    }),
  ]),
  row("supplement-remark-row", 1, [
    cell(
      "supplement-remark-cell",
      [fieldP("supplement-remark-field", "补充安措备注", { prefix: "备注：" })],
      { width: "1fr" },
    ),
  ]),
]);

// ── Section 10: 确认本工作票上述各项内容 ─────────────────────

const confirmGrid = grid(
  "confirm-grid",
  "outer",
  [
    row("confirm-header-row", 1, [
      cell("confirm-header-cell", [staticP("confirm-header", "确认本工作票上述各项内容：")], {
        width: "1fr",
      }),
      cell("confirm-header-spacer-cell", [], { width: "1fr" }),
    ]),
    row("confirm-sign-row", 1, [
      cell(
        "confirm-owner-cell",
        [fieldP("confirm-owner-sign", "工作负责人签名", { prefix: "工作负责人签名：", interactive: true, params: { action: "uploadImg" } })],
        { width: "1fr" },
      ),
      cell(
        "confirm-permitter-cell",
        [fieldP("confirm-permitter-sign", "工作许可人签名", { prefix: "工作许可人签名：", interactive: true, params: { action: "uploadImg" } })],
        { width: "1fr" },
      ),
    ]),
    row("permit-time-row", 1, [
      cell(
        "permit-time-cell",
        [dateField("permit-time-field", "许可工作时间", { prefix: "许可工作时间：" })],
        { width: "1fr" },
      ),
      cell("permit-time-spacer-cell", [], { width: "1fr" }),
    ]),
  ],
  { columns: ["1fr", "1fr"] },
);

// ── Section 11: 确认工作负责人布置的工作任务和安全措施 ────────

const confirmTaskGrid = grid("confirm-task-grid", "outer", [
  row("confirm-task-label-row", 1, [
    cell(
      "confirm-task-label-cell",
      [staticP("confirm-task-label", "确认工作负责人布置的工作任务和安全措施：")],
      { width: "1fr" },
    ),
  ]),
  row("confirm-task-sign-row", 1, [
    cell(
      "confirm-task-sign-cell",
      [fieldP("confirm-task-sign", "工作班成员签名", { prefix: "工作班成员签名：" })],
      { width: "1fr" },
    ),
  ]),
]);

// ── Section 12: 工作票延期 ───────────────────────────────────

const extensionGrid = grid(
  "extension-grid",
  "outer",
  [
    row("extension-header-row", 1, [
      cell("extension-header-cell", [staticP("extension-header", "工作票延期：")], {
        width: "1fr",
      }),
      cell("extension-header-spacer-cell", [], { width: "1fr" }),
    ]),
    row("extension-expire-row", 1, [
      cell(
        "extension-expire-cell",
        [dateField("extension-expire-field", "有效期延长到", { prefix: "有效期延长到：" })],
        { width: "1fr" },
      ),
      cell("extension-expire-spacer-cell", [], { width: "1fr" }),
    ]),
    row("extension-owner-row", 1, [
      cell(
        "extension-owner-cell",
        [fieldP("extension-owner-sign", "延期工作负责人签名", { prefix: "工作负责人签名：", interactive: true, params: { action: "uploadImg" } })],
        { width: "1fr" },
      ),
      cell(
        "extension-owner-date-cell",
        [dateField("extension-owner-date", "延期工作负责人签名日期", { prefix: "日期：" })],
        { width: "1fr" },
      ),
    ]),
    row("extension-permitter-row", 1, [
      cell(
        "extension-permitter-cell",
        [fieldP("extension-permitter-sign", "延期工作许可人签名", { prefix: "工作许可人签名：", interactive: true, params: { action: "uploadImg" } })],
        { width: "1fr" },
      ),
      cell(
        "extension-permitter-date-cell",
        [dateField("extension-permitter-date", "延期工作许可人签名日期", { prefix: "日期：" })],
        { width: "1fr" },
      ),
    ]),
  ],
  { columns: ["1fr", "1fr"] },
);

// ── Section 13: 工作票终结 ───────────────────────────────────

const completionGrid = grid(
  "completion-grid",
  "outer",
  [
    row("completion-header-row", 1, [
      cell("completion-header-cell", [staticP("completion-header", "工作票终结：")], {
        width: "1fr",
      }),
      cell("completion-header-spacer-cell", [], { width: "1fr" }),
    ]),
    row("completion-end-row", 1, [
      cell(
        "completion-end-cell",
        [
          dateField("completion-end-field", "工作票终结日期", {
            prefix: "全部工作于",
            suffix: "结束，工作人员已全部撤离，材料工具已清理完毕。",
          }),
        ],
        { width: "1fr", colspan: 2 },
      ),
    ]),
    row("completion-owner-row", 1, [
      cell(
        "completion-owner-cell",
        [fieldP("completion-owner-sign", "工作负责人签名-终结", { prefix: "工作负责人签名：", interactive: true, params: { action: "uploadImg" } })],
        { width: "1fr" },
      ),
      cell(
        "completion-owner-date-cell",
        [dateField("completion-owner-date", "工作负责人签名-终结日期", { prefix: "日期：" })],
        { width: "1fr" },
      ),
    ]),
    row("completion-permitter-row", 1, [
      cell(
        "completion-permitter-cell",
        [fieldP("completion-permitter-sign", "工作许可人签名-终结", { prefix: "工作许可人签名：", interactive: true, params: { action: "uploadImg" } })],
        { width: "1fr" },
      ),
      cell(
        "completion-permitter-date-cell",
        [dateField("completion-permitter-date", "工作许可人签名-终结日期", { prefix: "日期：" })],
        { width: "1fr" },
      ),
    ]),
  ],
  { columns: ["1fr", "1fr"] },
);

// ── 组装完整 Schema ───────────────────────────────────────────
//
// 扁平结构：page.children 为 13 个独立 grid，每段自带 border 与 columns，
// 相邻段外框由渲染器 suppressBorders 去重（仅画 1 条分隔线，无 2px 双边框）。
// 与设计器 UI 导出的整票 JSON 一致。

export function makeYunlvSecondTicketFullSchema(): FormSchemaV2 {
  return {
    version: 2,
    paper: { size: "A4" },
    baseRowHeight: 8,
    pages: [
      {
        id: "ticket-page-full",
        type: "page",
        mode: "fixed",
        margin: { top: 10, right: 10, bottom: 10, left: 10 },
        children: [
          titleGrid,
          unitNumberGrid,
          ownerTeamGrid,
          membersGrid,
          stationGrid,
          workTaskGrid,
          conditionGrid,
          safetyGrid,
          supplementGrid,
          confirmGrid,
          confirmTaskGrid,
          extensionGrid,
          completionGrid,
        ],
      },
    ],
  };
}
