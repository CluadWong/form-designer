/**
 * Schema V2 分页引擎（DOM 无关、确定性）。
 *
 * 背景：原 `GridFormRenderer` 用纸张 `min-height` 渲染单个逻辑页，内容超高时只是
 * 在单页内继续向下撑开，看不出「超出纸张高度应换页」的效果。本引擎在** Schema 层**
 * 把每个逻辑 `PageSchemaV2` 的内容流切成若干「物理页」——每页只承载能在纸张正文区
 * （纸张高 − 上/下边距）内放下的节点/网格片段，超高部分流向下一页。
 *
 * 为什么在 Schema 层而不是 DOM 测量层：
 * 固定版式表单里 Grid 的每一行高度是确定性值（`row.height × baseRowHeight` mm，
 * cell.rowHeight 可覆盖所在行高），无需渲染后测量即可得到精确行高。因此本引擎对 Grid
 * 做**精确、可测试**的逐行切分；对 Text/Image/Html/Table 这类内容高度不确定的节点，
 * 用启发式估算（并可注入 DOM 测量回调 `measureNode` 提升精度），整块落页或整体换页。
 *
 * 自动分页（2026-09-03 二十续）：纯确定性估算可能误判——多行字段、换行文本、超大图片等
 * 实际渲染高度会高于 `row.height × baseRowHeight` 的估算值，导致引擎认为「放得下」的页
 * 实际却溢出纸张。为此本引擎支持注入**真实测量高度** `measureRow`（逐 Grid 行）与
 * `measureNode`（原子节点），由渲染层在浏览器里测量实际渲染高度后二次校正分页，
 * 保证「内容超高 → 自动换页、永不溢出纸外」（设计态与渲染态共用同一修正通道）。
 * 注意实测值只对「未被切分」的块有效：表格被 `_paginateMaxRows` 裁成续片段后，实测行高仍含
 * 整张表，页面占用必须改按 `fragmentRowHeightMm` 重算（否则已切走的行会被重复计入 → 大片空白）。
 *
 * 旧版 v1 引擎（`src/engine`，基于 DOM 测量 + FormSchema/Component 旧模型）已于
 * 2026-09-02 十八续删除；本文件是全项目**唯一**的分页实现。
 *
 * 切分语义：
 * - Grid 可跨页：按行边界切；首个片段保留上边框、末片段保留下边框，中间片段用
 *   `suppressBorders` 抑制上/下边框，使多页连起来像一张被「拆开」的连续表格。
 * - 行内嵌套 Grid 纵向堆叠表格时（如 1 行网格内嵌 3 行、每行一张表），按嵌套 Grid 的行边界
 *   顺序填充（2026-10-27）；任意行均可切分，同一行多个单元格各有一段表格栈时按行号并行推进；
 *   支持任意深度单链包装（`grid → row → cell → grid → …`），切分发生在叶子层、包装层逐层重建；
 *   续页片段中不参与续接的单元格留空，避免整行被原子化甩页。
 * - Table 跨页切分时，续页片段携带 `_paginateStartRow`（起始数据行号，0-based），渲染层据此
 *   续绘，避免每页都从第 1 行重画导致重复行与字段回填错位。
 * - 其它节点为原子块：当前页放得下就放，放不下（且本页已有内容）就换页；单个节点比整页还高
 *   则强制放入并产出 warning（渲染层 overflow 兜底）。
 *
 * 输出 `PhysicalPage[]` 直接喂给渲染层：每个物理页对应一个 `<main class="grid-form-paper">`
 * ，其 `children` 是要渲染的节点/网格片段（`FormNodeV2`，片段即裁剪了 rows 的 GridNodeV2）。
 */

import type {
  EdgeInsetsV2,
  FieldPNodeV2,
  FormDataV2,
  FormNodeV2,
  FormSchemaV2,
  GridCellV2,
  GridNodeV2,
  GridRowV2,
  ImageItemV2,
  ImageLayoutV2,
  PageSchemaV2,
  ResolvedPaperSizeV2,
} from "@/types";
import { resolveGridGapV2, resolvePaperSizeV2 } from "@/types";
import {
  DEFAULT_TEXT_FONT_SIZE_PX,
  DEFAULT_TEXT_LINE_HEIGHT,
  SIGN_IMAGE_GAP_EM,
  SIGN_IMAGE_LINE_HEIGHT_EM,
  hasImageSourceV2,
  imageItemHeightMm,
  resolveBaseFontSizeV2,
  resolveImageItemsV2,
  resolvePFieldRowsV2,
  resolveSignImageUrlsV2,
  resolveTableHeaderRowCountV2,
  resolveTableRowCount,
} from "@/engine-v2/derivation";

/** 1px（96DPI 下）换算成 mm，用于外框边框占用的高度。 */
const ONE_PX_MM = 1 / (96 / 25.4); // ≈ 0.264583mm

/**
 * 嵌套表格栈的单链分支（2026-10-27）。
 *
 * 一层 = 父行某个单元格里的一个嵌套 Grid；`child` 表示更深一层：
 * - `child === null`：本层为**叶子**，其行内直接含 Table（按行切分的就是这些行）；
 * - `child !== null`：本层是**单链包装**（恰好 1 行，该行恰好 1 个单元格含 Grid），
 *   切分发生在叶子层，包装层按切片逐层重建。
 */
interface NestedStackBranch {
  /** 该层 Grid 所在（父行内的）单元格下标 */
  cellIndex: number;
  /** 该层嵌套 Grid */
  grid: GridNodeV2;
  /** 更深一层；null 表示本层即叶子 */
  child: NestedStackBranch | null;
}

/**
 * 合成物理页 id 的后缀：一个逻辑页切出的第 2..N 张纸用 `${pageId}__pp${序号}`，
 * 首张复用逻辑页 id（保证 1:1 场景下渲染结构与旧版逐字节一致）。
 *
 * 注意：合成 id 在 schema 里查不到，故渲染层必须额外输出 `data-source-page-id`
 * 让设计器能把「点了哪张纸」映射回「哪个逻辑页」（见 `node-address.ts`），
 * 而不是让消费方自己解析这个后缀。
 */
export const PHYSICAL_PAGE_ID_MARK = "__pp";

/**
 * 签名图「与标签等高」的行高倍数（`em`）与「多图间距」的默认值，均已收敛到
 * `derivation.ts`（`SIGN_IMAGE_LINE_HEIGHT_EM` / `SIGN_IMAGE_GAP_EM`）——
 * 与渲染层 `GridSchemaNode.vue` 的 `DEFAULT_SIGN_IMAGE_HEIGHT_V2` / `DEFAULT_SIGN_IMAGE_GAP_V2`
 * 同一真源，避免「分页算高」与「屏幕实际高度」错配。
 */

/** 该 Grid 是否绘制外框（all / outer 才有容器边框）。 */
function drawsOuterFrame(grid: GridNodeV2): boolean {
  return grid.border === "all" || grid.border === "outer";
}

/**
 * 单行高度（mm）。行高 = `max(row.height, 该行任意 cell.rowHeight 覆盖值) × baseRowHeight`，
 * 与 `GridSchemaNode.gridRowStyle` 的 `min-height: row.height * baseRowHeight` 以及
 * cell 的 `min-height: cell.rowHeight * baseRowHeight`（行容器按最高单元格撑开）一致。
 */
export function gridRowHeightMm(
  baseRowHeight: number,
  row: GridRowV2,
  measureRow?: (row: GridRowV2) => number | undefined,
): number {
  // 渲染层注入真实测量高度时优先使用：解决「多行字段 / 换行文本使实际行高高于 row.height 估算」的误判，
  // 让分页按真实渲染高度切分，避免本应换页的页被判定为放得下而溢出纸外。
  if (measureRow) {
    const measured = measureRow(row);
    if (
      typeof measured === "number" &&
      Number.isFinite(measured) &&
      measured > 0
    ) {
      return measured;
    }
  }
  let factor = row.height;
  for (const cell of row.cells) {
    if (
      typeof cell.rowHeight === "number" &&
      Number.isFinite(cell.rowHeight) &&
      cell.rowHeight > factor
    ) {
      factor = cell.rowHeight;
    }
  }
  return factor * baseRowHeight;
}

/**
 * 一段连续 Grid 行的渲染高度（mm），含行间距与（未抑制的）外框上下边框。
 * @param rows 该片段包含的行（连续）
 * @param suppressTop 是否抑制上边框（非首片段时连续外观用）
 * @param suppressBottom 是否抑制下边框（非末片段时连续外观用）
 * @param measureRow 可选逐行真实测量高度（mm），优先级高于确定性估算。
 */
export function gridFragmentHeightMm(
  baseRowHeight: number,
  grid: GridNodeV2,
  rows: GridRowV2[],
  suppressTop: boolean,
  suppressBottom: boolean,
  measureRow?: (row: GridRowV2) => number | undefined,
): number {
  const gap = resolveGridGapV2(grid);
  let h = 0;
  rows.forEach((row, idx) => {
    if (idx > 0) h += gap;
    h += gridRowHeightMm(baseRowHeight, row, measureRow);
  });
  if (drawsOuterFrame(grid)) {
    if (!suppressTop) h += ONE_PX_MM;
    if (!suppressBottom) h += ONE_PX_MM;
  }
  return h;
}

/**
 * Text 节点估算高度（mm）：按内容宽度估算每行字符数，逐段统计行数 × 行高。
 * @param baseFontSize 全局基础字号（px）：节点未显式设 `style.fontSize` 时的字号基准，
 *   与渲染层纸张上的 `--v2-base-font-size` 同源，保证「屏幕多大字、分页按多大字算高」。
 */
function textHeightMm(
  node: Extract<FormNodeV2, { type: "text" }>,
  contentWidthMm: number,
  baseFontSize?: number,
): number {
  const fontSize =
    node.style?.fontSize ?? resolveBaseFontSizeV2({ baseFontSize });
  const lineHeight = node.style?.lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT;
  const lineHeightMm = (fontSize * lineHeight) / (96 / 25.4);
  const avgCharMm = Math.max(0.1, (fontSize * 0.6) / (96 / 25.4));
  const charsPerLine = Math.max(1, Math.floor(contentWidthMm / avgCharMm));
  let lines = 0;
  for (const seg of node.text.split("\n")) {
    lines += Math.max(1, Math.ceil(seg.length / charsPerLine));
  }
  return lines * lineHeightMm;
}

/**
 * 图片列表估算高度（mm）：逐项取高（`height` → `width` 兜底 → 一行基准高，
 * 勾选「显示名称」时叠加名称行高，见 `imageItemHeightMm`），
 * 再按布局折算——垂直 / 填充按「各行累加」上限估（保守，宁可略高），水平按「最高一张」。
 */
function imageListHeightMm(
  items: readonly ImageItemV2[],
  layout: ImageLayoutV2 | undefined,
  baseRowHeight: number,
  showName?: boolean,
): number {
  const heights = items.map((item) =>
    imageItemHeightMm(item, { showName, baseRowHeight }),
  );
  if (heights.length === 0) return 0;
  return layout === "horizontal"
    ? Math.max(...heights)
    : heights.reduce((total, h) => total + h, 0);
}

/**
 * Table 节点估算高度（mm）：表头（`showHeader === false` 或 `_paginateHideHeader` 时不计）
 * + 数据行（minRows 或 data 推导，受 _paginateMaxRows 限制）× baseRowHeight + 外框。
 */
export function tableHeightMm(
  node: Extract<FormNodeV2, { type: "table" }>,
  baseRowHeight: number,
  data: FormDataV2 | null | undefined,
): number {
  const totalRows = resolveTableRowCount(node, data);
  // 分页片段可能限制行数（_paginateMaxRows），高度按实际渲染行数算
  const dataRows =
    typeof node._paginateMaxRows === "number" && node._paginateMaxRows > 0
      ? Math.min(totalRows, node._paginateMaxRows)
      : totalRows;
  // 表头行数：`showHeader === false` / 续页隐藏片段 → 0；复合表头 → N 行（缺省 1 行）。
  // 与渲染层共用 `resolveTableHeaderRowCountV2`，保证「算几行 = 画几行」。
  const headerRows = resolveTableHeaderRowCountV2(node);
  let h = (headerRows + dataRows) * baseRowHeight;
  if (node.border === "all" || node.border === "outer") h += 2 * ONE_PX_MM;
  // 逐行分隔线（2026-10-22「33 行表格压到页脚」）：`border` 为 all / inner 时，渲染层给
  // **除末行外的每一行**画 1px 下边框（`.layout-table--all .layout-table__row:not(:last-child)`）。
  // 表头 + N 个数据行共 N+1 行 → 分隔线 N 条 → 总高要多 N × 1px；
  // 隐藏表头后只剩 N 个数据行 → 分隔线 N−1 条。
  // 漏算这 N 条的后果：N=30 少 7.94mm、N=33 少 8.73mm（真机实测差值 7.92 / 8.71），
  // 于是「算着放得下、实际压进页脚边距」。
  if (node.border === "all" || node.border === "inner")
    h += Math.max(0, headerRows + dataRows - 1) * ONE_PX_MM;
  return h;
}

/**
 * CSS 长度 → mm（仅认 mm / cm / px）。
 * 其它单位（em / % / 无单位）依赖字号与容器宽度，无法在此可靠换算 → 返回 null，
 * 由调用方回落默认估算（宁可保守，也不要算出一个错误的页高）。
 */
function cssLengthToMm(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^([\d.]+)\s*(mm|cm|px)$/.exec(value.trim());
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (match[2] === "mm") return n;
  if (match[2] === "cm") return n * 10;
  return n * ONE_PX_MM;
}

/** 单个原子节点（非 Grid）的估算高度（mm）。 */
function atomicNodeHeightMm(node: FormNodeV2, ctx: PaginateContext): number {
  if (ctx.measureNode) {
    const measured = ctx.measureNode(node);
    if (typeof measured === "number" && Number.isFinite(measured))
      return measured;
  }
  switch (node.type) {
    case "grid":
      // 整 Grid 高度（无抑制边框）
      return gridFragmentHeightMm(
        ctx.baseRowHeight,
        node,
        node.rows,
        false,
        false,
        ctx.measureRow,
      );
    case "image": {
      // 与渲染层同口径（`resolveImageItemsV2`）：整块列表都没有来源时，屏幕上是占位灰框、
      // **打印时不占版面**，故此处按 0 高度计——否则会算出一张实际不存在内容的物理页（打印多出空白纸）。
      const items = resolveImageItemsV2(node, { data: ctx.data });
      return hasImageSourceV2(items)
        ? imageListHeightMm(
            items,
            node.layout,
            ctx.baseRowHeight,
            node.showName === true,
          )
        : 0;
    }
    case "text":
      return textHeightMm(node, ctx.contentWidthMm, ctx.baseFontSize);
    case "table":
      return tableHeightMm(node, ctx.baseRowHeight, ctx.data);
    case "html":
      // Html 内容高度不可知，按一行基准高估算并提示（可注入 measureNode 提升精度）
      return ctx.baseRowHeight;
    case "p": {
      // 字段 P 在 Grid 外通常占一行；按基准行高估算。
      // 例外：图片值字段（电子签名，`valueType === "image"`）——签名图会撑高行盒，
      // 按其高度估算，避免低估导致签名栏被挤到下一页。高度口径与渲染层同源：
      //   ① 配了 `imageHeight` 用它（em / % 等依赖字号、容器宽度的单位无法在此换算 → null，
      //      此时回落到 ②）；
      //   ② 否则用「与标签等高」的 1.6em——跟随全局基础字号，故按字号换算成 mm
      //      （见渲染层 `DEFAULT_SIGN_IMAGE_HEIGHT_V2`；13px → 5.5mm、16px → 6.77mm）。
      //
      // 多人签名（2026-09-30）：多张签名图**自动换行**，而行数在设计期算不出——图宽是
      // 「按自身比例 + max-width:100%」，没有固定宽度就推不出每行能放几张。故取**保守上界**：
      // 每张独占一行，总高 = N × 图高 + (N-1) × 间距。偏高只会让分页提前（留白），
      // 偏低则会溢出纸外，二者取前者。
      // 空态（N = 0）与单张（N = 1）都按一行算 —— 空态也要占住 `imageHeight`
      // （`min-height` 兜底），否则「未签名 / 已签名」两态的下划线位置会不一致。
      // 注：Grid 内的行由渲染层 `measureRow` 实测真实高度二次校正，不依赖此处估算；
      // 本分支只覆盖 Grid 外的裸 p 节点。
      const isSignImage = node.mode === "field" && node.valueType === "image";
      const fontMm =
        resolveBaseFontSizeV2({ baseFontSize: ctx.baseFontSize }) * ONE_PX_MM;
      // 内部边框 + 图片值（2026-10-21 线与图共存）：行盒由「占位行数 × 行高」决定，
      // 图压在最后一行内、不额外占行 —— 末行取 max(行高, 图高)，其余行就是行高。
      // 行数取自 `resolvePFieldRowsV2`（与渲染层同一个解析器；2026-10-27 起它还并入了
      // 「初始行数」配置），故「屏幕 3 行 / 分页 1 行」这种高度错配不会发生。
      // 注意与下面的「每张独占一行」口径互斥，必须先判。
      if (isSignImage && node.innerBorder) {
        const lineMm = SIGN_IMAGE_LINE_HEIGHT_EM * fontMm;
        const imageMm = cssLengthToMm(node.imageHeight) ?? lineMm;
        const lines = resolvePFieldRowsV2(node);
        return Math.max(
          ctx.baseRowHeight,
          (lines - 1) * lineMm + Math.max(lineMm, imageMm),
        );
      }
      const rows = isSignImage ? Math.max(1, signImageRowCount(node, ctx)) : 0;
      if (rows === 0) {
        // 文本字段（2026-10-27）：「初始行数」= **最小行数**，Grid 外的裸 p 必须按 N 行估高，
        // 否则「估 1 行 / 实际 3 行」会把内容顶出纸外。行高与渲染层同源
        // （`min-height: calc(N * 1.6em)`，`1.6` = `DEFAULT_TEXT_LINE_HEIGHT`），
        // 字号取节点自身的 `style.fontSize`（`.layout-p` 的 em 基准就是它），缺省回落到全局基础字号。
        // Grid 内的 p 由 `measureRow` 实测真实行高，不依赖此估算（见 `gridRowHeightMm`）。
        const textRows = resolvePFieldRowsV2(node);
        if (textRows <= 1) return ctx.baseRowHeight;
        const fontPx =
          node.style?.fontSize && node.style.fontSize > 0
            ? node.style.fontSize
            : resolveBaseFontSizeV2({ baseFontSize: ctx.baseFontSize });
        const lineMm = DEFAULT_TEXT_LINE_HEIGHT * fontPx * ONE_PX_MM;
        return Math.max(ctx.baseRowHeight, textRows * lineMm);
      }
      const imageMm =
        cssLengthToMm(node.imageHeight) ?? SIGN_IMAGE_LINE_HEIGHT_EM * fontMm;
      const gapMm = cssLengthToMm(node.gap) ?? SIGN_IMAGE_GAP_EM * fontMm;
      return Math.max(ctx.baseRowHeight, rows * imageMm + (rows - 1) * gapMm);
    }
  }
}

/**
 * 签名图**估算行数**（保守上界 = 图片张数，即每张独占一行）。
 *
 * 张数取自 `data`，取值与兜底规则和渲染层 `signImageUrls` 一致（`data` 无该键 / 值为 `null`
 * 时回落节点 `default`，并按 `maxCount` 截断），否则「带默认值的签名栏」会出现
 * 渲染与分页两套口径。
 */
function signImageRowCount(node: FieldPNodeV2, ctx: PaginateContext): number {
  const inData = ctx.data != null && node.field in ctx.data;
  const raw = inData ? (ctx.data?.[node.field] ?? node.default) : node.default;
  return resolveSignImageUrlsV2(raw, node.maxCount).length;
}

/**
 * 深度收集节点树里的 Table（含嵌套 Grid 内的）——
 * 分页切表时 `mapTablesInNodeTree` 会递归写 `_paginateMaxRows`，故统计也必须递归。
 */
function collectTablesDeep(
  nodes: readonly FormNodeV2[],
): Extract<FormNodeV2, { type: "table" }>[] {
  const out: Extract<FormNodeV2, { type: "table" }>[] = [];
  for (const node of nodes) {
    if (node.type === "table") {
      out.push(node);
    } else if (node.type === "grid") {
      for (const row of node.rows) {
        for (const cell of row.cells) {
          out.push(...collectTablesDeep(cell.children));
        }
      }
    }
  }
  return out;
}

/**
 * Grid 片段中**单行**的渲染高度（mm），按该行「实际会渲染成什么」计算。
 *
 * 为什么不能直接用 `measureRow`：实测回调按 `row.id` 返回的是**整行**渲染高度，而行内的
 * Table 在跨页切分时会被 `_paginateMaxRows` 裁到只剩几行 —— 此时实测值里仍然含**整张表**。
 * 直接拿它累加 `curUsed` 等于把已切到下一页的行又算了一遍，后续块被误判「放不下」而被推页。
 *
 * 用户实报（2026-10-23，`docs/云铝1类` 同类模板）：12 行表切到第 2 页的续片段只渲染 1 行
 * （实测 16.7mm），却被记成 107.7mm；紧接着的 5 行表因此只剩 28mm 预算、只分到 2 行，
 * 第 2 页尾部空出 90.8mm，本该 3 页的模板被切成 4 页。
 *
 * 口径：`表以外的高度 + 裁切后的表高`，其中「表以外」= max(0, 实测整行高 − 整表高)，
 * 与 `splitGrid` 里算 `rowExtrasH` 的口径一致。**无实测值**（纯确定性 / 测试 / SSR）时
 * 一律回落到确定性估算，保持既有分页结果逐字节不变。
 */
function fragmentRowHeightMm(
  baseRowHeight: number,
  row: GridRowV2,
  ctx: PaginateContext,
): number {
  const estimatedH = gridRowHeightMm(baseRowHeight, row);
  const rawMeasured = ctx.measureRow?.(row);
  const measuredH =
    typeof rawMeasured === "number" &&
    Number.isFinite(rawMeasured) &&
    rawMeasured > 0
      ? Math.max(rawMeasured, estimatedH)
      : undefined;
  if (measuredH === undefined) return estimatedH;

  const tables = collectTablesDeep(row.cells.flatMap((cell) => cell.children));
  if (tables.length === 0) return measuredH;
  const hasCutTable = tables.some(
    (t) => typeof t._paginateMaxRows === "number",
  );
  if (!hasCutTable) return measuredH;

  const cutH = tables.reduce(
    (sum, t) => sum + tableHeightMm(t, baseRowHeight, ctx.data),
    0,
  );
  const fullH = tables.reduce(
    (sum, t) =>
      sum +
      tableHeightMm(
        { ...t, _paginateMaxRows: undefined },
        baseRowHeight,
        ctx.data,
      ),
    0,
  );
  const nonTableH = Math.max(0, measuredH - fullH);
  return Math.max(estimatedH, nonTableH + cutH);
}

/**
 * 物理页内一个子项的渲染高度（mm）——即「这块实际会占多高」。
 *
 * 与 {@link atomicNodeHeightMm} 的唯一差别：Grid 片段改用 {@link fragmentRowHeightMm} 逐行
 * 计算，避免把已经被 `_paginateMaxRows` 裁走的表行重复计入页面占用。
 */
function pageChildHeightMm(
  child: PhysicalPageChild,
  ctx: PaginateContext,
): number {
  const node = child.node;
  if (node.type !== "grid") return atomicNodeHeightMm(node, ctx);
  return gridFragmentHeightMm(
    ctx.baseRowHeight,
    node,
    node.rows,
    false,
    false,
    (row) => fragmentRowHeightMm(ctx.baseRowHeight, row, ctx),
  );
}

/**
 * 单元格内容的估算高度（mm）：单元格内子节点按块级纵向堆叠，故逐项累加。
 *
 * 仅用于「没有 DOM 实测值」的确定性兜底（测试 / SSR / 首轮分页）——
 * 浏览器里由 `measureRow` 直接给出真实行高，不走本函数。
 */
function cellContentHeightMm(cell: GridCellV2, ctx: PaginateContext): number {
  let h = 0;
  for (const child of cell.children) {
    if (child.type === "grid") {
      h += nestedGridHeightMm(child, ctx);
    } else {
      h += atomicNodeHeightMm(child, ctx);
    }
  }
  return h;
}

/**
 * 嵌套 Grid 指定行序列的渲染高度（mm）。
 *
 * 与 {@link gridFragmentHeightMm} 的差别：行高优先取该嵌套行自身的 `measureRow`
 * （渲染层会测量纸张内**所有** `.layout-grid__row`，含嵌套行，见 `GridFormRenderer`），
 * 无实测值时按「行 min-height 与单元格内容估算的较大者」兜底。
 *
 * @param nested 嵌套 Grid 节点
 * @param ctx 分页上下文
 * @param rows 要计入的行序列（缺省为全部行；切分片段只传本页包含的行）
 */
function nestedGridHeightMm(
  nested: GridNodeV2,
  ctx: PaginateContext,
  rows: readonly GridRowV2[] = nested.rows,
): number {
  const gap = resolveGridGapV2(nested);
  let h = 0;
  rows.forEach((row, idx) => {
    if (idx > 0) h += gap;
    h += nestedRowHeightMm(row, ctx);
  });
  // 嵌套 Grid 自身的外框（all / outer）；片段不做上下边框抑制，按完整外框计。
  // 空切片（该栈本页无剩余行）不计外框，避免续页凭空多出 0.5mm。
  if (rows.length > 0 && drawsOuterFrame(nested)) h += 2 * ONE_PX_MM;
  return h;
}

/**
 * 嵌套 Grid 单行的渲染高度（mm）：实测值优先，否则回落到确定性估算。
 *
 * 确定性估算取 `max(行 min-height, 各单元格内容估算的最大值)` ——
 * 单元格内的表格 / 更深层嵌套网格都会参与，避免把「一行内塞了 3 张表」当成 8mm。
 */
function nestedRowHeightMm(row: GridRowV2, ctx: PaginateContext): number {
  const estimated = gridRowHeightMm(ctx.baseRowHeight, row);
  const measured = ctx.measureRow?.(row);
  if (
    typeof measured === "number" &&
    Number.isFinite(measured) &&
    measured > 0
  ) {
    return Math.max(measured, estimated);
  }
  const cellMax = row.cells.reduce(
    (max, cell) => Math.max(max, cellContentHeightMm(cell, ctx)),
    0,
  );
  return Math.max(estimated, cellMax);
}

/** 分页上下文（高度计算所需的一切）。 */
export interface PaginateContext {
  /** 表单基准行高（mm）。 */
  baseRowHeight: number;
  /**
   * 全局基础字号（px）：用于 Text 高度估算的字号基准（未显式设 `style.fontSize` 时）。
   * 与渲染层纸张上的 `--v2-base-font-size` 同源（都由 `resolveBaseFontSizeV2` 解出）。
   * 缺省 / 非法 → 引擎默认 13。
   */
  baseFontSize?: number;
  /** 正文内容区宽度（mm）= 纸张宽 − 左/右边距，用于 Text 折行估算。 */
  contentWidthMm: number;
  /** 正文可用高（mm）= 纸张高 − 上/下边距。 */
  bodyHeightMm: number;
  /** 填写数据（Table 行数推导用），缺省为 null。 */
  data?: FormDataV2 | null;
  /** 可选 DOM 测量回调：返回节点精确高度（mm）或 undefined 走启发式。 */
  measureNode?: (node: FormNodeV2) => number | undefined;
  /** 可选逐 Grid 行测量回调：返回该行真实渲染高度（mm）或 undefined 走确定性估算。
   *  用于自动分页——真实行高（多行字段/换行文本）高于估算值时，按真实高度切分，避免溢出纸外。 */
  measureRow?: (row: GridRowV2) => number | undefined;
}

/** 物理页中的一个子项（节点，或裁剪了 rows 的 Grid 片段）。 */
export interface PhysicalPageChild {
  node: FormNodeV2;
  /** 该片段需抑制的边框侧（Grid 跨页连续外观用）。 */
  suppressBorders?: {
    top?: boolean;
    right?: boolean;
    bottom?: boolean;
    left?: boolean;
  };
}

/** 一个物理页（对应渲染层一个 `<main class="grid-form-paper">`）。 */
export interface PhysicalPage {
  /** 物理页稳定 id（基于来源逻辑页 id + 序号）。 */
  id: string;
  /** 来源逻辑页 id。 */
  sourcePageId: string;
  /** 在来源逻辑页内的序号（0-based）。 */
  sourceIndex: number;
  /** 整篇文档内的全局物理页序号（1-based，由 paginateSchema 回填）。 */
  index: number;
  /** 该物理页使用的页边距（等于来源逻辑页边距）。 */
  margin: EdgeInsetsV2;
  /** 需渲染的节点/片段。 */
  children: PhysicalPageChild[];
}

/** 分页告警（内容超高被裁剪等）。 */
export interface PaginateWarning {
  nodeId: string;
  message: string;
}

/** 分页结果。 */
export interface PaginateResult {
  pages: PhysicalPage[];
  warnings: PaginateWarning[];
}

/**
 * 分页单个逻辑页，得到 0..N 个物理页。
 * @param page 逻辑页
 * @param opts 分页上下文
 */
export function paginatePage(
  page: PageSchemaV2,
  opts: PaginateContext,
): PaginateResult {
  const warnings: PaginateWarning[] = [];
  const bodyH = Math.max(1, opts.bodyHeightMm);
  const pages: PhysicalPage[] = [];

  // 当前正在构建的物理页（用闭包变量持有，避免对象引用重赋值陷阱）
  let curChildren: PhysicalPageChild[] = [];
  let curUsed = 0;

  const flush = (): void => {
    if (curChildren.length > 0) {
      // 首个物理页复用逻辑页 id（保证 1:1 场景下与旧渲染结构逐字节一致，兼容快照/选择）；
      // 后续片段用合成 id，避免与首个或下一逻辑页冲突。
      const isFirstPhysical = pages.length === 0;
      pages.push({
        id: isFirstPhysical
          ? page.id
          : `${page.id}${PHYSICAL_PAGE_ID_MARK}${pages.length}`,
        sourcePageId: page.id,
        sourceIndex: pages.length,
        index: 0,
        margin: page.margin,
        children: curChildren,
      });
      curChildren = [];
      curUsed = 0;
    }
  };

  /** 当前页能否放下高度 h 的块（空页时只要 h≤bodyH 即可）。 */
  const fits = (h: number): boolean => curUsed + h <= bodyH + 1e-6;

  /**
   * 放入一个子项并累加页内已用高度。
   * @param child 子项（节点或片段）
   * @param heightMm 可选：引擎已算好的片段高度（mm）。嵌套切分片段的实测行高已含整段嵌套内容，
   *   不能再用 `pageChildHeightMm` 复算（会把已切走的行重复计入），故由调用方直接给出。
   */
  const push = (child: PhysicalPageChild, heightMm?: number): void => {
    curChildren.push(child);
    curUsed += heightMm ?? pageChildHeightMm(child, opts);
  };

  const paginateAtomic = (node: FormNodeV2): void => {
    const h = atomicNodeHeightMm(node, opts);
    if (!fits(h)) {
      flush();
      if (!fits(h)) {
        warnings.push({
          nodeId: node.id,
          message: `节点（${node.type}）高度约 ${h.toFixed(1)}mm 超过单页可用高 ${bodyH.toFixed(1)}mm，已溢出裁剪`,
        });
      }
    }
    push({ node });
  };

  const paginateGrid = (grid: GridNodeV2): void => {
    const fullH = gridFragmentHeightMm(
      opts.baseRowHeight,
      grid,
      grid.rows,
      false,
      false,
      opts.measureRow,
    );
    // 额外检查：cell 内的 Table 可能使实际高度远超行高估算（2026-09-03 廿一续）。
    // 例如 Grid(1行×8mm) 内含 Table(50数据行×8mm=400mm)，确定性估算只有 8mm 但实际 400+mm。
    // 此时必须走 splitGrid（即使行高估算「放得下」），由 splitGrid 内部检测到 Table 并按数据行切分。
    let hasTallTables = false;
    for (const row of grid.rows) {
      for (const cell of row.cells) {
        for (const child of cell.children) {
          if (child.type === "table") {
            const tableH = tableHeightMm(child, opts.baseRowHeight, opts.data);
            if (tableH > opts.bodyHeightMm * 0.8) {
              // Table 高度超过正文区 80% → 视为「超高」
              hasTallTables = true;
              break;
            }
          }
        }
        if (hasTallTables) break;
      }
      if (hasTallTables) break;
    }

    // 整 Grid 能放进当前页剩余空间 且无超高Table → 直接放
    if (fits(fullH) && !hasTallTables) {
      push({ node: grid });
      return;
    }
    // ★ 短网格（整格高度 ≤ 单页可用高）且当前页已放不下 → 整格移到下一页，不逐行拆碎。
    //   否则 splitGrid 会逐行填满当前页剩余空间、再在片段之间无条件 flush，把一个本可整页
    //   放下的短网格拆成「首行留在页尾 / 余行被甩到更后一页」的断裂外观（分页异常）。
    //   只有整格高于一页（fullH > bodyH）或含超高 Table 时，才需要跨页逐行切分。
    if (!hasTallTables && fullH <= bodyH + 1e-6) {
      // 例外：网格「末行内 Table」不得整格甩到下一页（2026-10-22 用户实报）——表可按数据行
      // 切分，本页剩余空间若能装下「表头 + 若干数据行」，就该让 splitGrid 的 Table 切分路径
      // 用它填满本页、余行流转下一页。否则会出现「行数临界：9 行刚好填满第一页、10 行整表
      // 跳到第二页」的断裂。普通短网格（无 Table）仍整格移走保持外观完整。
      const lastRow = grid.rows[grid.rows.length - 1];
      // 例外二（2026-10-27）：末行内是「嵌套网格里纵向堆叠的表格」（如本模板的 1 行网格内嵌
      // 3 行网格、每行一张表）时，检测必须递归 —— 表格比 `cell.children` 深一层，浅扫描看不到，
      // 整格会被甩到下一页。转 splitGrid 由嵌套行切分路径填满本页。
      if (
        collectTablesInRow(lastRow).length > 0 ||
        nestedTableStacksOfRow(lastRow) !== null
      ) {
        splitGrid(grid);
        return;
      }
      if (curChildren.length > 0) flush();
      push({ node: grid });
      return;
    }
    // 整格高于一页 / 含超高Table → 跨页逐行切分：首个片段先填满当前页剩余空间，余下行流转到后续物理页。
    // （即便当前页已有内容，也优先把能塞下的前几行留在当前页，避免长网格被整体推到下一页而留白。）
    splitGrid(grid);
  };

  /**
   * Table 按数据行跨页切分（2026-09-03 廿一续）。
   *
   * 与 Grid 的 splitGrid 对称：Table 的每一数据行高度均为 baseRowHeight（均匀），
   * 表头固定 1 行（仅首片段保留）。当整 Table 放不下当前页时，按数据行边界切分为
   * 多个片段，每个片段是一个带 `_paginateMaxRows` 限制的 Table 副本。
   *
   * 切分语义：
   * - 首片段：表头(1行) + 数据行 1..N
   * - 后续片段：仅数据行 N+1..M（不重复表头；需要时后续可加表头重复选项）
   * - 单数据行比可用高还高 → 强制放入并告警（与 Grid 单行超高处理一致）
   */
  const paginateTable = (
    table: Extract<FormNodeV2, { type: "table" }>,
  ): void => {
    const totalDataRows = resolveTableRowCount(table, opts.data);
    // 逐行分隔线（与 `tableHeightMm` 同口径）：border all / inner 时表头 + N 数据行共 N 条 1px 下边框，
    // 末行没有 —— 所以每条数据行分摊 1px，表头不另计。
    const hasRowLines = table.border === "all" || table.border === "inner";
    const rowH = opts.baseRowHeight + (hasRowLines ? ONE_PX_MM : 0); // 每数据行高度（含其分隔线）
    // 表头高度：复合表头按 N 行预留（缺省 1 行）；没有表头时 0。
    const headerH = resolveTableHeaderRowCountV2(table) * opts.baseRowHeight;
    const bordered = table.border === "all" || table.border === "outer";
    const borderH = bordered ? ONE_PX_MM : 0;

    // 整 Table 高度 = 表头 + 全部数据行 + 外框
    const fullH = headerH + totalDataRows * rowH + (bordered ? 2 * borderH : 0);

    // 整 Table 放得下 → 直接作为原子块放入（不走切分）
    if (fits(fullH)) {
      push({ node: table });
      return;
    }

    // 放不下 → 按数据行逐行切分
    // 跨页表头重复（2026-10-22）：`repeatHeaderOnBreak` 缺省为 true，续页片段也渲染表头，
    // 故每个片段都要预留表头高度；为 false 时仅首片段渲染表头，续页片段写 `_paginateHideHeader`
    // 隐藏表头（渲染层跳过 thead），且不再预留表头高度。
    const repeatHeader = table.repeatHeaderOnBreak !== false;
    let remainingRows = totalDataRows;
    let startRow = 0; // 当前片段起始数据行号（0-based）
    let isFirstFragment = true;

    while (remainingRows > 0) {
      const avail = bodyH - curUsed;

      // 当前片段可用的数据行高度预算（扣去表头/边框占用；重复表头时每个片段都扣表头）
      const reserveHeader =
        repeatHeader || isFirstFragment ? headerH + borderH : borderH;
      const budgetForRows = Math.max(0, avail - reserveHeader);

      // 本片段能放的数据行数
      let rowsInFragment =
        budgetForRows > 0 ? Math.floor(budgetForRows / rowH) : 0;

      // 至少放 1 行数据（即使超出可用高——与 Grid 单行强制放入一致）
      if (rowsInFragment === 0 && remainingRows > 0) {
        rowsInFragment = 1;
        // 如果本页已有内容且连 1 行都放不下 → 先换页
        if (curChildren.length > 0 && reserveHeader + rowH > avail + 1e-6) {
          flush();
          // 换页后重新计算（新页面有完整可用高度）
          continue;
        }
      }

      // 取实际行数（不超过剩余行数）
      rowsInFragment = Math.min(rowsInFragment, remainingRows);

      // 本片段是否为末片段
      const isLastFragment = startRow + rowsInFragment >= totalDataRows;

      // 构建片段 Table 节点（携带 _paginateMaxRows 限制渲染行数、_paginateStartRow 指定
      // 本次从第几行开始渲染；不重复表头时，续页片段加 _paginateHideHeader 让渲染层隐藏表头）
      const fragmentNode: Extract<FormNodeV2, { type: "table" }> = {
        ...table,
        _paginateMaxRows: rowsInFragment,
        _paginateStartRow: startRow,
        ...(isFirstFragment || repeatHeader
          ? {}
          : { _paginateHideHeader: true }),
      };

      push({
        node: fragmentNode,
        suppressBorders: {
          top: !isFirstFragment, // 后续片段抑制上外框（连续外观）
          bottom: !isLastFragment, // 非末片段抑制下外框
        },
      });

      remainingRows -= rowsInFragment;
      startRow += rowsInFragment;
      isFirstFragment = false;

      // 还有剩余行 → 先 flush 再继续
      if (remainingRows > 0) flush();
    }
  };

  /**
   * 从 Grid 行的所有 cell 子节点中收集 Table 节点（2026-09-03 廿一续）。
   * 用于检测单行超高是否由内部 Table 引起，从而触发 Table 级别的跨页切分。
   */
  function collectTablesInRow(
    row: GridRowV2,
  ): Extract<FormNodeV2, { type: "table" }>[] {
    const tables: Extract<FormNodeV2, { type: "table" }>[] = [];
    for (const cell of row.cells) {
      for (const child of cell.children) {
        if (child.type === "table") tables.push(child);
      }
    }
    return tables;
  }

  /** 该行是否有「直接挂在 cell 下」的 Table（该形态归既有 Table 切分路径，不抢）。 */
  function rowHasDirectTable(row: GridRowV2): boolean {
    return row.cells.some((cell) =>
      cell.children.some((child) => child.type === "table"),
    );
  }

  /**
   * 在单元格列表里找「唯一的嵌套 Grid」（2026-10-27 更深层嵌套）。
   *
   * 返回 null 的情形：某单元格直接含 Table（归 Table 切分路径）、没有 Grid、
   * 或同一行有多个 Grid（无法单链下降）。
   *
   * @param cells 行内单元格
   * @returns 唯一嵌套 Grid 及其单元格下标
   */
  function singleGridCell(
    cells: readonly GridCellV2[],
  ): { cellIndex: number; grid: GridNodeV2 } | null {
    let found: { cellIndex: number; grid: GridNodeV2 } | null = null;
    for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
      for (const child of cells[cellIndex].children) {
        if (child.type === "table") return null;
        if (child.type === "grid") {
          if (found) return null;
          found = { cellIndex, grid: child };
        }
      }
    }
    return found;
  }

  /**
   * 把「单元格 → 嵌套 Grid」解析为一条单链分支（2026-10-27 更深层嵌套）。
   *
   * 叶子条件：该 Grid 至少有一行的 cell 里直接含 Table（切分发生在这些行上）。
   * 否则按「单链包装」下降：该 Grid 恰好 1 行，且该行恰好 1 个单元格含 Grid
   * （其余单元格视为装饰，只在行内容首片段显示）。任何一层不满足 → 返回 null，
   * 该行不按嵌套栈切分（沿用原有整行逻辑）。
   *
   * @param cellIndex 该 Grid 在父行内的单元格下标
   * @param grid 待解析的嵌套 Grid
   * @returns 单链分支；不满足条件时返回 null
   */
  function resolveStackBranch(
    cellIndex: number,
    grid: GridNodeV2,
  ): NestedStackBranch | null {
    if (grid.rows.some((row) => rowHasDirectTable(row))) {
      return { cellIndex, grid, child: null };
    }
    if (grid.rows.length !== 1) return null;
    const inner = singleGridCell(grid.rows[0].cells);
    if (!inner) return null;
    const child = resolveStackBranch(inner.cellIndex, inner.grid);
    if (!child) return null;
    return { cellIndex, grid, child };
  }

  /**
   * 识别一行内的「嵌套表格栈」（2026-10-27，支持任意深度单链包装）。
   *
   * 判定条件（全部满足）：
   * - 行内**没有**直接挂在 cell 下的 Table；
   * - 至少有一个直接嵌套 Grid，且每个都能沿「单行单 Grid」链下降到「行内含 Table」的叶子层；
   * - 各嵌套 Grid 位于**不同单元格**（并排多栈按行号并行切分；同一格内多个网格交给原有逻辑）。
   *
   * 典型形态：
   * - `row → cell → grid(3 行) → row → cell → table`（本模板的「安全措施」块）；
   * - 一行多个单元格各放一段表格栈的双栏版式；
   * - `row → cell → grid(1 行) → row → cell → grid(N 行) → … → table`（多一层分区容器）。
   *
   * @param row 外层 Grid 行
   * @returns 栈分支列表；不满足条件时返回 `null`，调用方沿用原有逻辑
   */
  function nestedTableStacksOfRow(row: GridRowV2): NestedStackBranch[] | null {
    if (rowHasDirectTable(row)) return null;
    const grids: Array<{ cellIndex: number; grid: GridNodeV2 }> = [];
    for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex += 1) {
      for (const child of row.cells[cellIndex].children) {
        if (child.type === "grid") grids.push({ cellIndex, grid: child });
      }
    }
    if (grids.length === 0) return null;
    // 同一单元格内的多个嵌套 Grid 无法按行号对齐切分 → 不接管
    if (new Set(grids.map((entry) => entry.cellIndex)).size !== grids.length) {
      return null;
    }
    const branches: NestedStackBranch[] = [];
    for (const entry of grids) {
      const branch = resolveStackBranch(entry.cellIndex, entry.grid);
      if (!branch) return null;
      branches.push(branch);
    }
    return branches;
  }

  /** 取嵌套栈的叶子 Grid（行内直接含 Table 的最深一层）。 */
  function leafGridOf(branch: NestedStackBranch): GridNodeV2 {
    let current = branch;
    while (current.child) current = current.child;
    return current.grid;
  }

  /**
   * 按叶子行切片重建一条嵌套栈（2026-10-27 更深层嵌套）。
   *
   * 包装层（单行单 Grid）逐层重建：含子链的单元格替换为重建后的子链，其余装饰单元格
   * 只在**行内容首片段**保留，续页片段留空（避免每页重复标题/标签）。
   *
   * @param branch 待重建的栈分支
   * @param leafSlice 本片段包含的叶子 Grid 行
   * @param keepDecorations 是否保留包装层的装饰单元格（仅行内容首片段）
   * @returns 重建后的该层 Grid 节点
   */
  function rebuildBranch(
    branch: NestedStackBranch,
    leafSlice: GridRowV2[],
    keepDecorations: boolean,
  ): GridNodeV2 {
    if (branch.child === null) {
      return { ...branch.grid, rows: leafSlice };
    }
    const child = branch.child;
    const wrapperRow = branch.grid.rows[0];
    const cells = wrapperRow.cells.map((cell, cellIndex) => {
      if (cellIndex === child.cellIndex) {
        return {
          ...cell,
          children: cell.children.map((node) =>
            node === child.grid
              ? rebuildBranch(child, leafSlice, keepDecorations)
              : node,
          ),
        };
      }
      return keepDecorations ? cell : { ...cell, children: [] };
    });
    return { ...branch.grid, rows: [{ ...wrapperRow, cells }] };
  }

  /**
   * 一条嵌套栈在「叶子行切片」下的渲染高度（mm）。
   *
   * 包装层不能直接用实测行高：实测值含**整条子链**，切片后会重复计入（同
   * `fragmentRowHeightMm` 的问题）。故包装层取「行 min-height、装饰高度、子链片段高度」
   * 的最大值再加自身外框；装饰高度 = 实测行高 − 子链完整高，且只在行内容首片段计入。
   *
   * @param branch 栈分支
   * @param leafSlice 本片段包含的叶子行
   * @param keepDecorations 是否计入包装层装饰（仅行内容首片段）
   */
  function chainSliceHeightMm(
    branch: NestedStackBranch,
    leafSlice: GridRowV2[],
    keepDecorations: boolean,
  ): number {
    if (branch.child === null) {
      return nestedGridHeightMm(branch.grid, opts, leafSlice);
    }
    const child = branch.child;
    const childH = chainSliceHeightMm(child, leafSlice, keepDecorations);
    const wrapperRow = branch.grid.rows[0];
    const measuredWrapperH = gridRowHeightMm(
      opts.baseRowHeight,
      wrapperRow,
      opts.measureRow,
    );
    const fullChildH = nestedGridHeightMm(child.grid, opts);
    const decorH = keepDecorations
      ? Math.max(0, measuredWrapperH - fullChildH)
      : 0;
    const rowH = Math.max(
      gridRowHeightMm(opts.baseRowHeight, wrapperRow),
      decorH,
      childH,
    );
    return rowH + (drawsOuterFrame(branch.grid) ? 2 * ONE_PX_MM : 0);
  }

  /**
   * 嵌套表格栈的顺序切分（2026-10-27，A1 → A2 → 更深层嵌套）。
   *
   * 把**叶子 Grid** 的行按顺序当作「可整体落页的块」（一行 = 一张表 / 一段内容），尽量填满
   * 当前页剩余空间，余块流转下一页——而不是把整个外层行当原子块甩页。支持：
   * - 任意行（不再仅末行）；
   * - 同一行多个单元格各有一段栈（按行号并行推进，每页各栈取相同行数）；
   * - **任意深度单链包装**（`grid → row → cell → grid → …`）：切分发生在叶子层，
   *   包装层按切片逐层重建。
   *
   * 片段语义：
   * - 片段 = 外层 Grid 行 + 各条栈的包装链（叶子换成行切片）；外层上下边框由
   *   `suppressBorders` 续接；
   * - **续页片段中不参与续接的单元格留空**（2026-10-27 用户决定：标题 / 标签只在首片段
   *   显示，包装层逐层生效）；
   * - 单块比整页还高时强制放入并告警（与 Grid 单行 / Table 单行口径一致）。
   *
   * @param grid 外层 Grid
   * @param rowIndex 被切分的外层行下标
   * @param branches 该行内的嵌套栈分支（由 {@link nestedTableStacksOfRow} 识别）
   * @param outerExtras 外层行除嵌套内容以外的固定占用（mm，含外框以外的内边距等）
   * @param startWithFirstFragment 本片段是否为该 Grid 的首片段（决定顶边框）
   */
  const splitNestedStackRow = (
    grid: GridNodeV2,
    rowIndex: number,
    branches: NestedStackBranch[],
    outerExtras: number,
    startWithFirstFragment: boolean,
  ): void => {
    const row = grid.rows[rowIndex];
    const isLastOuterRow = rowIndex === grid.rows.length - 1;
    const frameH = drawsOuterFrame(grid) ? ONE_PX_MM : 0;
    // 纸张 mm→px 取整余量（与 splitGrid 的 Table 切分路径同口径，见那里的说明）。
    const paperRoundMm = 0.5;
    // 各条栈的叶子 Grid：切分行数以它为准（包装层只有 1 行，不参与推进）
    const leaves = branches.map(leafGridOf);
    // 各栈已消费的叶子行数（并行推进：每页各栈取相同行数）
    const consumed = branches.map(() => 0);
    // 「该行内容的首片段」决定标题格等非续接单元格是否显示；「该 Grid 的首片段」决定顶框。
    // 两者必须分开：被切分的行可能位于网格中段（前面已有行落页），此时顶框要抑制、标题仍要显示。
    let firstRowFragment = true;
    let firstGridFragment = startWithFirstFragment;

    /** 各栈是否还有未落页的叶子行。 */
    const hasMore = (): boolean =>
      leaves.some((leaf, idx) => consumed[idx] < leaf.rows.length);

    while (hasMore()) {
      const avail = bodyH - curUsed;
      const budget = avail - outerExtras - paperRoundMm;

      // 逐行并行试探：候选行数 c 的整行高度 = 各分支「包装链片段高度」的最大值。
      // 直接算链高度（而非叶子行高逐行累加）才能把包装层的边框 / 装饰算准。
      let count = 0;
      let sliceH = 0;
      for (;;) {
        const nextCount = count + 1;
        let any = false;
        let candidateH = 0;
        for (let idx = 0; idx < branches.length; idx += 1) {
          const target = consumed[idx] + nextCount;
          if (target > leaves[idx].rows.length) continue;
          any = true;
          candidateH = Math.max(
            candidateH,
            chainSliceHeightMm(
              branches[idx],
              leaves[idx].rows.slice(consumed[idx], target),
              firstRowFragment,
            ),
          );
        }
        if (!any || candidateH > budget + 1e-6) break;
        count = nextCount;
        sliceH = candidateH;
      }

      if (count === 0) {
        // 本页连一块都放不下：页内已有内容则先换页，空页则强制放 1 块（渲染层 overflow 兜底）。
        if (curChildren.length > 0) {
          flush();
          continue;
        }
        count = 1;
        for (let idx = 0; idx < branches.length; idx += 1) {
          if (consumed[idx] < leaves[idx].rows.length) {
            sliceH = Math.max(
              sliceH,
              chainSliceHeightMm(
                branches[idx],
                leaves[idx].rows.slice(consumed[idx], consumed[idx] + 1),
                firstRowFragment,
              ),
            );
          }
        }
        if (sliceH + outerExtras + frameH > bodyH + 1e-6) {
          warnings.push({
            nodeId: leaves[0].id,
            message: `嵌套网格行高度约 ${sliceH.toFixed(1)}mm 超过单页可用高，已溢出裁剪`,
          });
        }
      }

      const included = branches.map((branch, idx) =>
        leaves[idx].rows.slice(
          consumed[idx],
          Math.min(consumed[idx] + count, leaves[idx].rows.length),
        ),
      );
      const isLast = branches.every(
        (branch, idx) => consumed[idx] + count >= leaves[idx].rows.length,
      );
      const cells = row.cells.map((cell, cellIndex) => {
        const branchIndex = branches.findIndex(
          (branch) => branch.cellIndex === cellIndex,
        );
        if (branchIndex >= 0) {
          const branch = branches[branchIndex];
          // 只替换该分支的嵌套网格（包装链逐层重建），保留同格内的其它子节点
          return {
            ...cell,
            children: cell.children.map((child) =>
              child === branch.grid
                ? rebuildBranch(branch, included[branchIndex], firstRowFragment)
                : child,
            ),
          };
        }
        // 续页片段：不参与续接的单元格（如左侧标题格）留空，避免每页重复标题。
        return firstRowFragment ? cell : { ...cell, children: [] };
      });
      const fragmentH = Math.max(
        gridRowHeightMm(opts.baseRowHeight, row),
        outerExtras +
          sliceH +
          (firstGridFragment ? frameH : 0) +
          (isLast && isLastOuterRow ? frameH : 0),
      );
      push(
        {
          node: { ...grid, rows: [{ ...row, cells }] },
          suppressBorders: {
            top: !firstGridFragment,
            // 该行还有未落页内容，或外层后面还有行 → 抑制底框，保持跨页连续
            bottom: !(isLast && isLastOuterRow),
          },
        },
        fragmentH,
      );

      for (let idx = 0; idx < branches.length; idx += 1) {
        consumed[idx] = Math.min(
          consumed[idx] + count,
          leaves[idx].rows.length,
        );
      }
      firstRowFragment = false;
      firstGridFragment = false;
      if (!isLast) flush();
    }
  };

  /**
   * 深拷贝节点树，将其中每个 Table 按 mapFn 替换为带 `_paginateMaxRows` / `_paginateStartRow`
   * 限制的版本（2026-09-03 廿一续；起始行 2026-10-27）。
   * `hideHeader`（2026-10-22）：为 true 时同时写入 `_paginateHideHeader`（续页片段隐藏表头），
   * 用于在 Grid 单行跨页切分时，把行内的 Table 同步切成片段。
   *
   * @param nodes 待映射的节点树
   * @param mapFn 返回本片段该表渲染的行数上限与起始行号（0-based）；返回 undefined 则不切分
   * @param hideHeader 是否同时隐藏表头（仅续页片段）
   */
  function mapTablesInNodeTree(
    nodes: FormNodeV2[],
    mapFn: (
      table: Extract<FormNodeV2, { type: "table" }>,
    ) => { maxRows: number; startRow: number } | undefined,
    hideHeader = false,
  ): FormNodeV2[] {
    return nodes.map((node) => {
      if (node.type === "grid") {
        return {
          ...node,
          rows: node.rows.map((row) => ({
            ...row,
            cells: row.cells.map((cell) => ({
              ...cell,
              children: mapTablesInNodeTree(cell.children, mapFn, hideHeader),
            })),
          })),
        };
      }
      if (node.type === "table") {
        const cut = mapFn(node);
        if (cut && cut.maxRows > 0) {
          return {
            ...node,
            _paginateMaxRows: cut.maxRows,
            _paginateStartRow: cut.startRow,
            ...(hideHeader ? { _paginateHideHeader: true } : {}),
          };
        }
      }
      return node;
    });
  }

  /** 统计节点树中所有 Table 的数据行总数（用于验证切分行数不丢）。 */
  function totalTableDataRowsInRow(
    row: GridRowV2,
    data: FormDataV2 | null | undefined,
  ): number {
    let total = 0;
    for (const cell of row.cells) {
      for (const node of cell.children) {
        if (node.type === "table") {
          total += resolveTableRowCount(node, data);
        }
      }
    }
    return total;
  }

  const splitGrid = (grid: GridNodeV2): void => {
    const rows = grid.rows;
    const gap = resolveGridGapV2(grid);
    const bordered = drawsOuterFrame(grid);
    const mr = opts.measureRow;
    let i = 0;
    let isFirstFragment = true;

    while (i < rows.length) {
      const suppressTop = !isFirstFragment;
      // 当前页可用高
      let avail = bodyH - curUsed;

      // ★ 嵌套表格栈（2026-10-27，A1 → A2 → 更深层嵌套）：行内是「嵌套网格纵向堆叠
      //   多张表」（本模板的「安全措施」块，或双栏各放一段表格栈，或多层包装网格）时，
      //   按叶子网格的行边界顺序填充本页，而不是把整行当原子块。A2 起不再限制「仅末行」，
      //   任意行放不下都可切分，后续行照常在同一页继续放置。
      const nestedBranches = nestedTableStacksOfRow(rows[i]);
      if (nestedBranches) {
        const rowH = gridRowHeightMm(opts.baseRowHeight, rows[i], mr);
        // 包装链完整高度（实测行高已含整条链，直接相减得到「表以外」的固定占用）
        const fullNestedH = Math.max(
          ...nestedBranches.map((branch) =>
            nestedGridHeightMm(branch.grid, opts),
          ),
        );
        const outerFrameH = drawsOuterFrame(grid) ? 2 * ONE_PX_MM : 0;
        // 外层行除嵌套内容外的固定占用；实测行高已含整段嵌套内容，直接相减，
        // 避免把已切走的嵌套行重复计入（同类问题见 `fragmentRowHeightMm` 的说明）。
        const outerExtras = Math.max(0, rowH - fullNestedH - outerFrameH);
        if (rowH > avail - outerExtras + 1e-6) {
          splitNestedStackRow(
            grid,
            i,
            nestedBranches,
            outerExtras,
            isFirstFragment,
          );
          isFirstFragment = false;
          i += 1;
          continue;
        }
      }

      // ★ 提前检测：当前行是否包含超高 Table（2026-09-03 廿一续）
      // 若单行内的 Table 总高度超过可用空间，正常行放置循环会把整行「放得下」，
      // 但实际渲染时 Table 内容远超页边界。此时跳过正常循环，直接走 Table 数据行切分。
      const tablesInRow = collectTablesInRow(rows[i]);
      let rowTableH = 0;
      for (const t of tablesInRow) {
        rowTableH += tableHeightMm(t, opts.baseRowHeight, opts.data);
      }
      // 「本行除表格外的占用」= Grid 外框 + 表以外的额外高度。
      //
      // ⚠️ 两条建模约束（2026-10-22 用户实报「27 行表格分 6 页」+「33 行压到页脚」）：
      //   ① 不能直接拿实测行高当占用：`measureRow` 返回的是**整行渲染高度，里面含整张表**，
      //      而表格随后被 `_paginateMaxRows` 裁到本页剩余空间 → 表高被重复扣两次。
      //      27 行时每页预算只剩 273 − 232 = 41mm ≈ 5 行，被拆成 5+5+5+5+5+2 共 6 页。
      //   ② 也不能再叠加行自身 min-height：行高 = max(行 min-height, 行内内容高)，
      //      行内有表时 min-height 已被表吸收，叠加等于每页白少放一行。
      //    故占用只取 max(0, 实测行高 − 表高)。
      const rowOwnH = gridRowHeightMm(opts.baseRowHeight, rows[i]);
      const measuredRowH = mr
        ? gridRowHeightMm(opts.baseRowHeight, rows[i], mr)
        : rowOwnH;
      // 行高 = max(行 min-height, 行内内容高)。行内有表时 min-height 已被表吸收，
      // 故只把「表以外的额外高度」当固定占用（叠加 rowOwnH 会每页白少放一行）。
      const rowExtrasH = Math.max(0, measuredRowH - rowTableH);
      const gridOverhead = (bordered ? ONE_PX_MM : 0) + rowExtrasH; // Grid 外框 + 表以外内容

      if (
        tablesInRow.length > 0 &&
        rowTableH > avail - gridOverhead &&
        rows.length - i === 1
      ) {
        // === Table 切分路径：最后一行（或唯一行）内含超高 Table ===
        // 不再无条件 flush：首片段应填满当前页剩余空间（含此前已放置的「前文」等内容），
        // 仅当剩余空间连「表头 + 1 行」都放不下时才先换页 —— 避免整表被整体推到下一页。
        let remaining = 0;
        for (const t of tablesInRow) {
          remaining += resolveTableRowCount(t, opts.data);
        }
        let offset = 0;
        let tblFirst = true;
        // 每张表的「已切走数据行数」游标（2026-10-27）：续页片段必须记录起始行号，
        // 否则渲染层每页都从第 1 行重绘（重复前几行 + 数据回填错位）。
        const tableCursor = new Map<
          Extract<FormNodeV2, { type: "table" }>,
          number
        >();
        // 跨页表头重复（2026-10-22）：行内多表并存时取「全部开启」才重复（确定性行为）。
        // 开启时每个片段都预留表头高度、续页照常渲染表头；
        // 关闭时仅首片段预留，续页片段写 `_paginateHideHeader` 隐藏表头。
        const repeatHeader = tablesInRow.every(
          (t) => t.repeatHeaderOnBreak !== false,
        );
        // 行内是否有表头、有几行（2026-10-23 `showHeader` + 复合表头）：与上面的 `every` 不同口径 ——
        // 预留表头高度要看行高实际有没有含表头，任一列的表显示表头就会撑起整行，
        // 所以取各表表头行数的**最大值**（宁可多预留，也不要把行高算小、压到页脚）。
        const headerRowCountMax = tablesInRow.reduce(
          (max, t) => Math.max(max, resolveTableHeaderRowCountV2(t)),
          0,
        );

        // 每数据行的真实高度：border all / inner 时每行多 1px 下边框（见 `tableHeightMm`）。
        // 用裸 baseRowHeight 会多塞一行：33 行时按 8mm 算能放 33 行，实际 33 行 × 8.26mm
        // 已经超出正文区 9mm，表格直接压到页脚边距上。
        const rowLineH = tablesInRow.some(
          (t) => t.border === "all" || t.border === "inner",
        )
          ? ONE_PX_MM
          : 0;
        const perRowH = opts.baseRowHeight + rowLineH;

        while (remaining > 0) {
          const pageAvail = bodyH - curUsed;
          // 表头高度预留（与独立 Table 的 `paginateTable` 同口径）：重复表头时**每个**片段
          // 都扣掉 N 行表头；否则只首片段扣，后续片段不扣（表头被隐藏）。
          // 没有表头（showHeader=false / 复合表头为空）时 N=0 → 一律不扣。
          const headerReserve =
            repeatHeader || tblFirst
              ? headerRowCountMax * opts.baseRowHeight
              : 0;
          // 纸张 mm→px 取整余量：A4 高 297mm = 1122.52px，浏览器取整到 1122px → 正文实测
          // 272.6mm 而非名义 273mm（真机实测差 0.4mm）。留 0.5mm 余量，避免「算着正好、实际压边」。
          const paperRoundMm = 0.5;
          const tableBudget = Math.max(
            0,
            pageAvail - gridOverhead - headerReserve - paperRoundMm,
          );
          let chunk = tableBudget > 0 ? Math.floor(tableBudget / perRowH) : 0;
          if (chunk === 0 && remaining > 0) {
            // 本页剩余空间放不下「表头 + 1 行」→ 若页内已有内容则先换页（与 Grid 单行
            // 超高强制换页同语义）；空页则强制放 1 行（渲染层 overflow 兜底）。
            if (
              curChildren.length > 0 &&
              headerReserve + perRowH > pageAvail - gridOverhead + 1e-6
            ) {
              flush();
              continue;
            }
            chunk = 1;
          }
          chunk = Math.min(chunk, remaining);

          const isLast = offset + chunk >= remaining;
          const fragmentCells = rows[i].cells.map((cell) => ({
            ...cell,
            children: mapTablesInNodeTree(
              cell.children,
              (tbl) => {
                const total = resolveTableRowCount(tbl, opts.data);
                // 按各行占比分配（与既有行为一致）；起始行号按该表的游标推进，
                // 遇到被截断（游标越过总行数）时钳制到总行数，避免续页画出不存在的行。
                const ratio = total / Math.max(1, remaining + offset);
                const maxRows = Math.round(chunk * ratio);
                const startRow = Math.min(tableCursor.get(tbl) ?? 0, total);
                tableCursor.set(tbl, startRow + maxRows);
                return { maxRows, startRow };
              },
              // 续页片段且不重复表头 → 隐藏表头
              !tblFirst && !repeatHeader,
            ),
          }));
          push({
            node: { ...grid, rows: [{ ...rows[i], cells: fragmentCells }] },
            suppressBorders: { top: !tblFirst, bottom: !isLast },
          });

          remaining -= chunk;
          offset += chunk;
          tblFirst = false;
          if (remaining > 0) flush();
        }

        isFirstFragment = false;
        i = i + 1;
        if (i < rows.length) flush();
        continue;
      }

      // === 正常 Grid 行放置循环（无超高 Table 或多行可正常切分）===

      let j = i;
      let acc = suppressTop || !bordered ? 0 : ONE_PX_MM; // 片段上边框（首片段且带框时计入）
      let placed = 0;
      while (j < rows.length) {
        const rowH = gridRowHeightMm(opts.baseRowHeight, rows[j], mr);
        const add = (placed > 0 ? gap : 0) + rowH;
        // 若该片段到此为止（j 是最后一行）→ 末片段需留底边框；否则中间片段无底边框
        const wouldBeLastFragment = j + 1 >= rows.length;
        const reserve = wouldBeLastFragment && bordered ? ONE_PX_MM : 0;
        if (acc + add + reserve <= avail + 1e-6) {
          acc += add;
          placed++;
          j++;
        } else {
          break;
        }
      }

      // 一行都放不下（该行比可用高还高，或本页剩余空间极小）→ 强制换页放至少一行
      // 注：含超高 Table 的单行已在循环入口处提前检测并切分（见上方「Table 切分路径」），
      //       此处仅处理无 Table 的普通超高行（如超大图片/超长文本等原子节点）。
      if (placed === 0) {
        if (curChildren.length > 0) flush();
        const st = !isFirstFragment;
        const sb = i + 1 < rows.length; // 还有后续行 → 抑制底边框（连续）
        const fragH = gridFragmentHeightMm(
          opts.baseRowHeight,
          grid,
          rows.slice(i, i + 1),
          st,
          sb,
          mr,
        );
        if (fragH > bodyH + 1e-6) {
          warnings.push({
            nodeId: grid.id,
            message: `Grid 第 ${i + 1} 行高度约 ${fragH.toFixed(1)}mm 超过单页可用高，已溢出裁剪`,
          });
        }
        push({
          node: { ...grid, rows: rows.slice(i, i + 1) },
          suppressBorders: { top: st, bottom: sb },
        });
        isFirstFragment = false;
        i = i + 1;
        if (i < rows.length) flush();
        continue;
      }

      const moreRemain = j < rows.length;
      const st = suppressTop;
      const sb = moreRemain; // 后续还有片段 → 抑制底边框（连续外观）
      push({
        node: { ...grid, rows: rows.slice(i, j), id: grid.id },
        suppressBorders: { top: st, bottom: sb },
      });
      isFirstFragment = false;
      i = j;
      // 下一行是「末行内 Table」或「嵌套表格栈」，且本页剩余空间已放不下它 → 先不换页：
      // 让下一轮循环在同一页内走切分路径，用能填满剩余空间的部分内容收尾，余量流转下一页。
      // 否则表格 / 表格栈会被整体甩到下一页，出现「刚好填满 / 多一行就整块跳页」的断裂。
      // 嵌套栈不限末行（2026-10-27，A2）：中间行同样可用剩余空间续填。
      if (
        moreRemain &&
        (nestedTableStacksOfRow(rows[j]) !== null ||
          (j + 1 >= rows.length && collectTablesInRow(rows[j]).length > 0))
      ) {
        continue;
      }
      if (moreRemain) flush();
    }
  };

  for (const node of page.children) {
    if (node.type === "grid") paginateGrid(node);
    else if (node.type === "table") paginateTable(node);
    else paginateAtomic(node);
  }
  flush();

  // 兜底：空逻辑页（无子节点）也至少产出一张物理纸，保证纸张元素与 @page 注入始终存在。
  if (pages.length === 0) {
    pages.push({
      id: page.id,
      sourcePageId: page.id,
      sourceIndex: 0,
      index: 0,
      margin: page.margin,
      children: [],
    });
  }

  return { pages, warnings };
}

/**
 * 分页整篇 Schema：逐逻辑页分页后拼接，回填全局物理页序号。
 * @param schema 表单 Schema
 * @param extra 额外上下文（data / measureNode）；baseRowHeight 取自 schema
 */
export function paginateSchema(
  schema: FormSchemaV2,
  extra?: {
    data?: FormDataV2 | null;
    measureNode?: PaginateContext["measureNode"];
    measureRow?: PaginateContext["measureRow"];
  },
): PaginateResult {
  const paper: ResolvedPaperSizeV2 = resolvePaperSizeV2(schema.paper);
  const all: PhysicalPage[] = [];
  const warnings: PaginateWarning[] = [];
  for (const page of schema.pages) {
    const bodyHeightMm = paper.heightMm - page.margin.top - page.margin.bottom;
    const contentWidthMm = paper.widthMm - page.margin.left - page.margin.right;
    const r = paginatePage(page, {
      baseRowHeight: schema.baseRowHeight,
      // 全局基础字号（页面属性配置）参与 Text 高度估算；未设时 resolve 回退 13。
      baseFontSize: resolveBaseFontSizeV2(schema),
      bodyHeightMm,
      contentWidthMm,
      data: extra?.data ?? null,
      measureNode: extra?.measureNode,
      measureRow: extra?.measureRow,
    });
    all.push(...r.pages);
    warnings.push(...r.warnings);
  }
  all.forEach((p, idx) => (p.index = idx + 1));
  return { pages: all, warnings };
}
