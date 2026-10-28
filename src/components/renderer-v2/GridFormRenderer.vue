<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { CSSProperties } from "vue";
import {
  resolvePaperSizeV2,
  DEFAULT_BAND_HEIGHT_MM,
  type FormSchemaV2,
  type FormDataV2,
  type FormNodeV2,
  type FieldPermissionV2,
  type EdgeInsetsV2,
  type HeaderFooterV2,
  type ImageRemovePayloadV2,
  type SignImageRemovePayloadV2,
} from "@/types";
import GridSchemaNode from "./GridSchemaNode.vue";
import { registerPageSizeStyle, setPageSizeStyle } from "./page-size-style";
import { measureHeightMm } from "./measure-rows";
import { pageHasVisibleContent } from "./paper-visibility";
import { resolveNodeParamAttrs } from "@/utils/node-params";
import type { PhysicalPage } from "@/engine-v2/pagination";
import { gridRowHeightMm, paginatePage, paginateSchema } from "@/engine-v2/pagination";
import {
  resolveBaseFontSizeV2,
  resolveTableHeaderFontSizeV2,
} from "@/engine-v2/derivation";

defineOptions({ name: "GridFormRenderer" });

const emit = defineEmits<{
  (e: "field-change", field: string, value: string): void;
  /** 图片列表「删除某一张」：内核只转发信号，删除后的写回归宿主（见 `GridSchemaNode` 同名事件）。 */
  (e: "image-remove", payload: ImageRemovePayloadV2): void;
  /** 签名图「删除某一张」：同上，唯一差异是载荷里的 `item` 是地址字符串（签名值域是 `string[]`）。 */
  (e: "sign-remove", payload: SignImageRemovePayloadV2): void;
}>();

const props = withDefaults(
  defineProps<{
    schema: FormSchemaV2;
    /**
     * 渲染模式（A1 / A5 分层重构）：显式声明调用方意图，取代旧版靠 `data != null` 推断三态。
     * - design：设计态，字段以 contenteditable 就地占位（不回写 schema），结构可编辑。
     * - preview：带数据回显，**字段可输入**（消费模板、输入数据以配合流程流转）。
     * 未传时向后兼容：有 `data` → preview，否则 design。
     * ⚠️ `mode` 不决定可编辑性；真正的「不可输入」由下面的 `readonly` 闸门决定。
     */
    mode?: "design" | "preview";
    /** 填充/预览态数据；用于字段取值与 Table 行数推导。设计态可为空（字段显示 default/占位）。 */
    data?: FormDataV2 | null;
    /**
     * 只读闸门：为 `true` 时字段一律不可输入（真·只读回显/打印浏览）。
     * 与 `mode` **正交**——`mode` 不决定可编辑性：
     * - `FormRenderer` 默认 `readonly=true`（消费页默认只读回显），显式传 `readonly=false` 即进入填写态；
     * - 设计器预览态显式传 `:readonly="false"`（查看输入交互效果，亦不回写 schema）。
     */
    readonly?: boolean;
    /**
     * 无外壳模式（G8/G10）：去掉灰底纸张画布外壳（padding / 背景 / 阴影），
     * 仅渲染纸张 `<main>`，便于消费页把表单嵌入自身页面中部（而非模拟整张纸）。
     */
    bare?: boolean;
    /**
     * 分页开关（默认 true）：预览/填写/打印时按纸张正文高度把超高内容切成多个物理页；
     * 设计态传 false，整页连续渲染便于编辑（不切分）。
     */
    paginate?: boolean;
    /**
     * 隐藏「渲染后无可打印内容」的物理页的开关（判定见 `paper-visibility.ts`）。
     *
     * - `"auto"`（缺省）：按渲染模式自动 —— **非设计态隐藏、设计态保留**。
     *   非设计态（`mode="preview"`，或未传 `mode` 且有 `data`）：屏幕所见即打印所得，
     *   不会出现「看着 2 页、只出 1 张」的错配。
     *   设计态（`mode="design"`，或未传 `mode` 且无 `data`）：**保留**，画布上每一页都要能
     *   点中、能编辑 —— 哪怕它此刻还没有任何可见内容（空白页也可能带着 Grid 行列结构等着填）。
     * - `"hide"`：强制隐藏。设计器的「打印」按钮用它 —— `printForm` 序列化的就是设计画布，
     *   此刻必须把空白纸挡在打印流之外（见 `FormDesigner.printDocument`）。
     * - `"keep"`：强制保留。
     *
     * 为什么是字符串三态而不是布尔：布尔 prop 缺省时会被 Vue 强制转成 `false`，无法表达
     * 「缺省跟着 `mode` 走」这层语义（`withDefaults` 给的 `default: undefined` 又被类型推断拒绝）。
     */
    blankPageMode?: "auto" | "hide" | "keep";
    /**
     * 字段级运行时权限（P9.2a/P9.2b，与 `data` 同轨经 props 注入，不进 schema）：
     * `{ 字段名: "READ" | "EDIT" | "HIDDEN" }`。EDIT=可输入（缺省）；READ=只读回显；
     * HIDDEN=隐藏且保留固定空间（visibility:hidden，占位/分页高度不变，值仍可采集）。
     * 未注明的字段一律 EDIT，向后兼容。
     */
    fieldPermissions?: Record<string, FieldPermissionV2>;
  }>(),
  { paginate: true, blankPageMode: "auto" },
);

/** 纸张物理尺寸（mm），方向由纸张尺寸派生（A4 纵向 / A3 横向）。
 *  与打印 `@page`、溢出校验共用 `resolvePaperSizeV2`，避免各处硬编码。 */
const paperSize = computed(() => resolvePaperSizeV2(props.schema.paper));

/**
 * 打印纸张尺寸（P11-3 修复）：把当前纸张宽高写入全局 `@page` 规则。
 * `@page` 是页面级规则，无法写成 scoped 样式也无法用 Vue 绑定，故由内核在运行时注入；
 * 纸张切换（A4 ↔ A3）时同步更新，实例卸载时释放（见 `page-size-style.ts`）。
 * 修复前该规则在设计器里写死 `size: A4`，导致选 A3 横向时渲染正常、打印仍按 A4 出页而内容被裁。
 */
watch(
  paperSize,
  (size) => setPageSizeStyle(size.widthMm, size.heightMm),
  { immediate: true },
);
onUnmounted(registerPageSizeStyle());

/**
 * 打印纸张高度安全余量（mm）：分页态纸张 `height` 取「整纸高 − 本余量」而非整纸高。
 *
 * 原因：`@page { size: Wmm Hmm; margin: 0 }` 的页面内容区恰为整纸高，而纸张元素 `height: 297mm`
 * 经浏览器 `mm→px`（96DPI）换算为 1122.52px（非整数），取整后纸张比页面高出一缕（<1px）⇒
 * 溢出到下一页成为**空白尾页**（新建空白页也会出现）。留 0.5mm（≈1.9px）余量使纸张严格小于页高即可，
 * 大于任何取整误差，可稳妥消除；且远小于 12mm 底边距——正文最大底部仅到 `12 + bodyHeightMm`，
 * 余量只会吃掉页底一点白边，**不会裁到内容，也不改变分页结果（页数不变）**。
 */
const PRINT_PAPER_HEIGHT_EPSILON_MM = 0.5;

/**
 * 纸张尺寸：
 * - **分页开启**（`height` 固定为「整纸高 − 安全余量」）：分页引擎保证每页内容 ≤ 正文可用高
 *   （`heightMm − margin.top − margin.bottom`）；配合 `box-sizing: border-box`，内容盒高度与分页引擎的
 *   `bodyHeightMm` 口径一致。高度特意略小于整纸高（见 {@link PRINT_PAPER_HEIGHT_EPSILON_MM}），
 *   避免 `height == 页面高` 时因取整溢出一缕、打印多出空白尾页。
 * - **分页关闭**（设计态整页连续编辑）：改用 `min-height`（不加余量，保持与整纸高一致便于编辑对位）。
 *   此时不做切分，内容可能远超一张纸；用 `min-height` 让纸张随内容长高，内容落在纸内。
 *
 * 之所以分页开启用 `height` 而非 `min-height`：`min-height` 只设下限，会让单物理页被无限撑开、
 * 看不出「已超出一张纸」；而分页本就会把内容切走，固定高度即一张纸。
 *
 * `position: relative` 供页眉 / 页脚带绝对定位（驻留上/下边距区）。
 */
function paperStyle(margin: EdgeInsetsV2): CSSProperties {
  const size = paperSize.value;
  const useFixed = props.paginate;
  // 全局基础字号（页面属性里的「基础字号」）：以 CSS 变量下发到整张纸（含打印序列化的 DOM），
  // 供 `.layout-p` / `.layout-text` / 表格表头这些「未显式设字号」的默认值消费（见 GridSchemaNode 的 var(...)）。
  // 与分页估算同源（`resolveBaseFontSizeV2`）——否则会出现「屏幕上字号 16、分页按 13 算高」的错配。
  const baseFontSize = resolveBaseFontSizeV2(props.schema);
  return {
    position: "relative",
    width: `${size.widthMm}mm`,
    ...(useFixed
      ? { height: `${size.heightMm - PRINT_PAPER_HEIGHT_EPSILON_MM}mm` }
      : { minHeight: `${size.heightMm}mm` }),
    padding: `${margin.top}mm ${margin.right}mm ${margin.bottom}mm ${margin.left}mm`,
    "--v2-base-font-size": `${baseFontSize}px`,
    // 表头默认字号按「表头 16 : 正文 13」的既有比例随基础字号缩放（基础字号 13 → 16，外观不变）。
    "--v2-table-header-font-size": `${resolveTableHeaderFontSizeV2(baseFontSize)}px`,
  } as CSSProperties;
}

/**
 * 渲染用物理页列表：
 * - 分页开启（预览/填写/打印）：对每个逻辑页跑分页引擎，得到若干物理页，每页只放得下的节点/网格片段。
 * - 分页关闭（设计态）：每个逻辑页原样作为一页，整页连续渲染（不切分，便于编辑）。
 *
 * 物理页的 `children` 为节点或裁剪了 rows 的 Grid 片段（`FormNodeV2`），可直接喂给 `GridSchemaNode`。
 */
const renderedPages = computed<PhysicalPage[]>(() => {
  const size = paperSize.value;
  if (!props.paginate) {
    return props.schema.pages.map((page, i) => ({
      id: page.id,
      sourcePageId: page.id,
      sourceIndex: i,
      index: i + 1,
      margin: page.margin,
      children: page.children.map((node) => ({ node })),
    }));
  }
  const pages: PhysicalPage[] = [];
  for (const page of props.schema.pages) {
    const bodyHeightMm = size.heightMm - page.margin.top - page.margin.bottom;
    const contentWidthMm = size.widthMm - page.margin.left - page.margin.right;
    const result = paginatePage(page, {
      baseRowHeight: props.schema.baseRowHeight,
      bodyHeightMm,
      contentWidthMm,
      data: props.data ?? null,
    });
    pages.push(...result.pages);
  }
  pages.forEach((p, i) => (p.index = i + 1));
  return pages;
});

/**
 * 自动分页校正（2026-09-03 二十续）：确定性分页按 `row.height × baseRowHeight` 估算行高，
 * 多行字段、换行文本、超大图片等实际渲染高度往往更高，导致「本应换页」的页被判定为放得下、
 * 实际渲染却溢出纸外。这里在浏览器里测量每个 Grid 行的真实渲染高度，用测量结果二次分页，
 * 保证内容超高一律自动换页、永不溢出纸外（设计态与渲染态共用同一通道，因都在本内核内）。
 *
 * 纯测试 / SSR 环境无真实布局 → `offsetHeight` 为 0，测量跳过，
 * 回退到确定性分页（测试即基于此路径，结果稳定可断言）。
 */
const measuredPages = ref<PhysicalPage[] | null>(null);

/**
 * 测量每个 Grid 行的真实渲染高度（mm）。
 * ⚠️ `measureHeightMm` 用 `offsetHeight` 而非 `getBoundingClientRect().height`：
 * 纸张被 `PaperViewport`（panzoom）以 `transform: scale()` 包裹，后者含祖先 transform，
 * 缩放 60% 时 10mm 的行被量成 6mm → 分页引擎判定「放得下」→ 内容溢出纸张却不换页。
 */
function measureRowHeights(): Map<string, number> | null {
  if (typeof document === "undefined") return null;
  const map = new Map<string, number>();
  document
    .querySelectorAll<HTMLElement>(".grid-form-paper .layout-grid__row")
    .forEach((el) => {
      const id = el.dataset.layoutId;
      if (!id) return;
      const h = measureHeightMm(el);
      if (Number.isFinite(h) && h > 0) map.set(id, h);
    });
  return map.size ? map : null;
}

function correctPagination(): void {
  if (!props.paginate || typeof document === "undefined") {
    measuredPages.value = null;
    return;
  }
  const rowHeights = measureRowHeights();
  if (!rowHeights) return;
  const result = paginateSchema(props.schema, {
    data: props.data ?? null,
    measureRow: (row) => {
      const measured = rowHeights.get(row.id);
      if (measured === undefined) return undefined;
      // 行有 `min-height: 行高 × 基准行高`，真实高度必然 ≥ 确定性估算值。取 max 兜底：
      // 即使测量失真（如祖先 transform 缩放），也绝不会算出「比估算还矮」而漏分页。
      return Math.max(measured, gridRowHeightMm(props.schema.baseRowHeight, row));
    },
  });
  measuredPages.value = result.pages;
}

/**
 * 失效旧的测量校正：renderedPages 一旦变化（导入 / 重置 / 大改），**同步**清空 measuredPages，
 * 让本次渲染先落到「确定性分页」版式上，correctPagination 才能测到【新 schema】的真实行高。
 *
 * 否则会出导入分页失效：导入（空白 → 大文档）时 measuredPages 残留上一文档版式，画布先渲染残留版式，
 * correctPagination 测到的是旧 DOM 行高，再用错配的高度表回灌给新 schema → 回退确定性 → 仍 1 页，
 * 新内容堆在一页溢出纸张底部（即「导入后分页没触发」）。
 */
watch(renderedPages, () => { measuredPages.value = null; }, { flush: "sync" });

// 确定性分页结果渲染到 DOM 后，按真实测量高度校正一次（flush:'post' + nextTick 确保已绘制）。
watch(renderedPages, () => nextTick(correctPagination), { flush: "post" });
onMounted(() => nextTick(correctPagination));

/** 最终渲染的物理页：浏览器里经真实高度校正，否则用确定性分页（测试 / SSR 回退）。 */
const displayedPages = computed<PhysicalPage[]>(() => measuredPages.value ?? renderedPages.value);

/**
 * 设计态判定：显式 `mode="design"` 为准；未传 `mode` 时向后兼容 props 文档约定的口径
 * ——有 `data` 视为 preview，否则视为 design。
 */
const isDesignMode = computed(() =>
  props.mode ? props.mode === "design" : props.data == null,
);

/**
 * 是否隐藏「无可见内容」的纸：显式 `blankPageMode` 优先，`"auto"` 时按 {@link isDesignMode}
 * 自动（设计态保留、非设计态隐藏）。
 */
const hideBlankPapers = computed(() => {
  if (props.blankPageMode === "hide") return true;
  if (props.blankPageMode === "keep") return false;
  return !isDesignMode.value;
});

/**
 * 实际出纸的物理页：在 {@link displayedPages} 基础上剔除「渲染后无可打印内容」的纸
 * （判定见 `paper-visibility.ts`）。
 *
 * 场景：分页引擎只按高度切页，会把「无来源图片」或「无边框空 Grid」单独切成一张纸
 * —— 前者 `@media print` 下隐藏、后者没有任何痕迹，打印出来就是一张空白纸。
 *
 * 四个关键约束：
 * 1. **不删任何节点**：判定是 `computed`，依赖 `props.data`。宿主脚本填入数据后，
 *    原本为空的图片列表 / 字段变得有内容，判定自动翻转、纸张自动回来。
 * 2. **设计态不过滤**（`mode === "design"`，由 {@link hideBlankPapers} 在 `"auto"` 下给出）：
 *    画布上每一页都要能点中、能编辑。**注意设计态默认是分页的**（`paginate` 默认 true、
 *    由 Inspector 开关控制），所以这里必须按 `mode` 判定而**不能**按 `paginate` 判定
 *    —— 否则设计画布会把空白页藏掉，且与状态栏「实际会打印几张纸」的计数对不上。
 * 3. **连续编辑视图（`paginate === false`）不过滤**：它本就是「整页不切分」的编辑版式。
 * 4. **兜底**：若全部纸张都被判为空（全空表单），保留原列表 —— 避免「一张纸都不剩」
 *    导致画布空白、打印按钮无反应。
 *
 * 过滤后按新顺序重编 `index`（`{page}` / `{total}` 占位符取的就是它），否则删掉中间的纸
 * 会让页码出现空洞。
 */
const visiblePages = computed<PhysicalPage[]>(() => {
  const all = displayedPages.value;
  if (!props.paginate) return all;
  if (!hideBlankPapers.value) return all;
  const kept = all.filter((pp) => pageHasVisibleContent(pp, props.data));
  if (!kept.length) return all;
  return kept.map((pp, idx) => (pp.index === idx + 1 ? pp : { ...pp, index: idx + 1 }));
});

// ── 页眉 / 页脚（paper 级全局配置，默认随每个物理页重复渲染，含打印）──────────
/**
 * 页眉/页脚是**纸张装饰**，不是 SchemaNode：不参与选中 / 拖拽 / 结构树，只能经
 * Inspector 编辑。因渲染层对每个物理页各画一条带，故天然「每页重复」；
 * `repeatOnEveryPage === false` 时收敛为「仅首页」（见 `bandVisibleOn`）。
 */
/** 仅 `enabled === true` 时渲染（未设即关闭，不静默兜底）。 */
function bandEnabled(band: HeaderFooterV2 | undefined): boolean {
  return band?.enabled === true;
}

/**
 * 该物理页是否应渲染此带：`enabled` 为前提；`repeatOnEveryPage !== false` 时每页都渲染，
 * 否则仅 `pageIdx === 0`（全文档第 1 张物理页）。
 */
function bandVisibleOn(pageIdx: number, band: HeaderFooterV2 | undefined): boolean {
  return bandEnabled(band) && (band?.repeatOnEveryPage !== false || pageIdx === 0);
}

/** 带高（mm）：未设 / 非法回退 `DEFAULT_BAND_HEIGHT_MM`。 */
function bandHeight(band: HeaderFooterV2 | undefined): number {
  const h = band?.height;
  return typeof h === "number" && Number.isFinite(h) && h > 0 ? h : DEFAULT_BAND_HEIGHT_MM;
}

/** 解析占位符：`{page}` 当前物理页序（1-based）、`{total}` 总物理页数。 */
function resolveBandText(text: string | undefined, pp: PhysicalPage, total: number): string {
  if (!text) return "";
  return text.replace(/\{page\}/g, String(pp.index)).replace(/\{total\}/g, String(total));
}

/**
 * 页眉/页脚带样式：驻留上/下边距区（左右受纸张边距约束），带高 / 文本样式 / 分隔线均来自配置。
 *
 * **高度收敛（关键约束）**：页眉/页脚绘制在**页边距留白内**，不占正文区
 * （上边距 = 页眉高度 + 页眉到正文的间距）。配置高度超过对应边距时按边距收敛，
 * 否则带子会伸进正文、与内容重叠且打印被裁切。此处只影响渲染，不改写 schema。
 */
function bandStyle(
  band: HeaderFooterV2 | undefined,
  margin: EdgeInsetsV2,
  position: "top" | "bottom",
): CSSProperties {
  const hasSeparator = band?.separator !== false;
  const color = band?.separatorColor ?? "#111827";
  const width = band?.separatorWidth ?? 1;
  const line = `${width}px solid ${color}`;
  const available = position === "top" ? margin.top : margin.bottom;
  const height = Math.min(bandHeight(band), available);
  return {
    left: `${margin.left}mm`,
    right: `${margin.right}mm`,
    height: `${height}mm`,
    ...(position === "top"
      ? { top: 0, ...(hasSeparator ? { borderBottom: line } : {}) }
      : { bottom: 0, ...(hasSeparator ? { borderTop: line } : {}) }),
    fontSize: band?.style?.fontSize ? `${band.style.fontSize}px` : undefined,
    fontWeight: band?.style?.fontWeight ?? undefined,
    color: band?.style?.color ?? undefined,
  };
}

/**
 * 合并边框抑制：兄弟级去重（相邻外框 Grid 抑制后一个 top）与跨页片段的连续外观抑制。
 * 跨页片段自身的 top/bottom 抑制优先（连续外观），兄弟去重仅补充其未涉及的侧。
 */
function suppressFor(
  pp: PhysicalPage,
  ci: number,
  own?: PhysicalPage["children"][number]["suppressBorders"],
) {
  const sibling = pageSiblingSuppressBorders(pp.children.map((c) => c.node), ci);
  return { ...sibling, ...(own ?? {}) };
}

/** 相邻 Grid 外框去重（Item 2）：页面子节点竖向堆叠，相邻且都绘制外框的 Grid，
 *  抑制后一个 Grid 的上边框（保留前一个的下边框单线）。非 Grid / 非外框节点返回 undefined。 */
function pageSiblingSuppressBorders(children: FormNodeV2[], index: number): { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean } | undefined {
  const node = children[index];
  const draws = node.type === "grid" && (node.border === "all" || node.border === "outer");
  if (!draws) return undefined;
  const prev = children[index - 1];
  const prevBordered = !!prev && prev.type === "grid" && (prev.border === "all" || prev.border === "outer");
  return { top: prevBordered };
}

/**
 * 逻辑页节点的额外属性（`params`）：`params` 一律落到**节点根元素**上，页面的根元素即纸张
 * `<main>`。物理页由逻辑页切分而来，故按 `sourcePageId` 回查逻辑页取属性。
 */
function pageParamAttrs(sourcePageId: string): Record<string, string> {
  const page = props.schema.pages.find((item) => item.id === sourcePageId);
  return resolveNodeParamAttrs(page?.params);
}
</script>

<template>
  <div class="grid-form-canvas" :class="{ 'grid-form-canvas--bare': bare }">
    <main
      v-for="(pp, pageIdx) in visiblePages"
      :key="pp.id"
      class="grid-form-paper"
      :style="paperStyle(pp.margin)"
      :data-node-id="pp.id"
      :data-source-page-id="pp.sourcePageId"
      v-bind="pageParamAttrs(pp.sourcePageId)"
    >
      <div
        v-if="bandVisibleOn(pageIdx, schema.paper.header)"
        class="grid-form-band grid-form-band--header"
        :style="bandStyle(schema.paper.header, pp.margin, 'top')"
      >
        <span class="grid-form-band__zone">{{ resolveBandText(schema.paper.header?.content?.left, pp, visiblePages.length) }}</span>
        <span class="grid-form-band__zone grid-form-band__zone--center">{{ resolveBandText(schema.paper.header?.content?.center, pp, visiblePages.length) }}</span>
        <span class="grid-form-band__zone grid-form-band__zone--right">{{ resolveBandText(schema.paper.header?.content?.right, pp, visiblePages.length) }}</span>
      </div>
      <GridSchemaNode
        v-for="(child, index) in pp.children"
        :key="child.node.id"
        :node="child.node"
        :base-row-height="schema.baseRowHeight"
        :mode="props.mode"
        :data="data"
        :readonly="props.readonly"
        :field-permissions="props.fieldPermissions"
        :suppress-borders="suppressFor(pp, index, child.suppressBorders)"
        @field-change="(field, value) => emit('field-change', field, value)"
        @image-remove="(payload) => emit('image-remove', payload)"
        @sign-remove="(payload) => emit('sign-remove', payload)"
      />
      <div
        v-if="bandVisibleOn(pageIdx, schema.paper.footer)"
        class="grid-form-band grid-form-band--footer"
        :style="bandStyle(schema.paper.footer, pp.margin, 'bottom')"
      >
        <span class="grid-form-band__zone">{{ resolveBandText(schema.paper.footer?.content?.left, pp, visiblePages.length) }}</span>
        <span class="grid-form-band__zone grid-form-band__zone--center">{{ resolveBandText(schema.paper.footer?.content?.center, pp, visiblePages.length) }}</span>
        <span class="grid-form-band__zone grid-form-band__zone--right">{{ resolveBandText(schema.paper.footer?.content?.right, pp, visiblePages.length) }}</span>
      </div>
    </main>
  </div>
</template>

<style scoped>
.grid-form-canvas {
  height: 100%;
  overflow: auto;
  padding: 24px;
  background: #e5e7eb;
  box-sizing: border-box;
}

/* 无外壳模式（G8/G10）：消费页嵌入场景，去掉灰底画布与留白，仅渲染纸张。 */
.grid-form-canvas--bare {
  height: auto;
  padding: 0;
  background: transparent;
  overflow: visible;
}

.grid-form-paper {
  margin: 0 auto 24px;
  background: white;
  box-sizing: border-box;
  box-shadow: 0 4px 12px rgb(15 23 42 / 14%);
}

/* 页眉 / 页脚带：绝对定位于纸张上/下边距区（偏移与高度由内联样式给出，高度已按边距收敛），
   每个物理页各渲染一份，故自动「每页重复」，打印随 `break-after: page` 一同输出。

   左/中/右是**对齐锚点，不是三等分固定区块**：
   - 中列 `auto` = 取自身内容宽度，完整显示（标题再长也不省略），因此**两侧被挤压**；
   - 两侧 `minmax(0, 1fr)` 平分剩余空间，放不下才省略号；
   - 不换行：内容过高/过宽一律由 `overflow:hidden` 裁切（与 Word 一致，不会撑开带子压到正文）。 */
.grid-form-band {
  position: absolute;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  box-sizing: border-box;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.4;
  color: #111827;
}

.grid-form-band__zone {
  min-width: 0;
  white-space: nowrap;
}

/* 两侧是被挤压的一方（放不下才省略）；中间区不做省略，保证标题完整显示。 */
.grid-form-band__zone--left,
.grid-form-band__zone--right {
  overflow: hidden;
  text-overflow: ellipsis;
}

.grid-form-band__zone--center {
  text-align: center;
}

.grid-form-band__zone--right {
  text-align: right;
}

@media print {
  .grid-form-canvas {
    height: auto;
    padding: 0;
    overflow: visible;
    background: white;
  }

  .grid-form-paper {
    margin: 0;
    box-shadow: none;
    break-after: page;
  }

  .grid-form-paper:last-child {
    break-after: auto;
  }
}
</style>
