import type {
  FieldRuleV2,
  FormDataV2,
  FormNodeV2,
  FormSchemaV2,
  GridCellV2,
  GridNodeV2,
  ImageNodeV2,
  TableNodeV2,
} from "@/types";
// 字号区间常量住类型层（schema 约束），引擎与设计器面板共用，保持 types ← engine 的依赖方向。
import { FONT_SIZE_MAX_PX, FONT_SIZE_MIN_PX } from "@/types";

/**
 * 渲染期领域逻辑（B4 归 engine）。
 *
 * 原本这些"派生 / 布局 / 取值计算"散落在 `@/types`（schema-v2-operations /
 * schema-v2-table-rows），导致渲染组件必须 import 类型层才能拿到计算逻辑。
 * 现统一收口到 engine：渲染组件（GridSchemaNode / FormDesigner）只做视图映射，
 * 按 `列key_行号` 派生字段、表格动态行数、字段清单枚举、单元格盒解析均由本模块负责。
 */

// ---------------------------------------------------------------------------
// 单元格盒解析（布局）
// ---------------------------------------------------------------------------

export interface ResolvedCellBoxV2 {
  padding: number;
  align: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
}

/**
 * 解析图片节点的可显示来源（渲染 / 分页高度估算共用同一真相源）。
 *
 * 取值优先级（与渲染层历史行为一致）：
 * 1. 非设计态且配了 `field`、**数据里该字段有值** → 用数据值（可覆盖 `src`）；
 * 2. 否则用 `src`；
 * 3. 都没有 → **`null`（无来源）**，渲染层显示占位灰框、分页按 0 高度计。
 *
 * ⚠️ 渲染层与分页估算必须与本函数同口径：屏幕/打印不显示的东西，就不能在分页里占高度，
 *    否则会出现「图片没打印出来却多出一张空白纸」。
 */
export function resolveImageSourceV2(
  node: ImageNodeV2,
  options: { data?: FormDataV2 | null; isDesign?: boolean } = {},
): string | null {
  if (!options.isDesign && node.field) {
    const fromData = options.data?.[node.field];
    if (fromData != null) return String(fromData);
  }
  return node.src && node.src !== "" ? node.src : null;
}

/**
 * 文本 / 字段的默认字号（px）与行高倍数：schema 未设时的引擎 + CSS 默认，设计器面板据此显示生效值。
 * 单一真源——`GridSchemaNode.vue` 的 `.layout-p` / `.layout-text` CSS 与 `pagination.ts`
 * 的高度估算都必须与这两个值保持一致（CSS 无法 import，改动时三处同改）。
 */
export const DEFAULT_TEXT_FONT_SIZE_PX = 13;
export const DEFAULT_TEXT_LINE_HEIGHT = 1.6;
/**
 * 表格表头默认字号（px）：对应 `.layout-table__header` 的 CSS 默认，
 * 也是「表头相对正文」的比例基准（`DEFAULT_TABLE_HEADER_FONT_SIZE_PX / DEFAULT_TEXT_FONT_SIZE_PX`）。
 */
export const DEFAULT_TABLE_HEADER_FONT_SIZE_PX = 16;

/** 字号是否为可用的正数（面板输入 / schema 值共用的判定）。 */
function isValidFontSize(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * 解析**全局基础字号**（px）：页面属性配置的全局默认字号，作用于所有未显式设
 * `style.fontSize` 的文字。未设 / 非法时回退引擎默认 13 —— 即「不写 = 不变」。
 *
 * 渲染层（纸张上的 CSS 变量）与分页估算（`pagination.textHeightMm`）必须共用本函数，
 * 否则「屏幕上看到多大字、分页就按多大字算高」不成立，会出现多页空白 / 内容溢出。
 */
export function resolveBaseFontSizeV2(schema: Pick<FormSchemaV2, "baseFontSize">): number {
  const value = schema.baseFontSize;
  if (!isValidFontSize(value)) return DEFAULT_TEXT_FONT_SIZE_PX;
  return Math.max(FONT_SIZE_MIN_PX, Math.min(FONT_SIZE_MAX_PX, value));
}

/**
 * 表头默认字号（px）= 基础字号 × (16 / 13)，取整。
 *
 * 表头是「比正文大一号」的既有观感（CSS 默认 16 vs 正文 13）。全局基础字号调整时按同一
 * 比例缩放，改大字号后表头不会反而比正文小。基础字号 = 13（默认）时结果恰为 16 —— 与旧外观一致。
 * 面板显示与渲染共用本函数，保证「面板所见 = 实际生效」。
 */
export function resolveTableHeaderFontSizeV2(baseFontSize: number): number {
  const base = isValidFontSize(baseFontSize) ? baseFontSize : DEFAULT_TEXT_FONT_SIZE_PX;
  return Math.round((base * DEFAULT_TABLE_HEADER_FONT_SIZE_PX) / DEFAULT_TEXT_FONT_SIZE_PX);
}

/** 单元格默认内边距（mm）：schema 未设时的引擎默认，设计器面板据此显示生效值。 */
export const DEFAULT_CELL_PADDING = 0;
/**
 * 单元格默认行高倍数（相对基准行高）：`cell.rowHeight` 未设时行高由所在行的
 * `row.height` 决定，故 1 为其下限（等价于「未覆盖」，见 `pagination.gridRowHeightMm`）。
 * 面板显示此值而非留空。
 */
export const DEFAULT_CELL_ROW_HEIGHT = 1;
/** 单元格默认水平对齐：schema 未设时的引擎默认。 */
export const DEFAULT_CELL_ALIGN: "left" | "center" | "right" = "center";
/** 单元格默认垂直对齐：schema 未设时的引擎默认。 */
export const DEFAULT_CELL_VERTICAL_ALIGN: "top" | "middle" | "bottom" = "middle";

/** 解析单元格的内边距 / 对齐：cell 覆盖优先，否则继承 Grid 默认，再否则取引擎常量。 */
export function resolveCellBoxV2(
  cell: GridCellV2,
  grid: GridNodeV2,
): ResolvedCellBoxV2 {
  return {
    padding: cell.padding ?? grid.cellPadding ?? DEFAULT_CELL_PADDING,
    align: cell.align ?? grid.cellAlign ?? DEFAULT_CELL_ALIGN,
    verticalAlign:
      cell.verticalAlign ?? grid.cellVerticalAlign ?? DEFAULT_CELL_VERTICAL_ALIGN,
  };
}

// ---------------------------------------------------------------------------
// 表格字段派生
// ---------------------------------------------------------------------------

/**
 * 表格列内字段的命名规则：`列key_行号`（行号 1-based）。
 * 例：列 key 为 `工作地点`，第 3 行的字段为 `工作地点_3`。
 */
export function buildTableRowField(columnKey: string, rowIndex: number): string {
  return `${columnKey}_${rowIndex}`;
}

/**
 * 把表格单元格节点（及其后代 Grid 内的字段 P）的字段绑定到派生名 `列key_行号`。
 * 仅字段 P（`mode: "field"`）被重写；Text / HTML / Image / Table 等保持原样。
 * 嵌套 Grid 内的字段 P 也一并派生（沿用同一 `列key_行号`），保持与表格行一致。
 * 空字符串 field 会被覆盖（派生名非空），故 schema 中手写值无影响。
 */
export function bindTableRowCell(
  node: FormNodeV2,
  columnKey: string,
  rowIndex: number,
): FormNodeV2 {
  const field = buildTableRowField(columnKey, rowIndex);
  const bound: FormNodeV2 =
    node.type === "p" && node.mode === "field"
      ? ({ ...node, field } as FormNodeV2)
      : node;
  if (bound.type === "grid") {
    return {
      ...bound,
      rows: bound.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => ({
          ...cell,
          children: cell.children.map((child) => bindTableRowCell(child, columnKey, rowIndex)),
        })),
      })),
    };
  }
  return bound;
}

/** 解析 `列key_行号` 中的行号；非该格式返回 null。用于从 data 键反推最大行号。 */
function parseTableRowIndex(dataKey: string, columnKey: string): number | null {
  const prefix = `${columnKey}_`;
  if (!dataKey.startsWith(prefix)) return null;
  const tail = dataKey.slice(prefix.length);
  if (!/^\d+$/.test(tail)) return null;
  const row = Number(tail);
  return Number.isFinite(row) ? row : null;
}

/**
 * 表格运行时行数 = max(配置行数 `minRows`, data 中实际出现过的最大行号)。
 *
 * 表格「可重复 / 动态行」**不是一个 schema 属性**，而是渲染期按 data 推导的行为——
 * 只要 data 里存在超出 `minRows` 的行数据，就要补渲染对应行，保证 data 能被完整看到。
 * 无 data（设计态）、或行模板字段不含有效 `列key_` 前缀时，行数 = `minRows`。
 */
export function resolveTableRowCount(
  node: TableNodeV2,
  data: FormDataV2 | null | undefined,
): number {
  const configured = Number.isFinite(node.minRows) ? Math.max(0, Math.floor(node.minRows)) : 0;
  if (!data) return configured;
  let maxRow = 0;
  for (const column of node.columns) {
    for (const dataKey of Object.keys(data)) {
      const row = parseTableRowIndex(dataKey, column.key);
      if (row != null && row > maxRow) maxRow = row;
    }
  }
  return Math.max(configured, maxRow);
}

// ---------------------------------------------------------------------------
// 字段清单枚举（取值计算，供消费页取数 / 导出 / 校验）
// ---------------------------------------------------------------------------

export interface SchemaFieldInfo {
  key: string;
  kind: "field" | "table-field";
  tableField?: string;
  row?: number;
  label?: string;
}

/**
 * 收集整张 Schema 的完整字段清单（替代 `collectFieldKeys` 仅收手写 field 的局限）。
 *
 * 遍历口径与渲染期 `bindTableRowCell` / `tableTemplate` 完全一致：
 * - 普通字段 P（不在表格内）→ 直接取 `node.field`；
 * - 表格 → 对每列 × `resolveTableRowCount(node, data)` 行，按 `template.columnKey` 配对模板单元格，
 *   生成派生字段 `列key_行号`（kind=table-field）；模板内（含嵌套 Grid）的字段 P 同样绑定到该 `列key_行号`；
 * - 嵌套 Grid / 嵌套 Table 递归处理（嵌套 Table 独立派生自身列字段）。
 */
export function collectSchemaFields(
  schema: FormSchemaV2,
  data?: FormDataV2 | null,
): SchemaFieldInfo[] {
  const out: SchemaFieldInfo[] = [];
  const visit = (node: FormNodeV2, tableCtx?: { columnKey: string; rowIndex: number }): void => {
    if (node.type === "p" && node.mode === "field") {
      if (tableCtx) {
        out.push({
          key: buildTableRowField(tableCtx.columnKey, tableCtx.rowIndex),
          kind: "table-field",
          tableField: tableCtx.columnKey,
          row: tableCtx.rowIndex,
        });
      } else if (node.field) {
        out.push({ key: node.field, kind: "field" });
      }
      return;
    }
    if (node.type === "table") {
      const rowCount = resolveTableRowCount(node, data ?? null);
      for (const column of node.columns) {
        const template = node.rowTemplate.find(t => t.columnKey === column.key);
        if (!template) continue;
        for (let r = 1; r <= rowCount; r += 1) {
          for (const child of template.children) {
            visit(child, { columnKey: column.key, rowIndex: r });
          }
        }
      }
      return;
    }
    if (node.type === "grid") {
      for (const row of node.rows) {
        for (const cell of row.cells) {
          for (const child of cell.children) {
            visit(child, tableCtx);
          }
        }
      }
    }
  };
  for (const page of schema.pages) {
    for (const child of page.children) {
      visit(child);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 必填校验（P9.2c）
// ---------------------------------------------------------------------------

/**
 * 找出当前数据下「值为空」的必填字段（P9.2c 提交校验的引擎侧真相源）。
 *
 * - **规则由消费方经 props 注入**（`FormRenderer` 的 `options.rules`，P9.2c 用户拍板），
 *   与 `data` / `fieldPermissions` 同轨、**不进 schema**——「哪些字段必填」是消费
 *   会话的采集策略，模板不携带。
 * - 空值口径：键缺失 / `undefined` / `""` / 纯空白串都算空。
 * - 只校验 `rules` 里声明了 `required: true` 的键；规则键应为 schema 字段名
 *   （指向不存在字段的规则永远校验失败，会让配置错误自然浮出水面）。
 * - 返回字段名数组（按 rules 声明顺序，天然去重——对象键唯一）。
 */
export function findEmptyRequiredFields(
  rules: Record<string, FieldRuleV2> | undefined,
  data: FormDataV2 | null | undefined,
): string[] {
  if (!rules) return [];
  const isBlank = (value: unknown): boolean =>
    typeof value !== "string" || value.trim() === "";
  return Object.entries(rules)
    .filter(([, rule]) => rule?.required === true)
    .map(([field]) => field)
    .filter((field) => isBlank(data?.[field]));
}
