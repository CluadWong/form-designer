import { validateFormSchemaV2, type SchemaIssueV2 } from "./schema-v2-validation";
import type { FormNodeV2, FormSchemaV2 } from "./schema-v2";

export class SchemaV2SerializationError extends Error {
  readonly issues: SchemaIssueV2[];

  constructor(message: string, issues: SchemaIssueV2[] = []) {
    super(message);
    this.name = "SchemaV2SerializationError";
    this.issues = issues;
  }
}

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SchemaV2SerializationError(`${label} must be an object`);
  }
  return value as RecordValue;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) {
    throw new SchemaV2SerializationError(`${label} must be a non-empty string`);
  }
  return value;
}

/**
 * 旧 `action` 闭枚举 → 宿主词表的映射（2026-09-15 拍板）。
 *
 * 旧内核自定了 4 个值（text / date / signature / upload），而宿主
 * （`soar-web-v3-td/src/.../useFcDesigner.ts`）的 `openDialog` 只认 2 个
 * 控件类型：`datePicker`（日期/时间选择器）、`uploadImg`（图片上传）。
 * 两套词表不一致，迁移时**一次翻到位**，免去宿主再写一层兼容适配：
 * - `date`      → `datePicker`（日期/时间选择器）
 * - `upload`    → `uploadImg`（图片上传）
 * - `signature` → `uploadImg`（签名扫件复用图片上传通道；宿主无独立签名分支）
 * - `text`      → 不触发（见 `triggers` 判断，不写 `action` 也不写 `interactive`）
 *
 * **未登记的值原样保留**——不猜宿主词表，交给宿主自行处理。
 */
const LEGACY_ACTION_TO_HOST: Record<string, string> = {
  date: "datePicker",
  upload: "uploadImg",
  signature: "uploadImg",
};

/**
 * 旧 `actionParams` 键 → 宿主实际读取的属性名。
 * 宿主的日期格式读标签属性 `date-format`（`resolveDateFormat` 兼容 `data-date-format` /
 * `dateFormat`），而旧 schema 存的是 `format`，故迁移时改键。
 * 未登记的键原样保留，键名语义仍归宿主。
 */
const LEGACY_ACTION_PARAM_KEY: Record<string, string> = {
  format: "date-format",
};

/**
 * 旧版字段触发配置迁移（2026-09-15）：`action` 闭枚举 + `actionParams` → `interactive` + `params`。
 *
 * 背景：`action` 曾是内核闭枚举（text / date / signature / upload），但控件类型是**开放集**
 * （time / date-time / 宿主自定义…），不该由内核表达。改版后内核只留 1 bit（`interactive`：
 * 填写态点击该字段要不要通知宿主），类型与参数一律进通用 `params`，内核不解释其键。
 *
 * 迁移规则：
 * - `action` 值经 `LEGACY_ACTION_TO_HOST` 翻成宿主词表后写入 `params.action`；
 * - `actionParams` 的键经 `LEGACY_ACTION_PARAM_KEY` 改名（`format` → `date-format`），值原样；
 * - 旧 `action` 非 `text` → 置 `interactive: true`（旧内核在 text 下本就不触发）；
 * - 已是新格式的 `params` 优先（同名键以新格式为准，即新格式不会被旧值覆盖）；
 * - 旧键读入后丢弃，导出不再写出。
 */
function migrateLegacyFieldActivation(node: RecordValue): RecordValue {
  const { action, actionParams, ...rest } = node;
  const params: Record<string, string> = {};
  const legacyAction = typeof action === "string" ? action : undefined;
  // 旧内核在 text 下本就不触发，故 text / 未配置都不算「可触发」。
  const triggers = !!legacyAction && legacyAction !== "text";
  // 1) 旧 action → 既是「可触发」信号，也是宿主识别控件类型的键（已翻到宿主词表）。
  if (triggers && legacyAction) {
    params.action = LEGACY_ACTION_TO_HOST[legacyAction] ?? legacyAction;
  }
  // 2) 旧 actionParams 搬入并改键（含义仍由宿主约定，值不动）。
  if (actionParams && typeof actionParams === "object" && !Array.isArray(actionParams)) {
    for (const [key, value] of Object.entries(actionParams as RecordValue)) {
      if (typeof value === "string") params[LEGACY_ACTION_PARAM_KEY[key] ?? key] = value;
    }
  }
  // 3) 已是新格式的 params 优先（同名键以新格式为准）。
  const current = rest.params;
  if (current && typeof current === "object" && !Array.isArray(current)) {
    for (const [key, value] of Object.entries(current as RecordValue)) {
      if (typeof value === "string") params[key] = value;
    }
  }
  const next: RecordValue = { ...rest };
  if (triggers) next.interactive = true;
  if (Object.keys(params).length) next.params = params;
  else delete next.params;
  return next;
}

function normalizeNode(value: unknown): RecordValue {
  const node = asRecord(value, "Schema node");
  requiredString(node.id, "Schema node id");
  if (typeof node.type !== "string") {
    throw new SchemaV2SerializationError(`Schema node ${node.id} is missing type`);
  }
  if (node.type === "grid") {
    const rawGap = node.gap;
    const gap =
      typeof rawGap === "number" && Number.isFinite(rawGap) && rawGap > 0
        ? rawGap
        : undefined;
    return {
      ...node,
      border: node.border ?? "none",
      gap,
      rows: Array.isArray(node.rows)
        ? node.rows.map(row => normalizeRow(row))
        : [],
    };
  }
  if (node.type === "table") {
    const columns = Array.isArray(node.columns) ? node.columns : [];
    return {
      ...node,
      columns,
      minRows: node.minRows ?? 0,
      rowTemplate: Array.isArray(node.rowTemplate)
        ? node.rowTemplate.map(template => normalizeTemplate(template))
        : [],
    };
  }
  if (node.type === "text") return { ...node, text: node.text ?? "" };
  if (node.type === "p") {
    if (node.mode === "field") {
      // 旧 action / actionParams → interactive / params（读入即迁移，导出只剩新形态）
      return { ...migrateLegacyFieldActivation(node), field: node.field ?? "" };
    }
    // 兼容旧版：static P 归一化为 text 节点
    return { ...node, type: "text", text: node.text ?? "" };
  }
  if (node.type === "html") return { ...node, html: node.html ?? "" };
  if (node.type === "image") return { ...node, objectFit: node.objectFit ?? "contain" };
  // 未知节点类型：放行（不再整体 throw），保留原样交由校验标记为 UNKNOWN_NODE_TYPE；
  // 严格解析（parseFormSchemaV2）仍会因该校验 error 抛错，容错解析（parseTolerantFormSchemaV2）
  // 收集 issues 后返回 schema，渲染端对未知类型按 v-else-if 链跳过（G6 降级为占位/跳过）。
  return { ...node };
}

function normalizeRow(value: unknown): RecordValue {
  const row = asRecord(value, "Grid row");
  requiredString(row.id, "Grid row id");
  return {
    ...row,
    height: row.height ?? 1,
    cells: Array.isArray(row.cells) ? row.cells.map(cell => normalizeCell(cell)) : [],
  };
}

function normalizeCell(value: unknown): RecordValue {
  const cell = asRecord(value, "Grid cell");
  requiredString(cell.id, "Grid cell id");
  return {
    ...cell,
    children: Array.isArray(cell.children) ? cell.children.map(normalizeNode) : [],
  };
}

function normalizeTemplate(value: unknown): RecordValue {
  const template = asRecord(value, "Table cell template");
  requiredString(template.id, "Table cell template id");
  return {
    ...template,
    children: Array.isArray(template.children) ? template.children.map(normalizeNode) : [],
  };
}

/** Adds defaults for optional V2 fields without changing stable IDs or user content. */
export function normalizeFormSchemaV2(input: unknown): FormSchemaV2 {
  const source = asRecord(input, "Schema");
  if (source.version !== 2) {
    throw new SchemaV2SerializationError("Expected Schema V2");
  }
  if (!Array.isArray(source.pages)) {
    throw new SchemaV2SerializationError("Schema pages must be an array");
  }
  const paper = asRecord(source.paper ?? {}, "Schema paper");
  const header = paper.header as FormSchemaV2["paper"]["header"];
  const footer = paper.footer as FormSchemaV2["paper"]["footer"];
  return {
    version: 2,
    paper: {
      size: (paper.size ?? "A4") as FormSchemaV2["paper"]["size"],
      // `orientation` 为废弃键（方向自 P11-3 起由纸张尺寸派生，渲染/打印均忽略）：
      // 归一化时直接丢弃，不向前携带；旧模板中残留的 orientation 仅在解析时被忽略，不会回写导出。
      // header / footer 为可选配置：存在则原样保留（此前 paper 只落 size，会导致导出丢失）。
      ...(header ? { header } : {}),
      ...(footer ? { footer } : {}),
    },
    baseRowHeight: (source.baseRowHeight ?? 8) as number,
    // 全局基础字号（可选配置）：仅当来源是有效正数才保留 —— 刻意**不补默认值**，
    // 未设过该项的 schema 导出后不新增键（「不写 = 不变」，见 FormSchemaV2.baseFontSize 注释）。
    ...(typeof source.baseFontSize === "number" &&
    Number.isFinite(source.baseFontSize) &&
    source.baseFontSize > 0
      ? { baseFontSize: source.baseFontSize }
      : {}),
    pages: source.pages.map(value => {
      const page = asRecord(value, "Page");
      requiredString(page.id, "Page id");
      if (page.type !== undefined && page.type !== "page") {
        throw new SchemaV2SerializationError(`Invalid page type: ${String(page.type)}`);
      }
      const margin = asRecord(page.margin ?? {}, "Page margin");
      return {
        ...page,
        id: page.id as string,
        type: "page" as const,
        mode: "fixed" as const,
        margin: {
          top: (margin.top ?? 10) as number,
          right: (margin.right ?? 10) as number,
          bottom: (margin.bottom ?? 10) as number,
          left: (margin.left ?? 10) as number,
        },
        children: (Array.isArray(page.children) ? page.children.map(normalizeNode) : []) as unknown as FormNodeV2[],
      };
    }),
  };
}

export function serializeFormSchemaV2(schema: FormSchemaV2, pretty = false): string {
  const issues = validateFormSchemaV2(schema);
  const errors = issues.filter(issue => issue.level === "error");
  if (errors.length) throw new SchemaV2SerializationError("Cannot serialize invalid Schema V2", errors);
  return JSON.stringify(schema, null, pretty ? 2 : 0);
}

export function parseFormSchemaV2(input: string | unknown): FormSchemaV2 {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as unknown;
    } catch (error) {
      throw new SchemaV2SerializationError(`Invalid Schema JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const schema = normalizeFormSchemaV2(value);
  const issues = validateFormSchemaV2(schema);
  const errors = issues.filter(issue => issue.level === "error");
  if (errors.length) throw new SchemaV2SerializationError("Schema V2 validation failed", errors);
  return schema;
}

/**
 * 容错解析结果：渲染端 / 消费页使用。
 * - `schema`：能还原出 schema 则为非 null（即便含 error，也已尽力归一化）；
 * - `issues`：JSON 解析 / 结构 / 校验阶段收集的全部问题（含 error 与 warning）；
 * - `ok`：是否至少成功还原出一份 schema（JSON 非法或结构不可用则为 false）。
 */
export interface ParseResultV2 {
  schema: FormSchemaV2 | null;
  issues: SchemaIssueV2[];
  ok: boolean;
}

/**
 * 容错解析（渲染端 / 消费页使用，对照严格的 `parseFormSchemaV2`）：
 * JSON 解析失败、结构非法、或含校验 error 时**均不抛错**，而是返回 schema（能还原则非 null）
 * 与收集到的 issues。坏节点（如未知类型，被校验标记为 `UNKNOWN_NODE_TYPE`）渲染端按未知类型跳过，
 * 实现「局部降级」而非整张表单打不开——满足消费页容忍设计器导出小瑕疵 / 新版本模板的需求（G5）。
 * 设计器保存 / 发布请继续使用严格的 `parseFormSchemaV2`（error 即抛）。
 */
export function parseTolerantFormSchemaV2(input: string | unknown): ParseResultV2 {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as unknown;
    } catch (error) {
      return {
        schema: null,
        issues: [
          {
            level: "error",
            code: "INVALID_JSON",
            message: `Invalid Schema JSON: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        ok: false,
      };
    }
  }
  let schema: FormSchemaV2;
  try {
    schema = normalizeFormSchemaV2(value);
  } catch (error) {
    if (error instanceof SchemaV2SerializationError) {
      return { schema: null, issues: error.issues, ok: false };
    }
    return {
      schema: null,
      issues: [
        {
          level: "error",
          code: "NORMALIZE_FAILED",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      ok: false,
    };
  }
  const issues = validateFormSchemaV2(schema);
  return { schema, issues, ok: true };
}
