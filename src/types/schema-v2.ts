/**
 * V2 固定版式表单 Schema。
 *
 * V2 使用嵌套结构作为持久化和渲染格式：Page -> Grid -> Row -> Cell -> children。
 * 设计器运行时可以从这棵树派生节点索引，但索引不写入 Schema。
 */

export type PaperSizeV2 = "A4" | "A3";
export type OrientationV2 = "portrait" | "landscape";
export type PageModeV2 = "fixed";
export type GridTrackV2 = number | `${number}fr` | "auto";
export type BorderModeV2 = "all" | "outer" | "inner" | "none";

/** 页眉/页脚三栏文本。占位符：`{page}` 当前物理页序（1-based）、`{total}` 总物理页数。
 *  三栏均可缺省；MVP 仅支持静态文本 + 页码占位符（字段绑定 `{field:key}` 暂不支持）。 */
export interface HeaderFooterContentV2 {
  left?: string;
  center?: string;
  right?: string;
}

/**
 * 页眉 / 页脚配置。
 *
 * 驻留纸张**上/下边距区**，随每个物理页重复渲染（渲染层每个物理页各画一条带，
 * 故天然每页重复、打印同理）；属于纸张装饰，**不进入 SchemaNode 树**（不参与
 * 选中 / 拖拽 / 结构树，只能经 Inspector 编辑）。
 */
export interface HeaderFooterV2 {
  /** 开关：仅 `true` 时渲染，未设即关闭。 */
  enabled?: boolean;
  content?: HeaderFooterContentV2;
  /** 带高（mm）；未设/非法回退 `DEFAULT_BAND_HEIGHT_MM`（10）。大于纸张边距会压到正文，由 Inspector 提示。 */
  height?: number;
  /** 文本样式：生效子集为 `fontSize` / `fontWeight` / `color`（其余键忽略）。 */
  style?: TextStyleV2;
  /** 分隔线（页眉下 / 页脚上）：未设即 true。 */
  separator?: boolean;
  separatorColor?: string;
  separatorWidth?: number;
}

/** 页眉/页脚带默认高度（mm）：`height` 未设或非法时的回退值（渲染与面板共用单一真源）。 */
export const DEFAULT_BAND_HEIGHT_MM = 10;

export interface PaperConfigV2 {
  size: PaperSizeV2;
  /** 废弃键：方向自 P11-3 起由纸张尺寸派生（A4→纵向、A3→横向），渲染与打印均忽略本字段。
   *  保留为可选仅为存量模板向后兼容；新模板不再写入，序列化导出自然丢弃。 */
  orientation?: OrientationV2;
  /** 页眉（全局，作用于所有物理页）。 */
  header?: HeaderFooterV2;
  /** 页脚（全局，作用于所有物理页）。 */
  footer?: HeaderFooterV2;
}

export interface EdgeInsetsV2 {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BoxStyleV2 {
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
}

export interface TextStyleV2 {
  align?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  fontSize?: number;
  lineHeight?: number;
  fontWeight?: "normal" | "bold";
  writingMode?: "horizontal-tb" | "vertical-rl";
  whiteSpace?: "normal" | "nowrap" | "pre-wrap";
  /** 文字颜色（CSS color）。仅用于渲染，不影响字段语义。 */
  color?: string;
  /** 字体族（CSS font-family）。 */
  fontFamily?: string;
}

/**
 * 通用「额外属性」（params）：键值对，设计器配置、渲染时**原样落到该节点根元素的 HTML 属性**上。
 *
 * 内核**不解释任何键**——「这些属性怎么消费」是宿主的职责（2026-09-15 用户拍板）：
 * 宿主可在填写态扫描 `[data-field]` 或自定义属性（如 `action` / `date-validate`）自行接管
 * 交互与跨字段校验。这是「内核只做表单设计、不碰业务」的落点：内核只负责把设计态写下的
 * 属性透传到 DOM，不引入任何业务词表。
 *
 * 安全：渲染前统一经黑名单过滤（`on*` 事件、`data-*` 内核寻址、`class`/`style`/`id` 等保留属性、
 * 以及非「小写字母开头 + 小写字母/数字/短横线」的属性名一律丢弃），实现见
 * `src/utils/node-params.ts`（含单测）。空串值与空对象不写属性。
 */
export type NodeParamsV2 = Record<string, string>;

export interface SchemaNodeBaseV2 {
  id: string;
  /** 通用额外属性：渲染时作为 HTML 属性插入本节点根标签；内核不解释键（见 `NodeParamsV2`）。 */
  params?: NodeParamsV2;
}

/**
 * 固定文字节点（text 类型，标题 / 标签 / 说明等）。
 * 与可输入字段的 `p` 节点彻底分离：text 不进入字段数据、不参与填写回写，
 * 仅用于静态展示，可在设计器配置多行文本与文本样式。
 */
export interface TextNodeV2 extends SchemaNodeBaseV2 {
  type: "text";
  text: string;
  style?: TextStyleV2;
}

export interface FieldPNodeV2 extends SchemaNodeBaseV2 {
  type: "p";
  mode: "field";
  field: string;
  /** Optional inline label rendered before the input area. */
  prefix?: string;
  /** Optional inline label rendered after the input area. */
  suffix?: string;
  /**
   * 可点击触发（原 `action` 闭枚举收敛出的 1 bit，2026-09-15 用户拍板）：为 `true` 时渲染内核在
   * **填写态**由**点击字段元素本身** emit `field-activate`，把触发权交还宿主。
   *
   * 内核只持有这 1 bit（「要不要绑点击、发不发事件」），**不持有控件类型词表**——「是日期选择器
   * 还是时间选择器」等开放集由 `params` 表达（如 `params.action = "datePicker"`），
   * 内核原样透传、不认识其值。故新增宿主控件类型零内核改动。
   *
   * 缺省 / `false`：不触发（传统纸类表单的普通输入框，仅就地输入）。
   */
  interactive?: boolean;
  underline?: boolean;
  webUnderline?: boolean;
  printUnderline?: boolean;
  /** 字段宽度（CSS 长度字符串，支持 mm / px / % 等，如 "30mm"、"120px"、"50%"）。
   *  缺省时不限制宽度（沿用父容器 100%）。 */
  width?: string;
  /** 字段默认内容：无填写数据时的预设文本，支持多行（`\n`）。 */
  default?: string;
  /** 内部边框：为 p 标签内每一行（回车生成的 div）显示底边框。
   *  默认不显示；勾选后设计态 / 预览 / 打印均保持显示。 */
  innerBorder?: boolean;
  style?: TextStyleV2;
}

export type PNodeV2 = FieldPNodeV2;

/**
 * 字段级运行时权限（P9.2a / P9.2b）：**与 `data` 同轨，由消费方经 props 注入渲染组件**
 * （`fieldPermissions: { 字段名: 权限 }`），**不进 schema**——权限是消费会话关注点，
 * 设计模板不携带（设计态不注入 → 全部 EDIT，设计交互不受影响）。
 * - `EDIT`：可输入（**缺省值**，未注明的字段一律可编辑，向后兼容）；
 * - `READ`：只读回显（渲染值但不可就地输入）；
 * - `HIDDEN`：**脱敏显示**（2026-09-08 用户拍板）：字段外壳与前/后标签照常渲染、
 *   占位与分页高度不变，**非空输入内容以 `***` 替代**（空值不打码）；真实值不进 DOM，
 *   `collectFieldValues` 跳过该字段（防止假值污染），消费页 `getFormData` 仍返回真实值。
 */
export type FieldPermissionV2 = "READ" | "EDIT" | "HIDDEN";

/**
 * 字段级校验规则（P9.2c）：**与 `data` / `fieldPermissions` 同轨，由消费方经 props
 * （`FormRenderer` 的 `options.rules`）注入**，不进 schema——「哪些字段必填」是消费
 * 会话的采集策略，模板不携带。键 = 字段名，值 = 规则对象（当前仅 `required`，
 * 后续可扩展 min/max/pattern 等）。
 */
export interface FieldRuleV2 {
  /** 必填：值为空（键缺失 / 空串 / 纯空白）时校验不通过。 */
  required?: boolean;
}

/**
 * 字段触发事件契约：字段配置 `interactive: true` 时，渲染内核在**填写态**（canFill）由
 * **点击字段元素本身**触发（表单不加任何额外按钮），经 `field-activate` 事件把触发权交还
 * 宿主——**宿主负责召唤外部输入组件（弹窗/选择器）并在回调里回写 data**（与 data 同轨，
 * 回写后票面自动重渲染）。
 *
 * 分层：内核不做任何弹窗实现，**也不解释 `params` 的键**（内核不认识宿主 UI 与业务约定）；
 * 宿主从 `params` 自取所需（如 `params.action` 决定弹哪个选择器、`params.format` 决定显示格式）。
 */
export interface FieldActivateV2 {
  /** 触发源字段节点 id。 */
  nodeId: string;
  /** 字段名（宿主回写 data 的键）。 */
  field: string;
  /** 该字段的额外属性（原样透传，含义由宿主约定）。 */
  params?: NodeParamsV2;
}

export interface GridNodeV2 extends SchemaNodeBaseV2 {
  type: "grid";
  border: BorderModeV2;
  rows: GridRowV2[];
  style?: BoxStyleV2;
  /** 列宽规范（按逻辑列顺序）。渲染时所有行共用同一组列轨，使跨列合并（colspan）
   *  在任意列宽下都能正确对齐。缺省时渲染器回退到逐格 cell.width（旧数据兼容）。 */
  columns?: GridTrackV2[];
  /** 单元格默认内边距（mm）。子 cell 未单独设置 padding 时继承此值，缺省为 0。 */
  cellPadding?: number;
  /** 单元格默认水平对齐。子 cell 未单独设置 align 时继承此值。 */
  cellAlign?: "left" | "center" | "right";
  /** 单元格默认垂直对齐。子 cell 未单独设置 verticalAlign 时继承此值。 */
  cellVerticalAlign?: "top" | "middle" | "bottom";
  /**
   * 单元格间距（mm，非负）：同时作用于**行与行之间**与**列与列之间**，
   * 等价于 CSS `gap`。缺省为 0（单元格紧贴，分隔线相接）。
   * 注意：间距会让内部边框线之间出现等距空隙（每格只画自己的单边，间隙留白）。
   */
  gap?: number;
}

export interface GridRowV2 extends SchemaNodeBaseV2 {
  type: "grid-row";
  /** 相对于 FormSchemaV2.baseRowHeight 的固定倍数。 */
  height: number;
  cells: GridCellV2[];
}

export interface GridCellV2 extends SchemaNodeBaseV2 {
  type: "grid-cell";
  width?: GridTrackV2;
  colspan?: number;
  /** 单元格行高倍数（覆盖所在 Grid 行的 height）；不设置时继承 Grid 行高。 */
  rowHeight?: number;
  padding?: number;
  align?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  /**
   * 弹性布局（单元格级）：为 true 时该单元格自身作为水平流式 flex 容器，
   * 其直接子节点沿水平方向排布、到达边界自动换行、水平左对齐、垂直居中、间隔 0
   * （等价于 CSS `display:flex; flex-direction:row; flex-wrap:wrap;
   *  justify-content:flex-start; align-items:center`）。
   * 适用于「一格内横排多个字段/文本」的弹性分组场景；缺省为 false（普通格子，
   * 子节点按默认对齐居中放置）。flex 是单元格属性，不是独立组件。
   */
  flex?: boolean;
  children: FormNodeV2[];
}

export interface TableColumnV2 {
  key: string;
  title: string;
  width?: GridTrackV2;
  align?: "left" | "center" | "right";
}

export interface TableCellTemplateV2 extends SchemaNodeBaseV2 {
  type: "table-cell-template";
  columnKey: string;
  children: FormNodeV2[];
}

export interface TableNodeV2 extends SchemaNodeBaseV2 {
  type: "table";
  field?: string;
  columns: TableColumnV2[];
  minRows: number;
  rowTemplate: TableCellTemplateV2[];
  /** 表头样式（标题行）：字号(px) / 粗细 / 对齐。可选；未设时回退到列 align 与默认外观。 */
  headerStyle?: TextStyleV2;
  /** 边框模式（与 Grid 一致）：all=外框+内部线（默认）、inner=仅内部线、outer=仅外框、none=无。 */
  border?: BorderModeV2;
  /**
   * 分页引擎内部字段（2026-09-03 廿一续）：跨页切分时，本片段最多渲染的数据行数。
   * 仅由 `paginateTable` 写入，渲染层 `GridSchemaNode.vue` 用它限制 `v-for` 行范围。
   * 未设置或 ≤0 时渲染全部行（= 不限制，与未分页时一致）。
   * 序列化/校验层忽略此字段（不在用户 JSON 中出现）。
   */
  _paginateMaxRows?: number;
}

export interface HtmlNodeV2 extends SchemaNodeBaseV2 {
  type: "html";
  /** HTML 片段，配置期即要求不含 <script>/on* 等脚本；渲染前仍由引擎统一清洗（见 engine.md §11） */
  html: string;
  /** 仅在 Shadow DOM 内生效，不污染表单样式 */
  css?: string;
}

export interface ImageNodeV2 extends SchemaNodeBaseV2 {
  type: "image";
  src?: string;
  field?: string;
  width?: number;
  height?: number;
  objectFit?: "contain" | "cover" | "fill";
}

export type FormNodeV2 =
  | GridNodeV2
  | PNodeV2
  | TextNodeV2
  | TableNodeV2
  | HtmlNodeV2
  | ImageNodeV2;

/** 表单数据：字段名 -> 值。渲染时用于原地填充字段节点（见 engine.md §11）。 */
export type FormDataV2 = Record<string, string | number | boolean | null>;

/** Persisted component nodes. Rows/cells/templates are owned layout records. */
export type SchemaNodeV2 = PageSchemaV2 | FormNodeV2;

export type LayoutNodeV2 = GridRowV2 | GridCellV2 | TableCellTemplateV2;
export type EditorNodeV2 = SchemaNodeV2 | LayoutNodeV2;

/** Returns true for nodes that can be selected and edited as components. */
export function isSelectableSchemaNodeV2(
  node: EditorNodeV2 | undefined,
): node is SchemaNodeV2 {
  return Boolean(node && node.type !== "grid-row" && node.type !== "grid-cell" && node.type !== "table-cell-template");
}

export interface PageSchemaV2 extends SchemaNodeBaseV2 {
  type: "page";
  mode: PageModeV2;
  margin: EdgeInsetsV2;
  children: FormNodeV2[];
}

export interface FormSchemaV2 {
  version: 2;
  paper: PaperConfigV2;
  baseRowHeight: number;
  pages: PageSchemaV2[];
}

/** 纸张边长（mm）：short=短边，long=长边。渲染纸张、打印 `@page size`、溢出校验共用同一份，
 *  避免各处硬编码「A4 = 210×297」（历史上 `@page` 写死 A4，导致选 A3 时打印被裁）。 */
export const PAPER_SIDE_MM: Record<PaperSizeV2, { short: number; long: number }> = {
  A4: { short: 210, long: 297 },
  A3: { short: 297, long: 420 },
};

export interface ResolvedPaperSizeV2 {
  size: PaperSizeV2;
  /** 方向由纸张尺寸派生（无独立方向选择）：A4 → 纵向，A3 → 横向。 */
  orientation: OrientationV2;
  widthMm: number;
  heightMm: number;
}

/**
 * 解析纸张物理尺寸（mm）。渲染纸张宽度/最小高度、打印 `@page size`、页面溢出校验
 * 三处统一调用本函数，保证「屏幕上看到多大纸、打印出来就是多大纸」。
 */
export function resolvePaperSizeV2(paper: PaperConfigV2): ResolvedPaperSizeV2 {
  const size: PaperSizeV2 = paper?.size === "A3" ? "A3" : "A4";
  const sides = PAPER_SIDE_MM[size];
  const orientation: OrientationV2 = size === "A3" ? "landscape" : "portrait";
  return orientation === "portrait"
    ? { size, orientation, widthMm: sides.short, heightMm: sides.long }
    : { size, orientation, widthMm: sides.long, heightMm: sides.short };
}
