<script setup lang="ts">
import { computed, ref, watch, onMounted } from "vue";
import type { CSSProperties } from "vue";
import type {
  FormNodeV2,
  FieldPermissionV2,
  GridCellV2,
  GridNodeV2,
  ImageAlignV2,
  ImageItemV2,
  ImageLayoutV2,
  ImageNodeV2,
  ImageVerticalAlignV2,
  PNodeV2,
  SchemaNodeBaseV2,
  TextNodeV2,
  TextStyleV2,
  TableColumnV2,
  TableNodeV2,
  FormDataV2,
} from "@/types";
import HtmlBlock from "./HtmlBlock.vue";
import { resolveGridGapV2 } from "@/types";
import { resolveNodeParamAttrs } from "@/utils/node-params";
import {
  bindTableRowCell,
  hasImageSourceV2,
  resolveCellBoxV2,
  resolveImageAlignV2,
  resolveImageItemsV2,
  resolveImageVerticalAlignV2,
  resolveSignImageGapV2,
  resolveSignImageHeightV2,
  resolveSignImageUrlsV2,
  resolveTableRowCount,
  withImageDefaultsV2,
} from "@/engine-v2/derivation";

defineOptions({ name: "GridSchemaNodeV2" });

/**
 * 表格节点**不带** `data-field`（2026-09-11）：表不是字段本身，可采集字段是
 * 模板派生的 `列key_行号`（见 `bindTableRowCell`）。此前把 `node.field` 绑在
 * `<table>` 上，`collectFieldValues` 按 `[data-field]` 取 `innerText`，会把整张表
 * （表头各列标题拼 `\n`）当成一个字段值采回——`getFormData` 里出现
 * `工作任务: "工作地点或地段\n工作内容"` 这种脏数据。字段清单侧
 * （`collectSchemaFields`）从不消费表级 `field`，摘掉无副作用。
 */

const emit = defineEmits<{
  (e: "field-change", field: string, value: string): void;
}>();

const props = defineProps<{
  node: FormNodeV2;
  baseRowHeight: number;
  /**
   * 渲染模式（A1 / A5）：显式声明调用方意图，取代旧版靠 `data != null` 推断三态。
   * - design：设计态，字段 contenteditable 就地占位（不回写 schema），结构可拖拽/选中。
   * - preview：带数据回显，**字段可输入**（消费模板、输入数据以配合流程流转）。
   * 未传时向后兼容：有 `data` → preview，否则 design。
   * ⚠️ `mode` 不决定可编辑性；真正的「不可输入」由 `readonly` 闸门决定（见下）。
   */
  mode?: "design" | "preview";
  data?: FormDataV2 | null;
  /**
   * 只读闸门：为 `true` 时字段一律不可输入（真·只读回显/打印浏览）。
   * 与 `mode` **正交**——`mode="preview"` + `readonly` 才是消费页的只读回显；
   * `mode="preview"` + 不传 `readonly` 仍可输入（设计器预览态即显式传 `:readonly="false"`）。
   */
  readonly?: boolean;
  /**
   * 相邻 Grid 外框去重（Item 2）：当本 Grid 与相邻兄弟 Grid 都配置了外框时，
   * 由父级（页面竖向堆叠 / 单元格横向排布）传入需要隐藏的边框侧，避免重叠成 2px。
   * 仅隐藏「后一个」Grid 的引导侧（页面级 top / 单元格级 left），保留前者的拖尾侧单线。
   */
  suppressBorders?: {
    top?: boolean;
    right?: boolean;
    bottom?: boolean;
    left?: boolean;
  };
  /**
   * 字段级运行时权限（P9.2a/P9.2b，与 `data` 同轨经 props 注入，不进 schema）：
   * 按字段名映射 READ（只读回显）/ EDIT（可输入，缺省）/ HIDDEN（隐藏但保留占位）。
   * 设计态不注入（undefined）→ 恒为 EDIT，设计交互不受影响。
   */
  fieldPermissions?: Record<string, FieldPermissionV2>;
}>();

/** 该节点是否为绘制外框（all/outer）的 Grid。 */
function drawsOuterFrame(node: FormNodeV2): boolean {
  return (
    node.type === "grid" && (node.border === "all" || node.border === "outer")
  );
}

/**
 * 单元格内子节点横向（flex row）排布：相邻且都绘制外框的 Grid，
 * 抑制后一个 Grid 的左边框（保留前一个的右边框单线）。非 Grid / 非外框节点返回 undefined。
 */
function cellSiblingSuppressBorders(
  children: FormNodeV2[],
  index: number,
):
  | { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean }
  | undefined {
  const node = children[index];
  if (!drawsOuterFrame(node)) return undefined;
  const prev = children[index - 1];
  return { left: !!prev && drawsOuterFrame(prev) };
}

/**
 * 显式渲染模式（A1 / A5）：调用方优先用 `mode` 直接声明意图；未传时向后兼容旧调用，
 * 由 `data` 推断（有 data → preview；否则 design）。`readonly` 是独立的只读闸门，不在此推断。
 * 渲染内核只认这个显式模式，不再把「有没有 data」解释成「是不是填充态」。
 */
type RenderMode = "design" | "preview";
const resolvedMode = computed<RenderMode>(() => {
  if (props.mode) return props.mode;
  if (props.data != null) return "preview";
  return "design";
});
/** 设计态：字段 contenteditable 就地占位、节点可拖拽。 */
const isDesign = computed(() => resolvedMode.value === "design");
/**
 * 字段是否可输入：预览/消费态即「交互填充态」——复用同一 `<div>` 渲染路径，字段可编辑、
 * 值来自 data，用户输入经 DOM 遍历采集（不逐键回写响应式 data，见十续）。
 * 故所有非 design 模式（现仅 preview 一种）均视为可输入；仅 design 态字段是占位、不承载真实数据。
 * 但同时受 `readonly` 硬闸门约束：外部传入 readonly（如真·只读展示）时强制不可编辑。
 * 等价于旧逻辑 `data != null && !readonly`。
 */
const canFill = computed(
  () => resolvedMode.value !== "design" && !props.readonly,
);

const track = (value: number | `${number}fr` | "auto" | undefined): string => {
  if (value === undefined || value === "auto") return "auto";
  return typeof value === "number" ? `${value}mm` : value;
};

/**
 * Grid 容器（flex column）间距：仅行与行之间（列间距由 `.layout-grid__row` 的
 * `column-gap` 负责）。gap 同时作用于行列（CSS `gap` 语义）。
 */
function gridContainerStyle(node: GridNodeV2): CSSProperties {
  const gap = resolveGridGapV2(node);
  return gap > 0 ? { rowGap: `${gap}mm` } : {};
}

function gridRowStyle(node: GridNodeV2, rowIndex: number): CSSProperties {
  const row = node.rows[rowIndex];
  // 优先使用 Grid 的共享列轨（grid.columns），使跨列合并（colspan）在任意
  // 列宽下都能正确对齐；旧数据无 columns 时回退到逐格 cell.width。
  const tracks =
    node.columns && node.columns.length > 0
      ? node.columns
      : row.cells.map((cell) => cell.width);
  const gap = resolveGridGapV2(node);
  return {
    gridTemplateColumns: tracks.map(track).join(" "),
    minHeight: `${row.height * props.baseRowHeight}mm`,
    // 列间距：gap 同时作用于行列。
    columnGap: gap > 0 ? `${gap}mm` : undefined,
  };
}

function cellStyle(cell: GridCellV2, grid: GridNodeV2): CSSProperties {
  const box = resolveCellBoxV2(cell, grid);
  // 水平对齐（main 轴，row 方向）→ justify-content；垂直对齐（cross 轴）→ align-items。
  const alignItems =
    box.verticalAlign === "top"
      ? "flex-start"
      : box.verticalAlign === "bottom"
        ? "flex-end"
        : "center";
  const justifyContent =
    box.align === "center"
      ? "center"
      : box.align === "right"
        ? "flex-end"
        : "flex-start";
  const base: CSSProperties = {
    gridColumn: cell.colspan ? `span ${cell.colspan}` : undefined,
    // 单元格行高倍数：设置时覆盖所在 Grid 行高（行容器按最高单元格撑开）。
    minHeight: cell.rowHeight
      ? `${cell.rowHeight * props.baseRowHeight}mm`
      : undefined,
    padding: `${box.padding}mm`,
    alignItems,
    justifyContent,
  };
  // 弹性单元格（cell.flex）：基础 `.layout-grid__cell` 已是 `display:flex`（默认 row），
  // 故只需额外开启 `flex-wrap:wrap` 即得到「水平流式 + 自动换行」；水平/垂直对齐
  // 与普通单元格完全一致，复用 cell 自身的 align / verticalAlign 配置。
  if (cell.flex) {
    return { ...base, flexWrap: "wrap" };
  }
  return base;
}

function textCss(style?: TextStyleV2): CSSProperties {
  return {
    justifyContent:
      style?.align === "center"
        ? "center"
        : style?.align === "right"
          ? "flex-end"
          : "flex-start",
    alignItems:
      style?.verticalAlign === "top"
        ? "flex-start"
        : style?.verticalAlign === "bottom"
          ? "flex-end"
          : "center",
    textAlign: style?.align,
    fontSize: style?.fontSize ? `${style.fontSize}px` : undefined,
    lineHeight: style?.lineHeight,
    fontWeight: style?.fontWeight,
    writingMode: style?.writingMode,
    whiteSpace: style?.whiteSpace,
    color: style?.color,
    fontFamily: style?.fontFamily,
  };
}

function pStyle(node: PNodeV2): CSSProperties {
  // 字段 P 默认允许换行（内容超过宽度时自动换行），不再依赖 multiline 配置。
  // 宽度作用于「可输入区域」：无前/后标签时整个 <div> 即输入区，故 width 作用于组件整体；
  // 有前/后标签（复合字段）时，宽度只作用于输入区（见 fieldInputStyle，挂在内层 span/控件），
  // 此时 <div> 不加 width，避免把前缀/后缀也算进宽度。
  return {
    ...textCss(node.style),
    whiteSpace: "pre-wrap",
    width: isCompositeField(node) ? undefined : node.width,
  };
}

/** 复合字段（有前/后标签）可输入区域的宽度样式：仅复合字段且配置了 width 时生效，
 *  挂在内层 `.layout-p__input`（A3 统一渲染路径后，设计/预览/填写态都是这个元素，
 *  旧的填充态 `.layout-p__control` textarea 分支已于十续回退）。
 *  flexGrow:0 确保显式宽度不被 flex 拉伸（`.layout-p__input` 默认 flex 可增长）。 */
function fieldInputStyle(node: PNodeV2): CSSProperties {
  if (!isCompositeField(node) || !node.width) return {};
  return { width: node.width, flexGrow: 0 };
}

function textStyle(node: TextNodeV2): CSSProperties {
  return textCss(node.style);
}

function tableColumnStyle(columns: TableColumnV2[]): CSSProperties {
  return {
    gridTemplateColumns: columns.map((column) => track(column.width)).join(" "),
  };
}

function tableCellStyle(column: TableColumnV2): CSSProperties {
  return {
    justifyContent:
      column.align === "center"
        ? "center"
        : column.align === "right"
          ? "flex-end"
          : "flex-start",
  };
}

/**
 * 表头单元格样式：合并「表头级样式 headerStyle」与「列级 align」。
 * headerStyle.align 优先于 column.align（表头作为整体可统一对齐）；
 * 字号/粗细仅由 headerStyle 提供（未设则交回 CSS 默认，避免改动既有外观）。
 * headerStyle 为 undefined 时完全回退到 `tableCellStyle(column)` 的既有行为。
 */
function tableHeaderCellStyle(
  column: TableColumnV2,
  headerStyle?: TextStyleV2,
): CSSProperties {
  const align = headerStyle?.align ?? column.align;
  return {
    justifyContent:
      align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start",
    fontSize: headerStyle?.fontSize ? `${headerStyle.fontSize}px` : undefined,
    fontWeight: headerStyle?.fontWeight ?? undefined,
  };
}

function tableTemplate(node: TableNodeV2, columnKey: string) {
  return node.rowTemplate.find((template) => template.columnKey === columnKey);
}

/**
 * 分页片段 Table 的数据行数上限（2026-09-03 廿一续）。
 * 当分页引擎把一个 Table 按数据行切分到多页时，每个片段的 Table 节点会携带
 * `_paginateMaxRows` 字段，限制该片段只渲染前 N 行数据（避免每页都渲染全部 50 行）。
 * 未设置时返回完整行数（= 不限制，与未分页时一致）。
 */
function tablePaginatedRowCount(
  node: TableNodeV2,
  data: FormDataV2 | null | undefined,
): number {
  const full = resolveTableRowCount(node, data);
  if (typeof node._paginateMaxRows === "number" && node._paginateMaxRows > 0) {
    return Math.min(full, node._paginateMaxRows);
  }
  return full;
}

/**
 * 实例化表格行模板：把单元格内字段 P 的 `field` 绑定到 `列key_行号`（渲染期派生，
 * 见 schema-v2-table-rows.ts 的 `bindTableRowCell`）。
 *
 * 每一行复用同一份 rowTemplate，但字段名按列配置 + 行号自动生成
 * （如第 r 行列 `工作地点` 绑定 `工作地点_r`），逐行不冲突，满足
 * P10「数据回写正确 —— 键与逐行数据一致无错位」。行模板内手写 field 会被覆盖，
 * 故无需（也不应在）schema 中写死字段名。
 */
function bindRowCell(
  node: FormNodeV2,
  columnKey: string,
  rowIndex: number,
): FormNodeV2 {
  return bindTableRowCell(node, columnKey, rowIndex);
}

function isCompositeField(node: PNodeV2): boolean {
  return node.mode === "field" && Boolean(node.prefix || node.suffix);
}

/**
 * 图片值字段（`valueType === "image"`，2026-09-29）：`data[field]` 是**一个或多个**图片地址
 * （URL / data URL），每个渲染为坐落在下划线上的 `<img>`——电子签名场景，宿主经
 * `params.action`（落到字段标签属性）识别签名栏并弹签名框、回填图片地址。
 *
 * 该形态**不参与就地输入**（值只能由宿主回填），故 `contenteditable` 一律关闭；
 * 空值不渲染图片，下划线照常显示（「负责人签名：____」空态占位）。
 */
function isImageValue(node: PNodeV2): boolean {
  return node.mode === "field" && node.valueType === "image";
}

/**
 * 签名字段的图片地址列表（**单值与多值同一条路径**，多人签名 2026-09-30）。
 *
 * 取值口径与 `fieldValue` 完全一致（`.default` 兜底规则也照搬，否则带默认值的签名栏
 * 会与文本态行为分叉），只把「标量」换成「数组」：字符串 → 长度 1 的数组。
 * 故单值场景渲染结果与单图时代逐字节相同；数组即多张，超宽换行。
 * 归一化规则（空项剔除、`maxCount` 截断）见 `resolveSignImageUrlsV2`。
 */
function signImageUrls(node: PNodeV2): string[] {
  const data = props.data;
  let raw: unknown = node.default ?? "";
  if (data != null && node.field in data) {
    raw = data[node.field];
    if (raw == null) raw = node.default ?? "";
  }
  return resolveSignImageUrlsV2(raw, node.maxCount);
}

/**
 * 签名图**张数**（已过 `valueType === "image"` 与脱敏两道闸门）：模板据此三选一——
 * `0` 空态（下划线照常显示）或已脱敏、`1` 走单 `<img>` 路径、`> 1` 用 `.layout-p__signs`
 * 容器承载并排多图。
 *
 * 脱敏（HIDDEN）态返回 0 → 落回原文本分支显示 `***`：真实图片地址不进 DOM（P9.2b 口径），
 * 且**多图时整栏统一 `***`**，不逐张遮罩（否则张数本身就是信息泄露）。
 */
function signImageCount(node: PNodeV2): number {
  if (!isImageValue(node) || fieldMasked.value) return 0;
  return signImageUrls(node).length;
}

/** 签名图**有效高度**：`imageHeight` 缺省即与标签（文字行盒）等高——解析逻辑与分页估算
 *  同源（`resolveSignImageHeightV2`），见 `DEFAULT_SIGN_IMAGE_HEIGHT_V2` 的说明。
 *
 *  2026-09-29 修正：此前留空 = **不设高度**，图片按固有尺寸铺开 —— 无头实测一张 400×120 的
 *  签名图被渲染成 105.83×31.75mm，把原本 5.77mm 的字段行撑到 38.51mm（6.7 倍）。 */
function signImageStyle(node: PNodeV2): CSSProperties {
  return {
    height: resolveSignImageHeightV2(node),
    maxWidth: "100%",
  };
}

/** 图片值容器的底高预留：空态（未签名）也占住 `imageHeight`，令下划线位置在
 *  「未签名 / 已签名」两态一致；有图时以图片高度为准（`min-height` 仅作下限）。
 *
 *  留空 `imageHeight` 时无需任何额外样式：`.layout-p__input` 自带的 `min-height: 1.6em`
 *  与默认图片高度同值，两态天然等高（实测 5.77mm 对 5.77mm）。 */
function signBoxStyle(node: PNodeV2): CSSProperties {
  return isImageValue(node) && node.imageHeight ? { minHeight: node.imageHeight } : {};
}

/**
 * 多人签名容器（`.layout-p__signs`）的**节点级**样式：间距 `gap` 抽自 `resolveSignImageGapV2`
 * （缺省 `0.5em`）。换行与贴底（`flex-wrap` / `align-content: flex-end`）是静态规则，
 * 由 CSS 承担；此处只下发可配置项，故单图 / 空态都不需要它——**该容器只在 N > 1 时渲染**，
 * 单张仍走原来的单 `<img>` 路径，DOM 与升级前逐字节一致。
 */
function signWrapStyle(node: PNodeV2): CSSProperties {
  return isImageValue(node) ? { gap: resolveSignImageGapV2(node) } : {};
}

/**
 * 当前字段节点的运行时权限（P9.2a）：缺省 EDIT（向后兼容——未注明的字段可输入）。
 * 仅对字段 P 生效；权限由消费方经 `fieldPermissions` 注入，设计态不传 → 恒为 EDIT。
 * HIDDEN / READ 是比 `readonly` 会话闸门更细的一层：READ/HIDDEN 一律不可就地输入。
 */
const fieldPermission = computed<FieldPermissionV2>(() => {
  if (props.node.type !== "p" || props.node.mode !== "field") return "EDIT";
  return props.fieldPermissions?.[props.node.field] ?? "EDIT";
});

/**
 * 节点额外属性（`params`）→ 可安全渲染的属性表。
 *
 * 内核**只负责透传**：把设计态写下的键值插入本节点根标签，**不解释任何键**
 * （「action 是什么控件」「date-validate 怎么校验」都是宿主的约定）。
 * 过滤规则见 `src/utils/node-params.ts`——`on*` 事件、`data-*` 内核寻址、
 * `class`/`style`/`field`/`src` 等保留属性、以及非小写属性名一律丢弃。
 */
function nodeParamAttrs(node: SchemaNodeBaseV2): Record<string, string> {
  return resolveNodeParamAttrs(node.params);
}

/**
 * HIDDEN 脱敏口径（P9.2b）：字段外壳（前/后标签、占位）保留，**输入内容以 `***` 替代显示**
 * （不再用 visibility 整字段隐藏）。**空值也打码**：HIDDEN 字段无论是否有值一律显示 `***`——
 * 脱敏占位统一，不暴露「此处是否有隐藏数据」（推翻此前「空值不打码」口径）。
 * ⚠️ 真实值不进 DOM → `collectFieldValues` 必须跳过脱敏字段（见 collectFieldValues.ts），
 * 否则 DOM 遍历采集会把假值 `***` 写回数据造成污染；消费页 `getFormData`（响应式数据侧）
 * 不受影响，仍返回真实值。
 */
const fieldMasked = computed(() => fieldPermission.value === "HIDDEN");
const MASK_TEXT = "***";
/** 展示值：HIDDEN 字段一律以 `***` 替代真实值（含空值，脱敏占位统一）。 */
function displayValue(node: PNodeV2): string {
  if (!fieldMasked.value) return fieldValue(node);
  return MASK_TEXT;
}
/** 展示行：HIDDEN 字段一律单行 `***`（含全空；多行不展开，避免行数泄露内容长度）。 */
function displayLines(node: PNodeV2): string[] {
  if (!fieldMasked.value) return fieldLines(node);
  return [MASK_TEXT];
}

/**
 * 设计态可编辑（contenteditable 临时文本，不回写，A2 已拍板保留）；填充态由同一 DOM 承载输入。
 *
 * 字段「能否输入」的口径只有一条：**`readonly` 是真的硬闸门，`preview` 与 `fill` 同口径
 * （都可输入）**——预览态就是「消费模板、输入数据以配合流程流转」的地方（用户语义），
 * 设计器预览态即显式传 `:readonly="false"`。故非复合字段为 `canFill || isDesign`，
 * 复合字段的 `.layout-p__input` 写 `canFill ? 'true' : (readonly ? undefined : 'true')`
 * （= 非 readonly 即可输入，design 亦在其中），二者等价。
 *
 * ⚠️ 勿把复合字段改成 `canFill || isDesign` 之外的口径，也勿让 `mode="preview"` 单独
 * 关掉输入：那会让设计器预览态的复合字段（如「共 ___ 人」）不可输入、与非复合字段割裂。
 * 内核 props 注释曾写「preview = 字段不可输入」（与实现相反），已按实现订正。
 */
function isEditable(node: PNodeV2): "true" | undefined {
  return isDesign.value && node.mode === "field" && !isCompositeField(node)
    ? "true"
    : undefined;
}

// 拖拽「源」逻辑（dragstart 的 setData / 规则判断）与 `draggable` 属性均已下沉至设计表面层 design/CanvasSurface.vue（A6 二十七续 + 三十一续）。
// 内核不再绑定 @dragstart、不再持有 `:draggable`、也不再 emit `node-drag-start`；
// 表面层在 design 态对 `[data-node-id]:not(.layout-grid__cell)` 元素设置 `draggable="true"`（浏览器要求 draggable 必须是被拖元素自身属性）。

/**
 * 失焦（blur）回写：用户离开字段时 emit 一次 `field-change(field, value)`，
 * 由使用方（FormRenderer / FormDesigner）决定写回响应式 data，满足 P9.1b「数据回写正确」。
 * 输入过程中不实时回写（用户需求：预览 / 填写不必逐键记录）；取值亦可经
 * `collectFieldValues(rootEl)` 直接遍历渲染 DOM 收集（用户需求：DOM 遍历采集）。
 * 内核不再依赖任何字符串 key 的 inject 约定（A4 / G15）。设计态不回写。
 */
/**
 * 读取可编辑区域的文本，保留换行：优先用 innerText（浏览器按渲染返回带 \n 的文本），
 * jsdom 等无 innerText 实现时回退 textContent。满足「字段 P 允许多行」。
 */
function readEditableText(el: HTMLElement): string {
  const inner = el.innerText;
  return typeof inner === "string" ? inner : (el.textContent ?? "");
}
function onFillBlur(field: string | undefined, event: Event): void {
  if (!canFill.value || !field) return;
  emit("field-change", field, readEditableText(event.target as HTMLElement));
}

/**
 * G11（A3 统一渲染路径）：innerBorder 字段在「预览 / 填写」下复用同一套逐行 `.layout-p__line`
 * 结构 —— 仅 `contenteditable` 差异（填写可编辑、预览只读），从而浏览态与填写态版式一致，
 * 且打印命中真实底边框（与 §0.3 已修打印一致）。
 * 填充态用 `v-once` 渲染避免每次输入触发 Vue 重渲染导致光标跳位；外部 data 变化（如 v-model:data 重置）
 * 经此 watch 用 `textContent` 重建（安全、无 HTML 注入），正在输入（焦点在可编辑区）时不打断。
 */
const innerLinesEl = ref<HTMLElement | null>(null);
function syncInnerLinesFromData(): void {
  if (props.node.type !== "p") return;
  const el = innerLinesEl.value;
  if (!el || !canFill.value) return;
  // 用户正在输入时（焦点在可编辑区）不重建，避免光标跳位
  if (el === (el.ownerDocument?.activeElement ?? null)) return;
  while (el.firstChild) el.removeChild(el.firstChild);
  for (const line of displayLines(props.node)) {
    const d = document.createElement("div");
    d.className = "layout-p__line";
    d.textContent = line;
    el.appendChild(d);
  }
}
watch(
  () => (props.node.type === "p" ? fieldValue(props.node) : ""),
  syncInnerLinesFromData,
);
onMounted(syncInnerLinesFromData);

/**
 * 字段展示值：优先 data 中的填写值。
 * - data 为 null/undefined（设计态）或 data 中**不存在该键**（未填写）→ 回退 `default`；
 * - data 中**存在该键但为空串 `""`**（用户主动清空）→ 返回空串，**不回退 default**，
 *   否则带默认值的字段将无法被清空（G16：清空 → 回写 "" → 回退 default → 又显示默认内容）。
 * - data 中键值为 `null`（显式空）→ 视为未填写，回退 `default`。
 */
function fieldValue(node: PNodeV2): string {
  const data = props.data;
  if (data == null) return node.default ?? "";
  if (!(node.field in data)) return node.default ?? "";
  const raw = data[node.field];
  if (raw == null) return node.default ?? "";
  return String(raw);
}

/** 内部边框：将字段值按换行拆成逐行文本，供静态/预览/打印态渲染为每行一个 <div>，
 *  使 `.layout-p--inner-border :deep(div)` 的底边框规则在打印态也能命中
 *  （设计态 contenteditable 回车生成的 div 同样走该规则）。空值返回 [""] → 至少一行。 */
function fieldLines(node: PNodeV2): string[] {
  return fieldValue(node).split("\n");
}

/** 字段控件已统一（A3 / 十续）：不再区分「填充态控件 / 静态文本」——
 *  设计/预览/填写/打印共用同一个可编辑 `<div>`，值落在内层 `<span>` 文本里，
 *  是否可输入只由 `contenteditable`（= `canFill` / 非 readonly）决定。 */

const BROKEN_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='60'%3E%3Crect width='100%25' height='100%25' fill='%23f1f5f9' stroke='%23cbd5e1'/%3E%3Ctext x='50%25' y='50%25' font-size='10' fill='%2394a3b8' text-anchor='middle' dominant-baseline='middle'%3E图片%3C/text%3E%3C/svg%3E";

/** 加载失败的图片下标（按 index 记录，换图 / 换数据时清空）。 */
const brokenIndexes = ref<number[]>([]);
/** 图片自然宽高比（宽 / 高）：无配置尺寸时用真实比例驱动「填充」布局的伸缩权重。 */
const naturalRatios = ref<Record<number, number>>({});

const imageNode = computed<ImageNodeV2 | null>(() =>
  props.node.type === "image" ? props.node : null,
);
/** 列表条目：数据驱动优先，回退静态模板，并按 `maxCount` 截断（与分页同口径）。 */
const imageItems = computed<ImageItemV2[]>(() =>
  imageNode.value
    ? resolveImageItemsV2(imageNode.value, {
        data: props.data,
        isDesign: resolvedMode.value === "design",
      })
    : [],
);
/**
 * 条目的**显式尺寸**（不含节点级默认兜底）：只用于写条目盒的 `data-width` / `data-height`。
 * 采集侧回读的是「行内配置 / 数据提供」的尺寸，默认值不落数据——否则默认宽高会被写进
 * 字段值固化下来，之后在面板改默认值对已保存的数据就不再生效（数据项尺寸优先级更高）。
 * `applyDefaults: false` 不改变条目数量与顺序，故与 `imageItems` 索引一一对齐。
 */
const imageExplicitItems = computed<ImageItemV2[]>(() =>
  imageNode.value
    ? resolveImageItemsV2(imageNode.value, {
        data: props.data,
        isDesign: resolvedMode.value === "design",
        applyDefaults: false,
      })
    : [],
);
/** 条目盒 `data-*` 上的显式尺寸（没显式配 → 空串，采集时不回写该维度）。 */
function explicitSize(index: number, dimension: "width" | "height"): number | "" {
  const value = imageExplicitItems.value[index]?.[dimension];
  return typeof value === "number" && value > 0 ? value : "";
}
const imageLayout = computed<ImageLayoutV2>(() => imageNode.value?.layout ?? "vertical");
/**
 * 整组图的**有效水平对齐**（`align` 未设时按布局取默认：垂直居中、水平/填充靠左）。
 * 与设计器面板同源（`resolveImageAlignV2`），面板显示什么就是这里生效什么。
 */
const imageAlign = computed<ImageAlignV2>(() =>
  imageNode.value
    ? resolveImageAlignV2(imageNode.value)
    : resolveImageAlignV2({ layout: undefined }),
);
/**
 * 整组图的**有效垂直对齐**（`verticalAlign` 未设时取 `top`，即升级前的 CSS 默认）。
 * 与水平对齐各管一个方向，同源 `resolveImageVerticalAlignV2`。
 */
const imageVerticalAlign = computed<ImageVerticalAlignV2>(() =>
  imageNode.value
    ? resolveImageVerticalAlignV2(imageNode.value)
    : resolveImageVerticalAlignV2({ verticalAlign: undefined }),
);
const imageShowName = computed(() => imageNode.value?.showName === true);
/**
 * 实际渲染的条目：**设计态列表为空时补一条占位**，否则节点会退化成零高度的空 div，
 * 既看不见也点不中（画布上无法再选中它）。预览 / 打印不补——那里没有可编辑的东西。
 */
const imageRenderItems = computed<ImageItemV2[]>(() => {
  if (imageItems.value.length > 0 || resolvedMode.value !== "design") return imageItems.value;
  const node = imageNode.value;
  // 占位条目同样吃节点级默认宽高，否则「只配了默认尺寸」的图在设计态量不出该尺寸。
  return [node ? withImageDefaultsV2(node, {}) : {}];
});
/** 整块列表都没有可显示地址：设计态仍需占位（可点选编辑），打印时不占版面。 */
const imageBlank = computed(
  () => imageNode.value !== null && !hasImageSourceV2(imageItems.value),
);
watch(
  () => [
    props.node.type === "image" ? props.node.images : null,
    props.node.type === "image" ? props.node.src : null,
    props.node.type === "image" ? props.node.field : null,
    props.node.type === "image" ? props.node.maxCount : null,
    props.node.type === "image" ? props.node.defaultWidth : null,
    props.node.type === "image" ? props.node.defaultHeight : null,
    props.data,
  ],
  () => {
    brokenIndexes.value = [];
    naturalRatios.value = {};
  },
  { deep: true },
);

/** 条目地址：加载失败时退回占位图（单张失败不影响同一列表里的其它图）。 */
function itemSrc(item: ImageItemV2, index: number): string {
  if (!item.src || brokenIndexes.value.includes(index)) return BROKEN_PLACEHOLDER;
  return item.src;
}
function onImgError(index: number): void {
  if (!brokenIndexes.value.includes(index)) brokenIndexes.value = [...brokenIndexes.value, index];
}
/** 记录自然宽高比，供「填充」布局在未配置尺寸时按真实比例分配行内空间。 */
function onImgLoad(index: number, event: Event): void {
  const img = event.target as HTMLImageElement | null;
  const w = img?.naturalWidth ?? 0;
  const h = img?.naturalHeight ?? 0;
  if (w > 0 && h > 0) naturalRatios.value = { ...naturalRatios.value, [index]: w / h };
}

/** 已知宽高比：配置尺寸优先，其次实测自然比例，最后缺省 1（正方形）。 */
function itemRatio(item: ImageItemV2, index: number): number {
  if (item.width && item.height && item.width > 0 && item.height > 0) {
    return item.width / item.height;
  }
  return naturalRatios.value[index] ?? 1;
}

/** 对齐值 → flex 关键字。 */
const IMAGE_ALIGN_FLEX: Record<ImageAlignV2, string> = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
};

/** 垂直对齐值 → flex 关键字（值域与 `ImageVerticalAlignV2` / 单元格 `cellVerticalAlign` 同构）。 */
const IMAGE_VERTICAL_ALIGN_FLEX: Record<ImageVerticalAlignV2, string> = {
  top: "flex-start",
  middle: "center",
  bottom: "flex-end",
};

/**
 * 容器对齐：**水平 `align` 与垂直 `verticalAlign` 各管一个方向**，按布局分别落到主轴 / 交叉轴
 * （两个方向互不覆盖，可同时生效）：
 * - 垂直布局（`column`）：水平 → `align-items`（交叉轴，每张图左右）；垂直 → `justify-content`（主轴）；
 * - 水平布局（`row`）：水平 → `justify-content`（主轴，整行左右）；垂直 → `align-items`（交叉轴，每行上下）；
 * - 填充布局：每行被 `flex-grow` 撑满 → 水平对齐无效果；`align-items: stretch`（CSS 里写死）是
 *   「同一条目行等高、图片按比例铺满」的前提，故这里**不写垂直对齐**，避免把行内撑满破坏掉。
 */
function imageContainerStyle(): CSSProperties {
  const horizontal = IMAGE_ALIGN_FLEX[imageAlign.value] as CSSProperties["alignItems"];
  const vertical = IMAGE_VERTICAL_ALIGN_FLEX[
    imageVerticalAlign.value
  ] as CSSProperties["alignItems"];
  if (imageLayout.value === "vertical") {
    return { alignItems: horizontal, justifyContent: vertical };
  }
  if (imageLayout.value === "fill") {
    return { justifyContent: horizontal };
  }
  return { justifyContent: horizontal, alignItems: vertical };
}

/**
 * 条目盒样式：**配置的 mm 宽高落到 `<img>` 上，盒子只承载宽度**（2026-09-29 修正）。
 *
 * 曾经把 `height` 也锁在盒子上，结果是「盒高 = 配置高」，而 `<img height:100%>` 会把盒高吃满，
 * 同列的 `.layout-image__name` 只能溢出盒外——被单元格的 `overflow:hidden` 裁掉，
 * 高度小（如 10mm）的条目尤其明显：图片的自然高（`min-height`）已占满盒子，名称一点位置都拿不到。
 * 现在盒高由内容决定（图片 + 名称各占自身高度），名称在任何高度下都不会被图片挤掉。
 * - 垂直 / 水平：宽度按配置（未设则自适应），`maxWidth:100%` 压回容器宽度；
 * - 填充：宽度由 `flex-grow ∝ 宽高比` 分配（行内撑满），高度随行宽与比例推得，
 *   故**不锁**配置的 mm 高——配置高在这里只提供比例，`flex-basis` 用配置宽决定换行点。
 */
function imageItemStyle(item: ImageItemV2, index: number): CSSProperties {
  const width = item.width && item.width > 0 ? `${item.width}mm` : undefined;
  if (imageLayout.value === "fill") {
    const ratio = Math.max(itemRatio(item, index), 0.05);
    return {
      width,
      maxWidth: "100%",
      flex: `${ratio} 1 auto`,
      minWidth: "0",
    };
  }
  if (imageLayout.value === "horizontal") {
    return { width, maxWidth: "100%", flex: "0 0 auto" };
  }
  return { width, maxWidth: "100%" };
}

/**
 * `<img>` 自身样式：配置尺寸写在图片上（不是盒子上），盒子高度随内容。
 * - 宽高都配 → 图片铺满盒子宽、高就是配置的 mm（长条型签名条走这条）；
 * - 只配宽 → 图片 100% 宽、高按自身比例；
 * - 只配高 → 图片高就是配置的 mm、宽按自身比例（`alignSelf: center` 抵消 flex 交叉轴的拉伸）；
 * - 都没配 → 图片自然尺寸（CSS 的 `max-width:100%` 兜底），不写死 `width:100%`；
 * - 「填充」布局：盒宽由 flex 分配，这里按宽高比等比放大（`aspect-ratio`），不锁 mm 高。
 */
function imageStyle(item: ImageItemV2, index: number): CSSProperties {
  const objectFit = imageNode.value?.objectFit;
  if (imageLayout.value === "fill") {
    const hasKnownRatio = Boolean(item.width && item.height) || naturalRatios.value[index] !== undefined;
    return {
      width: "100%",
      height: "auto",
      aspectRatio: hasKnownRatio ? `${itemRatio(item, index)}` : undefined,
      objectFit,
    };
  }
  const hasWidth = Boolean(item.width && item.width > 0);
  const hasHeight = Boolean(item.height && item.height > 0);
  const height = hasHeight ? `${item.height}mm` : undefined;
  if (hasWidth && hasHeight) return { width: "100%", height, objectFit };
  if (hasWidth) return { width: "100%", height: "auto", objectFit };
  if (hasHeight) return { width: "auto", height, alignSelf: "center", objectFit };
  return { objectFit };
}
</script>

<!--
  字段容器**必须是 `<div>`，不能是 `<p>`**（2026-09-11 修复）。
  原因：`innerBorder` 会在容器内渲染 `<div class="layout-p__line">`，而 `<p>` 的 HTML 内容模型
  只允许 phrasing content —— HTML 解析器遇到 `<div>` 会执行「close a p element」，强制闭合 `<p>`，
  把逐行 div 与后标签推到容器外面，末尾还会多出一个空 `<p>`。
  Vue 用 DOM API 建树、不经过解析器，所以**屏幕上一直正常**；但凡走一次 HTML 往返就会炸：
  局部打印（vue-print-next 走 `cloneNode` → `outerHTML` → `document.write`）、导出 HTML、SSR、复制粘贴。
  表现即「屏幕一行、打印时前后标签各占一行」。守卫见 FieldContainerHtmlRoundTrip.test.ts。

  注：本注释必须留在模板**外**——写成模板根级注释会成为 Fragment 的第一个节点，
  使多根组件下 VTU 的 wrapper.element 回退到宿主容器，令子组件单测断言失真。
-->
<template>
  <div
    v-if="node.type === 'grid'"
    class="layout-grid"
    :style="gridContainerStyle(node)"
    :class="[
      `layout-grid--${node.border}`,
      {
        'layout-grid--no-top': suppressBorders?.top,
        'layout-grid--no-right': suppressBorders?.right,
        'layout-grid--no-bottom': suppressBorders?.bottom,
        'layout-grid--no-left': suppressBorders?.left,
      },
    ]"
    :data-node-id="node.id"
    v-bind="nodeParamAttrs(node)"
  >
    <div
      v-for="(row, rowIndex) in node.rows"
      :key="row.id"
      class="layout-grid__row"
      :style="gridRowStyle(node, rowIndex)"
      :data-layout-id="row.id"
    >
      <div
        v-for="cell in row.cells"
        :key="cell.id"
        class="layout-grid__cell"
        :class="cell.flex ? 'layout-grid__cell--flex' : {}"
        :style="cellStyle(cell, node)"
        :data-layout-id="cell.id"
        :data-node-id="cell.id"
        v-bind="nodeParamAttrs(cell)"
      >
        <template v-for="(child, childIndex) in cell.children" :key="child.id">
          <GridSchemaNode
            :node="child"
            :base-row-height="baseRowHeight"
            :mode="resolvedMode"
            :data="data"
            :readonly="props.readonly"
            :field-permissions="props.fieldPermissions"
            :suppress-borders="
              cellSiblingSuppressBorders(cell.children, childIndex)
            "
            @field-change="
              (field: string, value: string) =>
                emit('field-change', field, value)
            "
          />
        </template>
      </div>
    </div>
  </div>

  <div
    v-else-if="node.type === 'text'"
    class="layout-text"
    :class="{}"
    :style="textStyle(node)"
    :data-node-id="node.id"
    v-bind="nodeParamAttrs(node)"
  >
    {{ node.text }}
  </div>

  <div
    v-else-if="node.type === 'p'"
    class="layout-p"
    :class="{
      'layout-p--field': true,
      'layout-p--composite': isCompositeField(node),
      'layout-p--underline': node.underline && !isCompositeField(node),
      'layout-p--inner-border': node.innerBorder,
      'layout-p--hidden': fieldPermission === 'HIDDEN',
    }"
    :style="pStyle(node)"
    :contenteditable="
      isCompositeField(node) || isImageValue(node)
        ? undefined
        : fieldPermission === 'EDIT'
          ? canFill
            ? 'true'
            : isEditable(node)
          : undefined
    "
    :data-field="node.field"
    :data-node-id="node.id"
    v-bind="nodeParamAttrs(node)"
    @blur="onFillBlur(node.field, $event)"
  >
    <span v-if="node.prefix" class="layout-p__label">{{ node.prefix }}</span>

    <!-- 复合字段（有前/后标签）：可输入区统一为 .layout-p__input，
         设计/预览/填写共用同一结构，仅 contenteditable 差异。
         ⚠️ 值必须由**元素**（.layout-p__value）承载，不可写成
         `<template v-else>{{ displayValue(node) }}</template>`：`<template>` 分支在
         contenteditable 宿主内是 Fragment（两侧各有一个空文本锚点），浏览器把键入文本
         插成**新文本节点**、Vue 只认识自己那个值节点 ⇒ 失焦写回重渲染后两者并存，
         显示翻倍（输入 `11` 变 `1111`）。与非复合字段同一口径，见 .layout-p__value 注释。 -->
    <span
      v-if="isCompositeField(node)"
      class="layout-p__input"
      :class="{ 'layout-p--underline': node.underline, 'layout-p__signbox': isImageValue(node) }"
      :style="[fieldInputStyle(node), signBoxStyle(node)]"
      :contenteditable="
        isImageValue(node)
          ? undefined
          : fieldPermission === 'EDIT'
            ? canFill
              ? 'true'
              : props.readonly
                ? undefined
                : 'true'
            : undefined
      "
      :data-field="node.field"
      @blur="onFillBlur(node.field, $event)"
      ><img
        v-if="signImageCount(node) === 1"
        class="layout-p__sign"
        :src="signImageUrls(node)[0]"
        :style="signImageStyle(node)"
        :alt="node.prefix ?? node.field"
      /><span
        v-else-if="signImageCount(node) > 1"
        class="layout-p__signs"
        :style="signWrapStyle(node)"
        ><img
          v-for="(signUrl, signIndex) in signImageUrls(node)"
          :key="signIndex"
          class="layout-p__sign"
          :src="signUrl"
          :style="signImageStyle(node)"
          :alt="node.prefix ?? node.field"
      /></span><template v-else-if="node.innerBorder"
        ><div
          v-for="(line, li) in displayLines(node)"
          :key="li"
          class="layout-p__line"
        >
          {{ line }}
        </div></template
      ><span v-else class="layout-p__value">{{ displayValue(node) }}</span></span
    >

    <!-- 图片值（非复合字段）：签名图作为 .layout-p 的直接子项贴底排布，坐落在字段
         自身的 border-bottom（签名线）上。必须接成同一条 v-if 链（v-else-if）——
         独立写 v-if 时条件不满足会留下注释占位节点，把容器子元素数从 3 顶成 4，
         破坏字段容器 HTML 往返与整票快照基线。空值不渲染此图，走下面的空态分支。
         多人签名（2026-09-30）：**单张仍走单 <img> 分支**（DOM 与升级前逐字节一致），
         仅 N > 1 时换成 `.layout-p__signs` 容器承载并排多图——用 <template v-for> 直接
         接在链上会引入 Fragment 锚点（实测每个空文本节点 ×2），同样会顶掉子元素数。 -->
    <img
      v-else-if="signImageCount(node) === 1"
      class="layout-p__sign layout-p__sign--inline"
      :src="signImageUrls(node)[0]"
      :style="signImageStyle(node)"
      :alt="node.field"
    />
    <span
      v-else-if="signImageCount(node) > 1"
      class="layout-p__signs layout-p__signs--inline"
      :style="signWrapStyle(node)"
      ><img
        v-for="(signUrl, signIndex) in signImageUrls(node)"
        :key="signIndex"
        class="layout-p__sign"
        :src="signUrl"
        :style="signImageStyle(node)"
        :alt="node.field"
    /></span>

    <!-- 非复合字段：innerBorder 时逐行渲染（v-once 静态 + 填写态 DOM 重建）。 -->
    <span
      v-else-if="node.innerBorder"
      ref="innerLinesEl"
      class="layout-p__lines"
      v-once
      ><div
        v-for="(line, li) in displayLines(node)"
        :key="li"
        class="layout-p__line"
      >
        {{ line }}
      </div></span
    >

    <!-- 非复合字段：普通展示值。直接作为 <div> 的 v-else 子项（不经 <template v-else>
         包裹，否则 contenteditable <div> 的数据晚到时文本子节点不会重新 patch）。 -->
    <span v-else class="layout-p__value">{{ displayValue(node) }}</span>

    <span v-if="node.suffix" class="layout-p__label">{{ node.suffix }}</span>
  </div>

  <table
    v-else-if="node.type === 'table'"
    class="layout-table"
    :class="[`layout-table--${node.border ?? 'all'}`]"
    :data-node-id="node.id"
    v-bind="nodeParamAttrs(node)"
  >
    <thead>
      <tr
        class="layout-table__row layout-table__header"
        :style="[
          tableColumnStyle(node.columns),
          { minHeight: `${baseRowHeight}mm` },
        ]"
      >
        <th
          v-for="column in node.columns"
          :key="column.key"
          class="layout-table__cell"
          :style="tableHeaderCellStyle(column, node.headerStyle)"
        >
          {{ column.title }}
        </th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="rowIndex in tablePaginatedRowCount(node, data)"
        :key="rowIndex"
        class="layout-table__row"
        :style="[
          tableColumnStyle(node.columns),
          { minHeight: `${baseRowHeight}mm` },
        ]"
      >
        <td
          v-for="column in node.columns"
          :key="column.key"
          class="layout-table__cell"
          :style="tableCellStyle(column)"
          :data-layout-id="tableTemplate(node, column.key)?.id"
        >
          <template
            v-for="child in tableTemplate(node, column.key)?.children ?? []"
            :key="`${child.id}-${rowIndex}`"
          >
            <GridSchemaNode
              :node="bindRowCell(child, column.key, rowIndex)"
              :base-row-height="baseRowHeight"
              :mode="resolvedMode"
              :data="data"
              :readonly="props.readonly"
              :field-permissions="props.fieldPermissions"
              @field-change="
                (field: string, value: string) =>
                  emit('field-change', field, value)
              "
            />
          </template>
        </td>
      </tr>
    </tbody>
  </table>

  <HtmlBlock
    v-else-if="node.type === 'html'"
    :node="node"
    :data="data"
    :readonly="props.readonly"
    :field-permissions="props.fieldPermissions"
    v-bind="nodeParamAttrs(node)"
    @field-change="(field: string, value: string) => emit('field-change', field, value)"
  />

  <!-- 图片列表：容器持有节点级 `data-field`（列表整体是那个字段），
       每个条目再带一份 `data-field` + index，供 `collectFieldValues` 组装成对象数组。 -->
  <div
    v-else
    class="layout-image"
    :class="[`layout-image--${imageLayout}`, { 'layout-image--blank': imageBlank }]"
    :data-node-id="node.id"
    :data-field="node.field"
    :data-image-align="imageAlign"
    :data-image-vertical-align="imageVerticalAlign"
    :style="imageContainerStyle()"
    v-bind="nodeParamAttrs(node)"
  >
    <div
      v-for="(item, index) in imageRenderItems"
      :key="index"
      class="layout-image__item"
      :class="{ 'layout-image__item--blank': !item.src }"
      :data-field="node.field"
      :data-image-index="index"
      :data-name="item.name ?? ''"
      :data-width="explicitSize(index, 'width')"
      :data-height="explicitSize(index, 'height')"
      :style="imageItemStyle(item, index)"
    >
      <img
        class="layout-image__img"
        :src="itemSrc(item, index)"
        :alt="item.name ?? node.field ?? ''"
        :data-fallback="item.src && !brokenIndexes.includes(index) ? null : 'true'"
        :style="imageStyle(item, index)"
        @error="onImgError(index)"
        @load="onImgLoad(index, $event)"
      />
      <span v-if="imageShowName && item.name" class="layout-image__name">{{ item.name }}</span>
    </div>
  </div>
</template>

<style scoped>
.layout-grid {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

/* 弹性单元格（cell.flex）：基础 `.layout-grid__cell` 已是 `display:flex`（默认 row），
   此处仅额外开启换行；水平/垂直对齐由 cellStyle 的内联样式（cell.align / cell.verticalAlign）
   驱动，与普通单元格一致。子节点作为 flex item 自适应内容宽度（不强制 100%），
   从而沿水平方向连续排布、到达边界换行。 */
.layout-grid__cell--flex {
  flex-wrap: wrap;
}

.layout-grid__row {
  display: grid;
  flex: 0 0 auto;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.layout-grid__cell {
  display: flex;
  /* flex-direction: column; */
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  overflow: hidden;
}

/* 弹性单元格（cell.flex）的子节点：作为 flex item 自适应内容宽度，
   不被自身 `width:100%` 顶满整行。否则普通 `.layout-p`/`.layout-text` 的
   `width:100%` 会让每个子节点独占一行、失去横向流式效果。 */
.layout-grid__cell--flex > .layout-p,
.layout-grid__cell--flex > .layout-text {
  flex: 0 1 auto;
  width: auto;
  min-width: 0;
}

/* 单边归属规则（P4.3 / 十四续 gap 修正）：外框仅由 Grid 容器绘制；
   内部水平分隔线画在「非末行」cell 的下边框、内部垂直分隔线画在「非末列」cell 的右边框。
   这样每条内部线都落在「拥有它的那个 cell」自身边缘上——gap>0 时线紧贴该列/行的右/下边界，
   留白落在外侧，不会出现「前一列看起来没有右边框、与 gap 融为一体」的错觉（旧规则把线画在
   下一格的 left/top 上，gap 会把线推到 gap 中间，导致前一格视觉上无边框）。
   同时每条线只被一个元素拥有（非末列画 right、末列不画；非末行画 bottom、末行不画），
   与容器外框不重叠，嵌套 Grid / Table 相邻也不会出现双边框。
   border 语义：all = 外框 + 内部线；outer = 仅外框（不画内部线）；
   inner = 仅内部线（无外框，由外层 Grid 承担）；none = 无。 */
.layout-grid--all,
.layout-grid--outer {
  border: 1px solid #111827;
}

/* 相邻 Grid 外框去重（Item 2）：当与相邻兄弟 Grid 都绘制外框时，隐藏本 Grid 的
   引导侧边框（页面级 top / 单元格级 left），仅保留前者拖尾侧单线，避免重叠成 2px。
   这些规则位于 --all/--outer 之后，等特异性下靠源码顺序胜出。 */
.layout-grid--no-top {
  border-top: none;
}
.layout-grid--no-right {
  border-right: none;
}
.layout-grid--no-bottom {
  border-bottom: none;
}
.layout-grid--no-left {
  border-left: none;
}

/* 内部水平分隔线：非末行的 cell 下边框 = 本行的下边界。
   仅 all / inner 绘制；outer（仅外框）与 none 不画内部线。
   gap>0 时线紧贴本行下边缘，留白（row-gap）落在外侧，行与行不粘连。 */
.layout-grid--all > .layout-grid__row:not(:last-child) > .layout-grid__cell,
.layout-grid--inner > .layout-grid__row:not(:last-child) > .layout-grid__cell {
  border-bottom: 1px solid #111827;
}

/* 内部垂直分隔线：非末列的 cell 右边框 = 本列的右边界。
   仅 all / inner 绘制；outer（仅外框）与 none 不画内部线。
   gap>0 时线紧贴本列右边缘，留白（column-gap）落在外侧，列与列不粘连。 */
.layout-grid--all > .layout-grid__row > .layout-grid__cell:not(:last-child),
.layout-grid--inner > .layout-grid__row > .layout-grid__cell:not(:last-child) {
  border-right: 1px solid #111827;
}

.layout-p {
  display: flex;
  flex-wrap: wrap;
  width: 100%;
  min-width: 0;
  min-height: 0;
  align-self: center;
  margin: 0 1mm;
  padding: 0;
  align-items: center;
  box-sizing: border-box;
  color: #111827;
  /* 字号默认值来自页面属性的「基础字号」：`--v2-base-font-size` 由 `GridFormRenderer.paperStyle`
     下发到纸张根（含打印序列化 DOM），未注入时回退 13px。`.layout-text` 同为 var(...)，
     与分页估算 `resolveBaseFontSizeV2` 同源 —— 三处必须一致，否则「屏幕字号」与「分页算高」错配。 */
  font-size: var(--v2-base-font-size, 13px);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  outline: none;
}

/* 设计态直接可编辑的 <div>（无前/后标签）：回车插入的 <div> 默认成为 flex 行内子项、
   被排成一行，导致多行换行失效（前标签非 null 时用 inline-block 的 .layout-p__input
   包裹，无此问题）。强制每个插入的 div 占满整行并换行，使多行换行生效，
   即使空字段下回车也能正常换行。复合字段的可编辑区域在 .layout-p__input（非 <div> 直接子级），
   故不受影响。
   注意：contenteditable 插入的 <div> 是浏览器运行时塞入、不带 scoped 的 data-v 属性，
   普通 `.layout-p > div`（编译为 `.layout-p[data-v] > div[data-v]`）匹配不到——
   故用 :deep() 去掉子选择器的 scope 属性，才能命中这些运行时 div。 */
.layout-p :deep(div) {
  flex: 1 1 100%;
  width: 100%;
  min-width: 0;
}

/* 内部边框（innerBorder）：为 p 标签内每一行画底边框，用于手写表单的「横线」效果。
   默认不显示（无此类）；勾选后设计态（contenteditable 回车生成的 div）/ 预览（静态
   逐行 div）/ 打印（静态渲染产出的 div）均保持显示——规则不放在任何 @media 内，
   且绘制的是真实 border（非背景图），故打印必然命中、不受浏览器「忽略背景图形」影响。 */
.layout-p--inner-border :deep(div) {
  border-bottom: 1px solid #111827;
}

.layout-text {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 0;
  align-self: center;
  margin: 0;
  padding: 0 1mm;
  align-items: center;
  box-sizing: border-box;
  color: #111827;
  font-size: var(--v2-base-font-size, 13px);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  outline: none;
}

.layout-p--field {
  cursor: text;
}

/* P9.2b 字段级 HIDDEN（2026-09-08 用户拍板改为脱敏口径）：字段外壳与前/后标签照常
   渲染、占位与分页高度不变，**输入内容以 `***` 替代**（真实值不进 DOM）。
   `.layout-p--hidden` 类不再做视觉隐藏，保留为功能钩子——collectFieldValues 靠它
   区分脱敏字段（导出保持 *** / 保存回源真实值）。 */
.layout-p--hidden {
  /* 无视觉样式：脱敏由 displayValue/displayLines 在值层面完成。 */
}

/* 设计态空字段（contenteditable 无内容）时，插入零宽行盒使光标垂直居中，
   避免光标贴着上边框；零宽为伪元素、不可被 contenteditable 删除，故清空文本后光标仍居中。 */
/* .layout-p::before {
  content: "\200b";
}
.layout-p__input::before {
  content: "\200b";
} */

.layout-p--composite {
  gap: 1mm;
}

.layout-p__label {
  flex: 0 0 auto;
  white-space: nowrap;
}

.layout-p__input {
  display: inline-block;
  flex: 1 1 auto;
  min-width: 12mm;
  /* 1.6em = .layout-p 的 line-height：空值时也要占满一整行。
     若只给 1em，空的块盒比行盒矮，行盒（含光标）会向下溢出，
     表现为「光标压在底部横线的下方」（见 .layout-p__value 注释）。 */
  min-height: 1.6em;
  outline: none;
}

/* 非复合字段的展示值：原先直接作为 <div> 的文本内容渲染，但 Vue 对
   contenteditable <div> 的直接文本子节点在「数据晚于挂载到达」时不会重新 patch
   （复合字段的值放在 .layout-p__input 内则正常）。统一用 .layout-p__value 承载，
   作为 <div> 的 flex 子项填充整行，既保持版式一致，又让预览/填充态数据变化能正确刷新。 */
.layout-p__value {
  flex: 1 1 auto;
  min-width: 0;
  /* 空值兜底（关键）：该 span 作为 flex 子项会被「块化」，内容为空时高度为 0，
     于是 <div> 的内容盒塌缩成 0，只剩 1px 下边框——在单元格里（align-self:center）
     看起来就是「垂直居中的一条直线」；而光标所在的行盒仍按 line-height 从内容盒
     顶部向下撑开，于是光标落在横线下方。
     给定一个行高（1.6em，与 .layout-p 的 line-height 一致）作为最小高度，
     空字段也能占满一整行：光标在行内垂直居中、底部才是边框线（同普通 input）。
     有内容时以内容高度为准，min-height 仅作下限，不影响多行换行版式。 */
  min-height: 1.6em;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* 复合字段（`.layout-p__input` 内）的值载体：必须**铺满**可输入区。
   内联元素的盒宽为 0（空值时），点在 min-width:12mm 可输入区里、值元素之外时，
   光标落在外层 contenteditable 上、键入文本成为**外层**的直接文本子节点 ——
   失焦写回后与内层值节点并存 ⇒ 显示翻倍（同 .layout-p__input 注释里的 Fragment 坑）。
   display:block + width:100% 让值元素覆盖整个可输入区，光标与键入恒落在其内部。
   仅改盒类型/宽度，不影响外层 min-width:12mm 与版式（内置元素原为内联、宽度即文本宽）。 */
.layout-p__input > .layout-p__value {
  display: block;
  width: 100%;
  min-height: 1.6em;
}

/* 签名图（`valueType === "image"`，2026-09-29）：图片值字段的容器改为**底对齐**弹性盒，
   让签名图底边压在 `.layout-p__input` 的 border-bottom 上（那条线就是签名线）。
   高度由 `imageHeight` 决定，**留空则与标签（文字行盒）等高**（= `line-height: 1.6`，
   见 `DEFAULT_SIGN_IMAGE_HEIGHT_V2`）；宽度受输入区约束、按比例（`object-fit: contain` 不裁不拉）。
   标签与签名图同处 `.layout-p`（flex row）⇒ 二者水平并排，图紧贴标签右侧。
   容器 min-height 由内联的 signBoxStyle 给出（仅配了 `imageHeight` 时需要；留空时
   `.layout-p__input` 自带的 `min-height: 1.6em` 已与图片同高），保证空态（未签名）
   与有值（已签名）两态的下划线落在同一位置。 */
.layout-p__signbox {
  display: flex;
  align-items: flex-end;
}

.layout-p__sign {
  display: block;
  max-width: 100%;
  object-fit: contain;
}

/* 多人签名（2026-09-30）：一条下划线上并排多张签名图，一行放不下即换行、多行整体贴底。
   该容器**只在 N > 1 时渲染**（单张仍走单 <img> 路径，DOM 与升级前逐字节一致），
   故这些规则不参与单图 / 空态的任何计算。间距 `gap` 是节点级配置，由 signWrapStyle 下发。

   flex: 1 1 auto + min-width: 0 是让**换行真正发生**的前提：容器必须被约束到可用宽度，
   否则它会按 max-content 撑开（等于所有图之和）从而永不换行、直接溢出字段。
   图自身的 max-width: 100% 是相对本容器解析的，故单张超出时也不会溢出。 */
.layout-p__signs {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  align-items: flex-end;
  align-content: flex-end;
  min-width: 0;
}

/* 非复合字段下容器是 `.layout-p`（align-items: center）的直接子项，需显式贴底才能
   让图底压在字段自身的下划线上——与 `.layout-p__sign--inline` 同理。 */
.layout-p__signs--inline {
  align-self: flex-end;
}

/* 并排的图不参与伸缩：宽度按图片自身比例，超宽交回容器换行（若允许压缩，多张图会挤成
   一排窄图而非换行，与「多人签名：___________」的票面预期不符）。 */
.layout-p__signs > .layout-p__sign {
  flex: 0 0 auto;
}

/* 非复合字段的签名图直接作为 `.layout-p`（flex）的子项，贴底对齐才能落在
   字段自身的下划线上（`.layout-p` 默认 align-items: center 会把它居中）。 */
.layout-p__sign--inline {
  align-self: flex-end;
}

/* 字段 P 已统一渲染为可编辑 <div>（预览 / 填写态与设计态同结构，行高一致），
   不再使用 textarea 控件（G11 的 textarea 分支已回退，见十续）。复合字段的可输入区
   为 .layout-p__input（设计/预览/填写共用），见上。 */

/* 内部边框逐行：静态/预览/打印态将字段值拆成每行一个 <div class="layout-p__line">，
   min-height 保证空行也有一行的高度（底边框可见）；通用 `.layout-p :deep(div)` 已让其
   占满整行换行，`.layout-p--inner-border :deep(div)` 再为每个 div 画底边框（真实边框，
   打印必然显示，不依赖背景图形）。 */
.layout-p__line {
  min-height: 1.6em;
  width: 100%;
  text-align: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* G11：innerBorder 字段在预览 / 填写下共用的逐行可编辑容器（仅 contenteditable 差异）。
   内部 .layout-p__line 的底边框由 `.layout-p--inner-border :deep(div)` 绘制，真实边框打印必显示。 */
.layout-p__lines {
  display: block;
  width: 100%;
  outline: none;
  min-height: 1.6em;
}

.layout-p--underline {
  border-bottom: 1px solid #111827;
}

.layout-table {
  display: block;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border-collapse: collapse;
}

/* 外框：仅 all / outer 绘制（与 Grid 边框语义一致：none/inner 不画外框）。 */
.layout-table--all,
.layout-table--outer {
  border: 1px solid #111827;
}

/* 内部线：仅 all / inner 绘制（非末行底边 + 非末列右边 + 表头/表体分隔线）；
   outer / none 不画内部线。每条线单一归属，避免与外层 Grid 重复（P4.3）。 */
.layout-table--all .layout-table__row:not(:last-child),
.layout-table--inner .layout-table__row:not(:last-child) {
  border-bottom: 1px solid #111827;
}

.layout-table--all .layout-table__cell:not(:last-child),
.layout-table--inner .layout-table__cell:not(:last-child) {
  border-right: 1px solid #111827;
}

.layout-table--all .layout-table__header,
.layout-table--inner .layout-table__header {
  border-bottom: 1px solid #111827;
}

.layout-table > thead,
.layout-table > tbody {
  display: block;
  width: 100%;
}

.layout-table__row {
  display: grid;
  width: 100%;
  min-width: 0;
  flex: 0 0 auto;
}

.layout-table__cell {
  display: flex;
  min-width: 0;
  min-height: 0;
  margin: 0;
  padding: 0 1mm;
  align-items: stretch;
  justify-content: center;
  box-sizing: border-box;
  white-space: pre-wrap;
  word-break: break-word;
}

.layout-table__header {
  align-items: center;
  /* 表头默认加粗（600）：`TableInspector` 的「粗细」在未设 `headerStyle.fontWeight`
     时即按此显示「加粗」，改这里要同步面板默认，否则又会出现「显示常规、实际加粗」。 */
  font-weight: 600;
  text-align: center;
  /* 表头默认字号：随页面属性的「基础字号」按 16/13 等比缩放（变量由 `paperStyle` 下发），
     与 `TableInspector` 面板显示的默认值同源（`resolveTableHeaderFontSizeV2`）。
     未设 `headerStyle.fontSize` 时才生效；不以内联样式写入，保留回退语义。 */
  font-size: var(--v2-table-header-font-size, 16px);
}

/* 图片列表容器：三种布局共用同一套条目 DOM，仅容器方向与条目伸缩规则不同。 */
.layout-image {
  display: flex;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  gap: 1mm;
}

/* 垂直：一张一行。两个方向的对齐都由渲染层内联驱动（水平 → `align-items`、
   垂直 → `justify-content`，见 `imageContainerStyle`）——不在这里写死，否则面板上的
   「水平 / 垂直对齐」不生效。 */
.layout-image--vertical {
  flex-direction: column;
}

/* 水平：并排一行、可换行。`align-items` 是垂直对齐的**默认值兜底**（缺省 top = flex-start），
   显式配置由渲染层内联样式覆盖。 */
.layout-image--horizontal {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: flex-start;
}

/* 填充：按条目尺寸（或实测比例）自动换行并撑满整行——`flex-grow` 由内联样式给出。
   `align-items: stretch`（同一行条目等高、图片按比例铺满）是该布局的前提，
   所以渲染层对填充布局**不**写垂直对齐（见 `imageContainerStyle`）。 */
.layout-image--fill {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: stretch;
}

.layout-image__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
  box-sizing: border-box;
}

.layout-image--fill .layout-image__item,
.layout-image--horizontal .layout-image__item {
  align-items: stretch;
}

/* 尺寸不写死在 CSS 里：`width` / `height` 都由渲染层按配置写到 `<img>` 上，
   条目盒只承载宽度、高度随内容（图片 + 名称各占自身）——2026-09-29 起盒高不再锁 mm，
   否则图片会把盒高吃满、同列的名称被挤出盒外裁掉（小高度条目尤其明显）。
   `flex: 0 0 auto`：图片与名称都不参与 flex 压缩，配置的 mm 高就是真实渲染高。 */
.layout-image__img {
  display: block;
  flex: 0 0 auto;
  max-width: 100%;
  object-position: center;
  box-sizing: border-box;
}

/* 名称说明文字：仅在「显示名称」打开时渲染。与图片同在一个纵向条目盒里，
   图片高 + 一行文字高 = 条目盒高（分页估算 `imageItemHeightMm` 同口径）。 */
.layout-image__name {
  display: block;
  flex: 0 0 auto;
  width: 100%;
  font-size: 11px;
  line-height: 1.4;
  text-align: center;
  color: inherit;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 没配地址的条目：屏幕上保留占位灰框（设计态要靠它选中/编辑），打印时不占版面；
   整块列表都没有来源时容器也带 `--blank`（见下），两层都隐藏，避免挤出一张空白纸。 */
@media print {
  .layout-image--blank,
  .layout-image__item--blank {
    display: none;
  }
  /* 输入框下划线（.layout-p--underline）是设计/预览态的「可填写」提示线，打印时不输出
     （手写票应保持干净）。显式勾选「显示内部边框」(innerBorder) 的逐行实线边框由独立的
     .layout-p--inner-border :deep(div) 绘制、不在本媒体内，故仍正常打印——
     即「默认无下划线，除非选了内部边框」。 */
  .layout-p--underline {
    border-bottom: none;
  }
}

/* D3：插入指示线（`.v2-insertion-line`）与拖拽悬停态（`dragOverCellId` / `dragOverIndex`）
   已整体移出内核——它们是设计态交互，由设计表面层 `designer/CanvasSurface.vue` 用
   overlay 绝对定位绘制（内核不认识拖拽/落点，也不再为设计态输出任何 DOM 分支）。
   内�erit;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 没配地址的条目：屏幕上保留占位灰框（设计态要靠它选中/编辑），打印时不占版面；
   整块列表都没有来源时容器也带 `--blank`（见下），两层都隐藏，避免挤出一张空白纸。 */
@media print {
  .layout-image--blank,
  .layout-image__item--blank {
    display: none;
  }
  /* 输入框下划线（.layout-p--underline）是设计/预览态的「可填写」提示线，打印时不输出
     （手写票应保持干净）。显式勾选「显示内部边框」(innerBorder) 的逐行实线边框由独立的
     .layout-p--inner-border :deep(div) 绘制、不在本媒体内，故仍正常打印——
     即「默认无下划线，除非选了内部边框」。 */
  .layout-p--underline {
    border-bottom: none;
  }
}

/* D3：插入指示线（`.v2-insertion-line`）与拖拽悬停态（`dragOverCellId` / `dragOverIndex`）
   已整体移出内核——它们是设计态交互，由设计表面层 `designer/CanvasSurface.vue` 用
   overlay 绝对定位绘制（内核不认识拖拽/落点，也不再为设计态输出任何 DOM 分支）。
   内核对外 props 只剩 schema 数据与版式相关的 `suppressBorders`。 */
</style>
