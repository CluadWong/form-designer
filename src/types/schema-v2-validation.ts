import type {
  EditorNodeV2,
  FormNodeV2,
  FormSchemaV2,
  GridCellV2,
  GridNodeV2,
  GridRowV2,
  GridTrackV2,
  PageSchemaV2,
  PNodeV2,
  TableNodeV2,
} from "./schema-v2";
import { resolvePaperSizeV2 } from "./schema-v2";
import { buildEditorNodeIndexV2 } from "./schema-v2-index";

export interface SchemaIssueV2 {
  level: "error" | "warning";
  code: string;
  nodeId?: string;
  path?: Array<string | number>;
  message: string;
}

function issue(
  issues: SchemaIssueV2[],
  level: SchemaIssueV2["level"],
  code: string,
  node: EditorNodeV2 | undefined,
  path: Array<string | number> | undefined,
  message: string,
): void {
  issues.push({ level, code, nodeId: node?.id, path, message });
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isValidTrack(value: unknown): boolean {
  if (value === "auto") return true;
  if (typeof value === "number") return isPositiveNumber(value);
  return typeof value === "string" && /^\d+(?:\.\d+)?fr$/.test(value);
}

const MM_PER_PX = 25.4 / 96;
const DEFAULT_P_FONT_SIZE_PX = 13;
const FIELD_P_MIN_INPUT_WIDTH_MM = 12;

function isWideChar(char: string): boolean {
  return /[\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(char);
}

/** Deterministic single-line text width estimate in mm; CJK/full-width chars count as 1em. */
function estimateTextWidthMm(text: string, fontSizePx: number): number {
  let ems = 0;
  for (const char of text) ems += isWideChar(char) ? 1 : 0.5;
  return ems * fontSizePx * MM_PER_PX;
}

function formatMm(value: number): string {
  return `${Math.round(value * 10) / 10}`;
}

interface CellWidthContextV2 {
  widthMm: number;
  paddingMm: number;
}

function validatePWidthOverflow(
  node: PNodeV2,
  context: CellWidthContextV2 | undefined,
  path: Array<string | number>,
  issues: SchemaIssueV2[],
): void {
  if (!context || node.style?.writingMode === "vertical-rl") return;
  const fontSizePx = node.style?.fontSize ?? DEFAULT_P_FONT_SIZE_PX;
  let estimatedWidthMm: number | undefined;
  if (node.prefix || node.suffix) {
    // Composite field P renders prefix + minimum-width input area + suffix; labels do not wrap.
    estimatedWidthMm =
      estimateTextWidthMm(`${node.prefix ?? ""}${node.suffix ?? ""}`, fontSizePx) +
      FIELD_P_MIN_INPUT_WIDTH_MM;
  }
  if (estimatedWidthMm === undefined) return;
  const availableMm = context.widthMm - 2 * context.paddingMm;
  if (estimatedWidthMm > availableMm) {
    issue(
      issues,
      "warning",
      "CONTENT_OVERFLOW",
      node,
      path,
      `字段内容估算宽度约 ${formatMm(estimatedWidthMm)}mm，超过可用宽度 ${formatMm(availableMm)}mm，可能显示不全`,
    );
  }
}

function minNodeHeightMm(node: FormNodeV2, baseRowHeight: number): number {
  if (node.type === "grid") {
    return node.rows.reduce((total, row) => total + Math.max(0, row.height), 0) * baseRowHeight;
  }
  if (node.type === "p") return baseRowHeight;
  if (node.type === "table") {
    // 表头与数据行均固定为 1× 基准行高（表头高度 / 行高倍数配置已移至单元格）。
    return Math.max(0, 1 + node.minRows) * baseRowHeight;
  }
  if (node.type === "image") {
    // 与渲染 / 分页同口径：没配地址的图片不占版面，估高为 0（避免误报「内容超高」）。
    // 静态校验拿不到 data，故只按 schema 层判定——配了 `field` 就认为填数时可能有图（宁可高估）。
    // 此判定与 `engine-v2/derivation.resolveImageSourceV2` 在无 data 时等价。
    if (!node.src && !node.field) return 0;
    return Math.max(0, node.height ?? 0);
  }
  return 0;
}

function pageUsableHeightMm(schema: FormSchemaV2, page: PageSchemaV2): number {
  // 与渲染纸张、打印 @page 共用同一尺寸解析（方向由纸张尺寸派生：A4 纵向 / A3 横向）。
  const { heightMm } = resolvePaperSizeV2(schema.paper);
  return heightMm - page.margin.top - page.margin.bottom;
}

function validatePageOverflow(
  schema: FormSchemaV2,
  page: PageSchemaV2,
  path: Array<string | number>,
  issues: SchemaIssueV2[],
): void {
  const contentMinHeightMm = page.children.reduce(
    (total, child) => total + minNodeHeightMm(child, schema.baseRowHeight),
    0,
  );
  const usableHeightMm = pageUsableHeightMm(schema, page);
  if (contentMinHeightMm > usableHeightMm) {
    issue(
      issues,
      "warning",
      "PAPER_OVERFLOW",
      page,
      path,
      `页面内容最低高度约 ${formatMm(contentMinHeightMm)}mm，超过一页可用高度 ${formatMm(usableHeightMm)}mm，打印时会自动分成多页`,
    );
  }
}

/** Sums numeric mm tracks across [start, start+count); returns undefined if any
 *  track is fr/auto (cannot be estimated in mm) so overflow check is skipped. */
function effectiveColumnWidthMm(
  columns: GridTrackV2[] | undefined,
  start: number,
  count: number,
): number | undefined {
  if (!columns) return undefined;
  let total: number | undefined = 0;
  for (let i = start; i < start + count; i += 1) {
    const track = columns[i];
    if (typeof track === "number" && isPositiveNumber(track)) {
      total = (total ?? 0) + track;
    } else {
      return undefined;
    }
  }
  return total;
}

function validateGrid(
  node: GridNodeV2,
  path: Array<string | number>,
  issues: SchemaIssueV2[],
): void {
  if (!Array.isArray(node.rows) || node.rows.length === 0) {
    issue(issues, "error", "INVALID_GRID_ROWS", node, path, "格子至少需要一行");
    return;
  }
  node.rows.forEach((row, rowIndex) => validateRow(row, node, [...path, "rows", rowIndex], issues));
  if (node.gap !== undefined && !isPositiveNumber(node.gap)) {
    issue(issues, "warning", "INVALID_GRID_GAP", node, path, "格子间距必须是正数（mm）");
  }
}

function validateRow(
  row: GridRowV2,
  grid: GridNodeV2,
  path: Array<string | number>,
  issues: SchemaIssueV2[],
): void {
  if (!isPositiveNumber(row.height)) {
    issue(issues, "error", "INVALID_ROW_HEIGHT", row, path, "行高必须是正数");
  }
  if (!Array.isArray(row.cells) || row.cells.length === 0) {
    issue(issues, "error", "INVALID_GRID_CELLS", row, path, "该行至少需要一个格子");
    return;
  }
  let occupiedColumns = 0;
  row.cells.forEach((cell, cellIndex) => {
    validateCell(cell, [...path, "cells", cellIndex], issues);
    const span = cell.colspan ?? 1;
    if (!Number.isInteger(span) || span < 1) {
      issue(issues, "error", "INVALID_COLSPAN", cell, [...path, "cells", cellIndex], "合并格数必须是正整数");
    }
    occupiedColumns += Number.isInteger(span) && span > 0 ? span : 0;
  });
  if (grid.rows.some(current => current.cells.length > 0) && occupiedColumns < 1) {
    issue(issues, "error", "INVALID_GRID_COLUMNS", grid, path, "该行没有可用的格子");
  }
}

function validateCell(cell: GridCellV2, path: Array<string | number>, issues: SchemaIssueV2[]): void {
  if (cell.width !== undefined && !isValidTrack(cell.width)) {
    issue(issues, "error", "INVALID_CELL_WIDTH", cell, path, "格子宽度必须是正数（mm）、比例（如 1fr）或 auto");
  }
  if (cell.padding !== undefined && (!Number.isFinite(cell.padding) || cell.padding < 0)) {
    issue(issues, "error", "INVALID_CELL_PADDING", cell, path, "内边距不能是负数");
  }
}

function validateTable(node: TableNodeV2, path: Array<string | number>, issues: SchemaIssueV2[]): void {
  if (!Array.isArray(node.columns) || node.columns.length === 0) {
    issue(issues, "error", "INVALID_TABLE_COLUMNS", node, path, "表格至少需要一列");
    return;
  }
  const keys = new Set<string>();
  node.columns.forEach((column, columnIndex) => {
    const columnPath = [...path, "columns", columnIndex];
    if (!column.key.trim() || keys.has(column.key)) {
      issue(issues, "error", "DUPLICATE_TABLE_COLUMN", node, columnPath, `列字段重复或为空：${column.key}`);
    }
    keys.add(column.key);
    if (column.width !== undefined && !isValidTrack(column.width)) {
      issue(issues, "error", "INVALID_TABLE_COLUMN_WIDTH", node, columnPath, `列「${column.key}」的宽度不合法`);
    }
  });
  if (!Number.isInteger(node.minRows) || node.minRows < 0) {
    issue(issues, "error", "INVALID_TABLE_MIN_ROWS", node, path, "表格最小行数必须是不小于 0 的整数");
  }
  const templateKeys = new Set<string>();
  node.rowTemplate.forEach((template, templateIndex) => {
    const templatePath = [...path, "rowTemplate", templateIndex];
    if (!keys.has(template.columnKey) || templateKeys.has(template.columnKey)) {
      issue(issues, "error", "INVALID_TABLE_TEMPLATE", template, templatePath, `行模板引用了不存在的列：${template.columnKey}`);
    }
    templateKeys.add(template.columnKey);
  });
  for (const key of keys) {
    if (!templateKeys.has(key)) {
      issue(issues, "warning", "MISSING_TABLE_TEMPLATE", node, path, `列「${key}」缺少行模板`);
    }
  }
}

function scanNode(
  node: FormNodeV2,
  path: Array<string | number>,
  issues: SchemaIssueV2[],
  fields: Map<string, string>,
  cellContext: CellWidthContextV2 | undefined,
  insideTableRowTemplate = false,
): void {
  // 未知节点类型：标记为 error（严格解析将抛错；容错解析收集后降级为跳过）。
  // html 为已知类型（渲染期清洗后展示），此处不校验、不报错，与既有行为一致。
  const KNOWN_NODE_TYPES = new Set(["text", "p", "grid", "table", "image", "html"]);
  if (!KNOWN_NODE_TYPES.has(node.type)) {
    issue(
      issues,
      "error",
      "UNKNOWN_NODE_TYPE",
      node as unknown as EditorNodeV2,
      path,
      `未知组件类型：${String((node as { type?: unknown }).type)}`,
    );
    return;
  }
  if (node.type === "text") {
    if (cellContext && node.style?.writingMode !== "vertical-rl") {
      const fontSizePx = node.style?.fontSize ?? DEFAULT_P_FONT_SIZE_PX;
      const estimatedWidthMm = estimateTextWidthMm(node.text, fontSizePx);
      const availableMm = cellContext.widthMm - 2 * cellContext.paddingMm;
      if (estimatedWidthMm > availableMm) {
        issue(
          issues,
          "warning",
          "CONTENT_OVERFLOW",
          node,
          path,
          `文本估算宽度约 ${formatMm(estimatedWidthMm)}mm，超过格子可用宽度 ${formatMm(availableMm)}mm，可能显示不全`,
        );
      }
    }
    if (!node.text.trim()) {
      issue(issues, "warning", "EMPTY_STATIC_TEXT", node, path, "文本内容为空");
    }
  } else if (node.type === "p") {
    validatePWidthOverflow(node, cellContext, path, issues);
    // 表格行模板内字段 P 的 field 由列配置派生（列key_行号），schema 中不手写，
    // 故跳过 EMPTY_FIELD / DUPLICATE_FIELD 命名检查（避免派生型字段误报）。
    if (node.mode === "field" && !insideTableRowTemplate) {
      if (!node.field.trim()) {
        issue(issues, "warning", "EMPTY_FIELD", node, path, "字段名为空");
      } else if (fields.has(node.field)) {
        issue(issues, "warning", "DUPLICATE_FIELD", node, path, `字段名已被其他字段使用：${node.field}`);
      } else {
        fields.set(node.field, node.id);
      }
    }
  } else if (node.type === "grid") {
    validateGrid(node, path, issues);
    node.rows.forEach((row, rowIndex) => {
      let startColumn = 0;
      row.cells.forEach((cell, cellIndex) => {
        const span = cell.colspan ?? 1;
        const widthMm =
          span === 1
            ? effectiveColumnWidthMm(node.columns, startColumn, 1) ??
              (typeof cell.width === "number" && isPositiveNumber(cell.width) ? cell.width : undefined)
            : undefined;
        const context: CellWidthContextV2 | undefined =
          widthMm !== undefined
            ? { widthMm, paddingMm: cell.padding ?? node.cellPadding ?? 0 }
            : undefined;
        cell.children.forEach((child, childIndex) =>
          scanNode(child, [...path, "rows", rowIndex, "cells", cellIndex, "children", childIndex], issues, fields, context, insideTableRowTemplate),
        );
        startColumn += span;
      });
    });
  } else if (node.type === "table") {
    validateTable(node, path, issues);
    node.rowTemplate.forEach((template, templateIndex) => {
      const column = node.columns.find(column => column.key === template.columnKey);
      const context: CellWidthContextV2 | undefined =
        column && typeof column.width === "number" && isPositiveNumber(column.width)
          ? { widthMm: column.width, paddingMm: 0 }
          : undefined;
      template.children.forEach((child, childIndex) =>
        scanNode(child, [...path, "rowTemplate", templateIndex, "children", childIndex], issues, fields, context, true),
      );
    });
  } else if (node.type === "image") {
    if (!node.src && !node.field) issue(issues, "warning", "IMAGE_WITHOUT_SOURCE", node, path, "图片未设置地址或数据字段");
    if ((node.width !== undefined && !isPositiveNumber(node.width)) || (node.height !== undefined && !isPositiveNumber(node.height))) {
      issue(issues, "error", "INVALID_IMAGE_DIMENSION", node, path, "图片宽高必须是正数");
    }
  }
}

export function validateFormSchemaV2(schema: FormSchemaV2): SchemaIssueV2[] {
  const issues: SchemaIssueV2[] = [];
  if (schema.version !== 2) {
    issue(issues, "error", "INVALID_VERSION", undefined, undefined, "不是有效的表单模板文件（Schema V2）");
  }
  if (!isPositiveNumber(schema.baseRowHeight)) {
    issue(issues, "error", "INVALID_BASE_ROW_HEIGHT", undefined, ["baseRowHeight"], "基础行高必须是正数");
  }
  // 全局基础字号为可选配置：存在即必须是正数（未设走引擎默认 13，不算错误）。
  if (schema.baseFontSize !== undefined && !isPositiveNumber(schema.baseFontSize)) {
    issue(issues, "error", "INVALID_BASE_FONT_SIZE", undefined, ["baseFontSize"], "基础字号必须是正数");
  }
  const seenIds = new Set<string>();
  const fields = new Map<string, string>();
  const visit = (node: EditorNodeV2, path: Array<string | number>): void => {
    if (seenIds.has(node.id)) issue(issues, "error", "DUPLICATE_ID", node, path, `存在重复的节点 ID：${node.id}`);
    seenIds.add(node.id);
  };
  schema.pages.forEach((page, pageIndex) => {
    const pagePath = ["pages", pageIndex] as Array<string | number>;
    visit(page, pagePath);
    if (!page.children.length) issue(issues, "warning", "EMPTY_PAGE", page, pagePath, "页面没有内容");
    validatePageOverflow(schema, page, pagePath, issues);
    page.children.forEach((child, childIndex) =>
      scanNode(child, [...pagePath, "children", childIndex], issues, fields, undefined),
    );
  });
  // buildEditorNodeIndexV2 verifies duplicate IDs and parent paths independently.
  try {
    buildEditorNodeIndexV2(schema);
  } catch (error) {
    issue(issues, "error", "INDEX_BUILD_FAILED", undefined, undefined, error instanceof Error ? error.message : String(error));
  }
  return issues;
}
