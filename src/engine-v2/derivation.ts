import type {
  FieldRuleV2,
  FormDataV2,
  FormNodeV2,
  FormSchemaV2,
  GridCellV2,
  GridNodeV2,
  ImageAlignV2,
  ImageItemV2,
  ImageLayoutV2,
  ImageNodeV2,
  ImageVerticalAlignV2,
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
 * 图片列表解析选项。
 */
export interface ResolveImageOptionsV2 {
  data?: FormDataV2 | null;
  isDesign?: boolean;
  /**
   * 是否把**节点级默认宽高**补进条目（默认 `true`）。传 `false` 用于区分
   * 「显式配置 / 数据提供的尺寸」与「默认兜底」——采集侧只回读前者，
   * 免得默认值被写进字段值、之后改默认宽高对已保存的数据失效。
   */
  applyDefaults?: boolean;
}

/** 图片地址是否可用（非空字符串）。 */
function hasImageSrc(item: ImageItemV2): boolean {
  return typeof item.src === "string" && item.src !== "";
}

/** 正数才写入（宽高为 0 / 负数 / NaN 一律视为未设）。 */
function positiveOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * 把数据里的一条图片值清洗成 `ImageItemV2`：
 * - 字符串（后端只回地址数组的简写）→ `{ src }`；
 * - 对象 → 取 `name` / `src` / `width` / `height`，多余键丢弃；
 * - 其它（`null` / 数字 / 嵌套数组）→ `null`（丢弃，不占索引）。
 */
function toImageItem(value: unknown): ImageItemV2 | null {
  if (typeof value === "string") return { src: value };
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const item: ImageItemV2 = {};
  if (typeof raw.name === "string") item.name = raw.name;
  if (typeof raw.src === "string") item.src = raw.src;
  const width = positiveOrUndefined(raw.width);
  const height = positiveOrUndefined(raw.height);
  if (width !== undefined) item.width = width;
  if (height !== undefined) item.height = height;
  return item;
}

/** 静态配置来源：`images` 优先；为空时回退旧版单图字段（`src` / `width` / `height`）。 */
function staticImageItems(node: ImageNodeV2): ImageItemV2[] {
  if (Array.isArray(node.images) && node.images.length > 0) {
    return node.images.map(toImageItem).filter((item): item is ImageItemV2 => item !== null);
  }
  if (typeof node.src === "string" && node.src !== "") {
    const legacy: ImageItemV2 = { src: node.src };
    const width = positiveOrUndefined(node.width);
    const height = positiveOrUndefined(node.height);
    if (width !== undefined) legacy.width = width;
    if (height !== undefined) legacy.height = height;
    return [legacy];
  }
  return [];
}

/**
 * 数据项与**模板同序号行**配对：模板行是「样式预设」，数据项是「内容」。
 * 逐字段覆盖——数据项自带 `src` / `name` / `width` / `height` 的以数据为准，
 * 缺省的那些从模板行补（所以「模板配好 30×10mm 的签名条 + 宿主回填一张签名图」
 * 才能真的渲染成长条；否则数据只给地址时尺寸会退回图片自身比例）。
 */
function mergeTemplateItem(
  dataItem: ImageItemV2,
  templateItem: ImageItemV2 | undefined,
): ImageItemV2 {
  return templateItem ? { ...templateItem, ...dataItem } : dataItem;
}

/**
 * 节点级默认图框尺寸（mm）：`defaultWidth` / `defaultHeight` 为正式字段，
 * 旧版单图字段 `width` / `height`（deprecated 兼容读取）作为兜底。
 */
function nodeDefaultImageSize(
  node: ImageNodeV2,
  dimension: "width" | "height",
): number | undefined {
  return dimension === "width"
    ? (positiveOrUndefined(node.defaultWidth) ?? positiveOrUndefined(node.width))
    : (positiveOrUndefined(node.defaultHeight) ?? positiveOrUndefined(node.height));
}

/**
 * 给条目补齐**节点级默认宽高**：行内 `width` / `height` **优先**，缺的那一维才吃节点默认值。
 *
 * 三档优先级：行内配置 → 节点默认宽高 → 图片自身比例（渲染层 `object-fit` / 自然比例兜底）。
 * 渲染层设计态的占位条目也走本函数，保证「只在面板上配了默认尺寸」的图
 * 在画布上就呈现为那个尺寸（如与输入框等高的长条签名框）。
 */
export function withImageDefaultsV2(node: ImageNodeV2, item: ImageItemV2): ImageItemV2 {
  const width = positiveOrUndefined(item.width) ?? nodeDefaultImageSize(node, "width");
  const height = positiveOrUndefined(item.height) ?? nodeDefaultImageSize(node, "height");
  const next: ImageItemV2 = { ...item };
  if (width !== undefined) next.width = width;
  else delete next.width;
  if (height !== undefined) next.height = height;
  else delete next.height;
  return next;
}

/**
 * 解析图片列表的**最终渲染条目**（渲染层 / 分页估算 / 采集三处共用的唯一真相源）。
 *
 * 取值优先级（2026-09-28 列表化，同日补「模板尺寸预设」）：
 * 1. 非设计态且配了 `field`，且数据里该字段有值 → 用数据内容，并**按 index 与模板行配对**
 *    （数据项缺 `name` / `width` / `height` 时继承模板同序号行；见 `mergeTemplateItem`）：
 *    - 值为数组 → 逐项转换（对象数组，或纯字符串数组的简写）；
 *    - 值为**单个地址字符串** → 视为「一张图」，与模板第 0 行配对（宿主回填单张签名图的最省事形态）；
 * 2. 否则用**静态模板** `images`（旧 schema 回退 `src` / `width` / `height`）；
 * 3. 每条缺的宽 / 高维度用**节点级默认宽高**（`defaultWidth` / `defaultHeight`）补齐
 *    —— 行内配置优先，见 `withImageDefaultsV2`；
 * 4. 最后按 `maxCount` 截断（未设 / ≤0 = 不限）。
 *
 * ⚠️ 渲染层与分页估算必须与本函数同口径：屏幕 / 打印不显示的条目就不能在分页里占高度，
 *    否则会出现「图片没打印出来却多出一张空白纸」。
 */
export function resolveImageItemsV2(
  node: ImageNodeV2,
  options: ResolveImageOptionsV2 = {},
): ImageItemV2[] {
  let items: ImageItemV2[] = [];
  const fromData = !options.isDesign && node.field ? options.data?.[node.field] : undefined;
  if (Array.isArray(fromData) || typeof fromData === "string") {
    const template = staticImageItems(node);
    const raw = Array.isArray(fromData) ? fromData : [fromData];
    items = raw
      .map(toImageItem)
      .filter((item): item is ImageItemV2 => item !== null)
      .map((item, index) => mergeTemplateItem(item, template[index]));
  } else {
    items = staticImageItems(node);
  }
  if (options.applyDefaults !== false) {
    items = items.map((item) => withImageDefaultsV2(node, item));
  }
  const max = node.maxCount;
  if (typeof max === "number" && Number.isFinite(max) && max > 0) {
    return items.slice(0, Math.floor(max));
  }
  return items;
}

/** 列表里是否至少有一张有地址的图片（没有 → 整块列表在打印时隐藏）。 */
export function hasImageSourceV2(items: readonly ImageItemV2[]): boolean {
  return items.some(hasImageSrc);
}

/**
 * 图片列表的**有效水平对齐**解析（渲染层与设计器面板共用，保证「面板显示的选项」
 * 就是「画布上生效的选项」）。
 *
 * 语义：整组图在容器内的**水平**对齐——
 * - 垂直布局：每个条目（一张图 + 名称）在容器内左 / 中 / 右对齐；
 * - 水平 / 填充布局：整行内容在容器内左 / 中 / 右对齐（填充布局每行被撑满，实际无效果）。
 *
 * 未显式设置 `align`（或值非法）时按布局取默认：垂直 → `center`、水平 / 填充 → `left`
 * ——各布局维持自己的历史外观，升级不改变既有 schema 的渲染结果。
 */
export function resolveImageAlignV2(
  node: Pick<ImageNodeV2, "align" | "layout">,
): ImageAlignV2 {
  const align = node.align;
  if (align === "left" || align === "center" || align === "right") return align;
  // `layout` 缺省即 `vertical`（旧 schema 不带该字段）——与渲染层的 `layout ?? "vertical"` 同口径，
  // 否则「布局是垂直、对齐却按水平默认靠左」两处不一致。
  return node.layout === "horizontal" || node.layout === "fill" ? "left" : "center";
}
export const DEFAULT_IMAGE_VERTICAL_ALIGN_V2: ImageVerticalAlignV2 = "top";

/**
 * 图片列表的**有效垂直对齐**解析（渲染层与设计器面板共用，保证「面板显示的选项」
 * 就是「画布上生效的选项」）。
 *
 * 语义：整组图在容器内的**垂直**位置——
 * - 垂直布局：条目沿主轴堆叠 → 整组内容顶 / 中 / 底对齐；
 * - 水平布局：每行沿交叉轴 → 行内顶 / 中 / 底对齐；
 * - 填充布局：每行被撑满，垂直对齐不生效（与水平对齐在该布局下同理）。
 *
 * 与 `resolveImageAlignV2` 不同，这里**没有按布局分叉的默认值**：升级前三种布局的垂直方向
 * 都是 CSS 默认的 `flex-start`（`.layout-image--horizontal` 显式写了 `align-items: flex-start`），
 * 故缺省一律取 `top`，既有 schema 的渲染结果不变。
 */
export function resolveImageVerticalAlignV2(
  node: Pick<ImageNodeV2, "verticalAlign">,
): ImageVerticalAlignV2 {
  const value = node.verticalAlign;
  if (value === "top" || value === "middle" || value === "bottom") return value;
  return DEFAULT_IMAGE_VERTICAL_ALIGN_V2;
}
export const IMAGE_NAME_LINE_HEIGHT_MM = (11 * 1.4) / (96 / 25.4);

/**
 * 单张图片条目估算高度（mm）：`height` → `width` 兜底 → 一行基准高；
 * `showName` 且该条目有名称时叠加一行名称高度（见 `IMAGE_NAME_LINE_HEIGHT_MM`）。
 *
 * 与渲染层同口径：条目盒高度 = 图片高 + 名称行（2026-09-29 修复：此前盒高被配置高锁死，
 * 图片把盒高吃满、名称溢出盒外被单元格 `overflow:hidden` 裁掉）。
 */
export function imageItemHeightMm(
  item: ImageItemV2,
  options: { showName?: boolean; baseRowHeight: number },
): number {
  const { showName, baseRowHeight } = options;
  let height = baseRowHeight;
  if (typeof item.height === "number" && Number.isFinite(item.height) && item.height > 0) {
    height = item.height;
  } else if (typeof item.width === "number" && Number.isFinite(item.width) && item.width > 0) {
    height = item.width;
  }
  const named = showName === true && typeof item.name === "string" && item.name.trim() !== "";
  return height + (named ? IMAGE_NAME_LINE_HEIGHT_MM : 0);
}

/**
 * 解析图片节点的**首张可显示地址**（单图时代的兼容入口，现按列表首张有地址的条目取值）。
 *
 * 返回 `null` 表示整块列表都没有来源：渲染层显示占位灰框、分页按 0 高度计。
 * 旧的单图判断逻辑统一收敛到 `resolveImageItemsV2`，避免两套口径。
 */
export function resolveImageSourceV2(
  node: ImageNodeV2,
  options: ResolveImageOptionsV2 = {},
): string | null {
  for (const item of resolveImageItemsV2(node, options)) {
    if (hasImageSrc(item)) return item.src as string;
  }
  return null;
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
  kind: "field" | "table-field" | "html-field";
  tableField?: string;
  row?: number;
  label?: string;
}

/**
 * 从 HTML 片段的 markup 里提取字段名（HTML 模块支持的两种绑定约定，与渲染/采集口径同源）：
 * - 原生 `data-field="字段名"`（含单引号写法）：作者控 markup，如 `<p contenteditable data-field="收工月1">`；
 * - `{{字段名}}` 占位：引擎在非设计态把它替换为 `<input data-bind>`。
 *
 * 按出现顺序返回、同名去重。字段名正则与 `HtmlBlock.withBindings` 保持一致
 * （`\p{L}\p{N}` 带 u 标志，覆盖中文等 Unicode 字母）——两处不同步会出现
 * 「页面能填、字段清单里却没有」的静默漏项（权限 / 必填 / 保存都会跟着漏）。
 */
export function collectHtmlFields(html: string | null | undefined): string[] {
  if (!html) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined): void => {
    const key = (raw ?? "").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };
  for (const match of html.matchAll(/data-field\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    push(match[1] ?? match[2]);
  }
  for (const match of html.matchAll(/\{\{\s*([\p{L}\p{N}_.$-]+)\s*\}\}/gu)) {
    push(match[1]);
  }
  return out;
}

/**
 * 收集整张 Schema 的完整字段清单（替代 `collectFieldKeys` 仅收手写 field 的局限）。
 *
 * 遍历口径与渲染期 `bindTableRowCell` / `tableTemplate` 完全一致：
 * - 普通字段 P（不在表格内）→ 直接取 `node.field`；
 * - 表格 → 对每列 × `resolveTableRowCount(node, data)` 行，按 `template.columnKey` 配对模板单元格，
 *   生成派生字段 `列key_行号`（kind=table-field）；模板内（含嵌套 Grid）的字段 P 同样绑定到该 `列key_行号`；
 * - HTML 模块 → 取片段内 `data-field` / `{{field}}` 绑定的字段（kind=html-field，见 `collectHtmlFields`）；
 *   这类字段名由作者写死，**不参与** `列key_行号` 派生（即便节点位于表格模板内）；
 * - 嵌套 Grid / 嵌套 Table 递归处理（嵌套 Table 独立派生自身列字段）；
 * - 结果按 key 同名去重（保留首次），字段清单是一份集合而非出现次数列表。
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
    if (node.type === "html") {
      for (const key of collectHtmlFields(node.html)) {
        out.push({ key, kind: "html-field" });
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
  // 同名去重（保留首次出现）：字段清单回答的是「这张表有哪些字段」，是一份集合。
  // 重复来源：同一 P 字段被复制到多处、同一表格模板单元格内有多个 P（派生名相同）、
  // HTML 片段在表格多行里各渲染一次（其字段名与行号无关，天然重复）。
  const seen = new Set<string>();
  return out.filter((info) => {
    if (seen.has(info.key)) return false;
    seen.add(info.key);
    return true;
  });
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
  // 空值口径：键缺失 / `undefined` / `""` / 纯空白串都算空；
  // 数组值（图片列表）按「是否至少有一项有地址」判定——空数组或全是空地址也算空。
  const isBlank = (value: unknown): boolean => {
    if (Array.isArray(value)) {
      return !value.some((entry) => {
        if (typeof entry === "string") return entry.trim() !== "";
        if (entry && typeof entry === "object") {
          return typeof (entry as ImageItemV2).src === "string" && (entry as ImageItemV2).src !== "";
        }
        return false;
      });
    }
    return typeof value !== "string" || value.trim() === "";
  };
  return Object.entries(rules)
    .filter(([, rule]) => rule?.required === true)
    .map(([field]) => field)
    .filter((field) => isBlank(data?.[field]));
}
