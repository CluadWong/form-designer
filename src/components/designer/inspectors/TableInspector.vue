<script setup lang="ts">
/**
 * 表格面板（2026-10-27 重设计；2026-10-28 第二版）。
 *
 * 旧版把「表头结构」与「列配置」做成两个同构的键值表：表头文字与列标题各有一个输入框
 * （配了矩阵后列标题被静默只读），列与表头格还要两头增删 —— 分歧与重叠都在这里。
 *
 * 2026-10-27 版是**一个「表头与列」网格编辑器**：表头矩阵（真合并的格子）+ 选中格操作条
 * + 与网格**逐列像素对齐**的列带（一格 = 列，内含字段名 / 宽度 / 删列）。
 *
 * 2026-10-28 第二版改掉两处实操痛点（配复合表头的宽表时暴露）：
 * 1. **列清单改为纵向列表**：原列带一格只有 56px，10 列时字段名被压成两个字、宽度与删除
 *    要横向滚动才看得见。现在一列一行（序号 / 字段名吃满剩余宽度 / 宽度 / 删列），
 *    列数再多也不用横滚；与网格的对应关系改由**选中联动**承担（选中格 → 该行高亮，
 *    点该行 → 选中该列的格并滚进视野），比像素对齐更稳。
 * 2. **选中格给出整宽标题框**：格内只有一个 46px 的格子，长标题既看不全也不好改；
 *    选中后在网格下方的详情区提供整宽可换行输入框（格内 textarea 仍可快速改字），
 *    两者走同一个 `commitCellText`。
 *
 * 三条不变量（由 `types/schema-v2-header-edit` 保证）：
 * 1. 表头文字只有这一个入口；单行表头改字直写 `columns[].title`（JSON 不膨胀）。
 * 2. 增删列只发生在列清单，`addTableColumnV2` / `removeTableColumnV2` 同步矩阵。
 * 3. 任何结构操作后自动补洞，面板操作不可能产生「缺格」非法态。
 */
import { computed, nextTick, onMounted, onUnmounted, onUpdated, ref } from "vue";
import type { PlacedTableHeaderCellV2, TableNodeV2 } from "@/types";
import type { SchemaEdits } from "../composables/useSchemaEdits";
import HelpLink from "./HelpLink.vue";
import {
  DEFAULT_TEXT_FONT_SIZE_PX,
  resolveTableHeaderFontSizeV2,
  resolveTableHeaderLayoutV2,
} from "@/engine-v2/derivation";
import {
  appendHeaderRowV2,
  canGrowHeaderCellV2,
  deleteHeaderCellV2,
  deleteHeaderRowV2,
  growHeaderCellV2,
  headerCellsToRowsV2,
  repairHeaderCellsV2,
  shrinkHeaderCellV2,
} from "@/types";

const props = defineProps<{
  node: TableNodeV2;
  api: SchemaEdits;
  /** 全局基础字号（页面属性「基础字号」的生效值）：表头默认字号按 16/13 随其等比缩放。 */
  baseFontSize?: number;
}>();

/**
 * 表头默认字号（未设 `headerStyle.fontSize` 时生效）：随全局基础字号等比缩放
 * （基础字号 13 → 16，与旧外观一致；调大字号时表头不会比正文小）。
 * 与渲染层 `--v2-table-header-font-size` 同源，保证「面板所见 = 实际生效」。
 */
const headerFontSizeDefault = computed(() =>
  resolveTableHeaderFontSizeV2(props.baseFontSize ?? DEFAULT_TEXT_FONT_SIZE_PX),
);

/** 生效表头的布局求解（与渲染、分页、校验同一答案）。非法时它已回退为单行 + issues。 */
const layout = computed(() => resolveTableHeaderLayoutV2(props.node));
const cells = computed(() => layout.value.cells);
const rowCount = computed(() => layout.value.rowCount);
const columnCount = computed(() => Math.max(1, layout.value.columnCount));

/**
 * 表头水平对齐的**生效值**：未设 `headerStyle.align` 时渲染层 `.layout-table__header`
 * 给的是 `text-align: center`。面板原先显示「左」，与画布实际不符 —— 这里统一取居中，
 * 顺带让网格里的格内文字与下拉框显示同一个值。
 */
const headerAlign = computed(() => props.node.headerStyle?.align ?? "center");

/** 是否已有显式矩阵（决定「恢复单行」是否可点、改字是直写列标题还是写矩阵）。 */
const hasHeaderRows = computed(() => (props.node.headerRows?.length ?? 0) > 0);

/** 格的稳定标识：左上角格位在矩阵内唯一，跨列/跨行改变后仍能定位。 */
function cellKey(cell: PlacedTableHeaderCellV2): string {
  return `${cell.rowStart}-${cell.colStart}`;
}

const selectedKey = ref<string | null>(null);
const selectedCell = computed(
  () => cells.value.find((cell) => cellKey(cell) === selectedKey.value) ?? null,
);
const selectedIndex = computed(() =>
  cells.value.findIndex((cell) => cellKey(cell) === selectedKey.value),
);

/**
 * 选中格所在的列（1 基，与 `colStart` 同口径）。
 *
 * 表头网格与列清单不再是「像素对齐」的关系（列清单 2026-10-28 改为纵向列表，见文件头），
 * 两者的对应改由**选中联动**承担：选中格 → 该列在清单里高亮；点清单某行 → 选中该列的格。
 */
const activeColumn = computed<number | null>(() => selectedCell.value?.colStart ?? null);

/** 列清单里高亮哪一行（0 基，对应 `node.columns` 下标）。 */
const activeColumnIndex = computed<number | null>(() =>
  activeColumn.value == null ? null : activeColumn.value - 1,
);

/** 点列清单某行：选中该列在第 1 行的格（被跨列格覆盖时选那个跨列格），并把它滚进视野。 */
function selectColumn(index: number): void {
  const target = index + 1;
  const hit = cells.value.find(
    (cell) => cell.colStart <= target && target < cell.colStart + cell.colSpan,
  );
  if (!hit) return;
  selectedKey.value = cellKey(hit);
  void revealSelectedCell();
}

/** 把选中的格滚进网格的横向可视区（点清单里靠右的列时，网格可能还停在左侧）。 */
async function revealSelectedCell(): Promise<void> {
  const key = selectedKey.value;
  if (!key) return;
  await nextTick();
  const el = sheetEl.value?.querySelector<HTMLElement>(`[data-header-cell="${key}"]`);
  el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

/** 详情区整宽标题框的提交：与格内 textarea 走同一条 commitCellText。 */
function commitSelectedTitle(event: Event): void {
  const index = selectedIndex.value;
  if (index < 0) return;
  commitCellText(index, event);
}

/**
 * 列的最小宽度（px）。2026-10-28 由 56 降到 46：字段名与宽度已搬到下方的纵向列清单
 * （不再挤在这一格里），网格只承担"看清表头结构"，故单列可以更窄、横向滚动更短。
 */
const MIN_COLUMN_WIDTH = 46;

/**
 * 网格与列带共用的列轨。列少时按 `1fr` 铺满面板，列多时用 `minWidth` 把整体撑开、
 * 交给外层横向滚动 —— 不用 `width: max-content`，因为那会让 `1fr` 退化成按内容撑宽，
 * 一个跨 4 列的长标题就会把这几列拉到几百 px（真机实测过）。
 */
const sheetStyle = computed(() => ({
  gridTemplateColumns: `22px repeat(${columnCount.value}, minmax(${MIN_COLUMN_WIDTH}px, 1fr))`,
  minWidth: `${22 + columnCount.value * MIN_COLUMN_WIDTH}px`,
}));

function cellStyle(cell: PlacedTableHeaderCellV2) {
  return {
    gridRow: `${cell.rowStart} / span ${cell.rowSpan}`,
    gridColumn: `${cell.colStart + 1} / span ${cell.colSpan}`,
  };
}

function cellClassList(cell: PlacedTableHeaderCellV2) {
  const isRight = cell.colStart + cell.colSpan - 1 === columnCount.value;
  const isBottom = cell.rowStart + cell.rowSpan - 1 === rowCount.value;
  const active = activeColumn.value;
  return {
    "v2-sheet__cell": true,
    "v2-sheet__cell--right": !isRight,
    "v2-sheet__cell--bottom": !isBottom,
    "is-selected": cellKey(cell) === selectedKey.value,
    // 选中格的「列」在下方列清单里高亮；反向也成立（点列清单 → 选中该列的格）
    "is-column-active":
      active != null && cell.colStart <= active && active < cell.colStart + cell.colSpan,
    "v2-sheet__cell--merged": cell.colSpan > 1 || cell.rowSpan > 1,
  };
}

/** 统一提交：补洞 → 转行序列 → 整份替换（一次操作 = 一步撤销）。 */
function commitCells(next: PlacedTableHeaderCellV2[] | null, nextRowCount = rowCount.value): void {
  if (!next) return;
  const repaired = repairHeaderCellsV2(next, nextRowCount, columnCount.value);
  props.api.updateTableHeaderRows(headerCellsToRowsV2(repaired, nextRowCount));
}

/**
 * 格内改字。
 * - 单行投影（未配矩阵）：直接写列标题，导出的 JSON 不出现 `headerRows`；
 * - 已有矩阵：写进矩阵，其余格原样保留。
 */
function commitCellText(index: number, event: Event): void {
  const text = (event.target as HTMLTextAreaElement).value;
  if (!hasHeaderRows.value) {
    const column = props.node.columns[index];
    if (column) props.api.updateTableColumn(column.key, "title", event);
    return;
  }
  const current = cells.value[index];
  if (!current) return;
  commitCells(
    cells.value.map((cell, i) => (i === index ? { ...cell, text } : cell)),
  );
}

function grow(axis: "col" | "row"): void {
  const index = selectedIndex.value;
  if (index < 0) return;
  commitCells(
    growHeaderCellV2(cells.value, rowCount.value, columnCount.value, index, axis),
  );
}

function shrink(axis: "col" | "row"): void {
  const index = selectedIndex.value;
  if (index < 0) return;
  commitCells(shrinkHeaderCellV2(cells.value, index, axis));
}

const canShrinkCol = computed(() => (selectedCell.value?.colSpan ?? 1) > 1);
const canShrinkRow = computed(() => (selectedCell.value?.rowSpan ?? 1) > 1);
const canGrowCol = computed(
  () =>
    selectedIndex.value >= 0 &&
    canGrowHeaderCellV2(cells.value, rowCount.value, columnCount.value, selectedIndex.value, "col"),
);
const canGrowRow = computed(
  () =>
    selectedIndex.value >= 0 &&
    canGrowHeaderCellV2(cells.value, rowCount.value, columnCount.value, selectedIndex.value, "row"),
);
const canDeleteCell = computed(
  () => selectedIndex.value >= 0 && deleteHeaderCellV2(cells.value, selectedIndex.value) !== null,
);

function removeCell(): void {
  const index = selectedIndex.value;
  if (index < 0) return;
  const next = deleteHeaderCellV2(cells.value, index);
  if (next) commitCells(next);
  selectedKey.value = null;
}

function addRow(): void {
  const next = appendHeaderRowV2(cells.value, rowCount.value, columnCount.value);
  commitCells(next.cells, next.rowCount);
}

function removeRow(row: number): void {
  const next = deleteHeaderRowV2(cells.value, rowCount.value, columnCount.value, row);
  if (next) commitCells(next.cells, next.rowCount);
}

/** 恢复单行表头：把首行文字摊平回列标题再删矩阵（字不丢）。 */
function resetHeader(): void {
  selectedKey.value = null;
  props.api.resetTableHeaderRows();
}

/**
 * 格内 textarea 自动增高：`rows="1"` 起步按 `scrollHeight` 撑高，多行标题逐行长高
 * （上限由 CSS `max-height` 兜住，超出后裁切）。
 *
 * 必须额外用 `ResizeObserver` 盯着**宽度**变化：跨列格的宽度是 CSS grid 算出来的，
 * 没有触发 Vue 更新，`onMounted` 量的还是"合并前 1 列宽"——于是「收工时间」按 56px 宽
 * 换行成 2 行、把行高撑到 40px，合并成 4 列后也不会重算（真机实测到的就是这个）。
 */
const sheetEl = ref<HTMLElement | null>(null);
const lastWidth = new WeakMap<Element, number>();
let widthObserver: ResizeObserver | null = null;

function autosizeText(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = "auto";
  const next = el.scrollHeight;
  // jsdom 里 scrollHeight 恒为 0：此时回落到 CSS 高度，不写内联值。
  el.style.height = next > 0 ? `${next}px` : "";
}

function syncTextareas(): void {
  const list = sheetEl.value?.querySelectorAll<HTMLTextAreaElement>(".v2-sheet__text");
  if (!list) return;
  list.forEach(autosizeText);
  if (typeof ResizeObserver === "undefined") return; // jsdom 无 RO
  widthObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) {
      const el = entry.target as HTMLTextAreaElement;
      const width = el.clientWidth;
      if (lastWidth.get(el) === width) continue;
      lastWidth.set(el, width);
      autosizeText(el);
    }
  });
  list.forEach((el) => {
    lastWidth.set(el, el.clientWidth);
    widthObserver?.observe(el);
  });
}

onMounted(syncTextareas);
onUpdated(syncTextareas);
onUnmounted(() => widthObserver?.disconnect());
</script>

<template>
  <div class="v2-grid-dimensions">
    <label class="v2-control">
      <span>最小行数</span>
      <span class="v2-unit">
        <input type="number" min="0" step="1" :value="node.minRows" @change="api.updateTableRows" />
        <span>行</span>
      </span>
    </label>
    <label class="v2-control">
      <span>边框</span>
      <select :value="node.border ?? 'all'" @change="api.updateTableBorder">
        <option value="all">外框 + 内部</option>
        <option value="outer">仅外框</option>
        <option value="inner">仅内部</option>
        <option value="none">无边框</option>
      </select>
    </label>
  </div>
  <!-- 两个表头开关同处一个网格容器（`data-*` 与 label 顺序被单测锁定）：
       「显示表头」在前、「跨页重复表头」紧随，后者在无表头时禁用。 -->
  <div class="v2-grid-dimensions v2-grid-dimensions--stack">
    <label class="v2-control v2-control--switch">
      <span>显示表头</span>
      <input
        type="checkbox"
        data-table-show-header="true"
        :checked="node.showHeader !== false"
        @change="api.updateTableShowHeader"
      />
    </label>
    <label class="v2-control v2-control--switch">
      <span>跨页重复表头</span>
      <input
        type="checkbox"
        data-table-repeat-header="true"
        :checked="node.repeatHeaderOnBreak !== false"
        :disabled="node.showHeader === false"
        @change="api.updateTableRepeatHeader"
      />
    </label>
  </div>

  <div class="v2-sidebar__subheading">表头样式</div>
  <div class="v2-style-grid">
    <label class="v2-control v2-control--inline">
      <span>字号</span>
      <span class="v2-unit">
        <input
          type="number"
          min="1"
          step="1"
          data-table-header-font-size="true"
          :value="node.headerStyle?.fontSize ?? headerFontSizeDefault"
          @change="api.updateTableHeaderFontSize"
        />
        <span>px</span>
      </span>
    </label>
    <label class="v2-control v2-control--inline">
      <span>粗细</span>
      <!-- 生效默认是「加粗」：`.layout-table__header` CSS 给了 600，未设 headerStyle.fontWeight
           时表头视觉即为加粗，故面板默认显示「加粗」而非「常规」（此前后者与实际不符）。 -->
      <select
        :value="node.headerStyle?.fontWeight ?? 'bold'"
        @change="api.updateTableHeaderFontWeight"
      >
        <option value="normal">常规</option>
        <option value="bold">加粗</option>
      </select>
    </label>
  </div>
  <label class="v2-control v2-control--inline">
    <span>水平对齐</span>
    <select :value="headerAlign" @change="api.updateTableHeaderAlign">
      <option value="left">左</option>
      <option value="center">居中</option>
      <option value="right">右</option>
    </select>
  </label>

  <!-- 表头与列：唯一入口 -->
  <div class="v2-sidebar__subheading v2-sidebar__subheading--row">
    <span>表头与列</span>
    <span class="v2-subheading__actions">
      <HelpLink section="components" hint="查看表头与列的用法" />
      <button
        class="v2-subheading__action"
        type="button"
        title="在末尾追加一行表头"
        data-header-add-row="true"
        @click="addRow"
      >
        + 行
      </button>
      <button
        class="v2-subheading__action"
        type="button"
        title="在末尾追加一列（表头自动补格）"
        data-table-add-column="true"
        @click="api.addTableColumn"
      >
        + 列
      </button>
      <button
        class="v2-subheading__action v2-subheading__action--quiet"
        type="button"
        title="把首行文字摊平为列标题，并移除复合表头"
        data-header-reset="true"
        :disabled="!hasHeaderRows"
        @click="resetHeader"
      >
        恢复单行
      </button>
    </span>
  </div>

  <p
    v-if="layout.issues.length"
    class="v2-header-hint v2-header-hint--issue"
    data-header-issue="true"
  >
    {{ layout.issues.join("；") }}
  </p>

  <!-- 表头网格：列多时按最小 46px 排开再横向滚动（结构视图必须看到列的对齐关系），
       字段名 / 宽度 / 删列已移到下方纵向列清单，不再挤在这一格里。 -->
  <div class="v2-table-scroll" data-table-scroll="true">
    <div class="v2-table-stack">
      <div
        ref="sheetEl"
        class="v2-sheet"
        :class="{ 'v2-sheet--muted': node.showHeader === false }"
        :style="sheetStyle"
        data-table-header-editor="true"
      >
        <div
          v-for="row in rowCount"
          :key="`gutter-${row}`"
          class="v2-sheet__gutter"
          :class="{ 'v2-sheet__gutter--last': row === rowCount }"
          :style="{ gridRow: String(row), gridColumn: '1' }"
        >
          <span class="v2-sheet__index">{{ row }}</span>
          <button
            class="v2-sheet__rowdel"
            type="button"
            title="删除该表头行"
            data-header-remove-row="true"
            :disabled="rowCount <= 1"
            @click="removeRow(row)"
          >
            ✕
          </button>
        </div>
        <div
          v-for="(cell, index) in cells"
          :key="cellKey(cell)"
          :class="cellClassList(cell)"
          :style="cellStyle(cell)"
          :data-header-cell="cellKey(cell)"
          :data-header-row="String(cell.rowStart)"
          @click="selectedKey = cellKey(cell)"
        >
          <textarea
            class="v2-sheet__text"
            data-header-text="true"
            rows="1"
            :value="cell.text"
            placeholder="标题"
            :style="{ textAlign: headerAlign }"
            @focus="selectedKey = cellKey(cell)"
            @input="autosizeText($event.target as HTMLTextAreaElement)"
            @change="commitCellText(index, $event)"
          ></textarea>
        </div>
      </div>

    </div>
  </div>

  <!-- 选中格的详情区（2026-10-28）：网格格内只有一个 46px 宽的格子，长标题既看不全也
       不好改；选中后在这里给一个整宽标题框，格内 textarea 仍可快速改字，两者提交同一处。 -->
  <div class="v2-cellbar" data-header-cellbar="true">
    <template v-if="selectedCell">
      <div class="v2-cellbar__head">
        <span class="v2-cellbar__label" data-header-cell-label="true">
          第 {{ selectedCell.rowStart }} 行 · {{ selectedCell.text || "(空标题)" }}
        </span>
        <span class="v2-cellbar__step" data-header-span-col="true">
          <button
            type="button"
            title="取消跨列（拆掉最右一列）"
            data-header-shrink-col="true"
            :disabled="!canShrinkCol"
            @click="shrink('col')"
          >
            −
          </button>
          <b>{{ selectedCell.colSpan }}</b>
          <button
            type="button"
            title="向右合并一列"
            data-header-grow-col="true"
            :disabled="!canGrowCol"
            @click="grow('col')"
          >
            +
          </button>
          <span class="v2-cellbar__unit">列</span>
        </span>
        <span class="v2-cellbar__step" data-header-span-row="true">
          <button
            type="button"
            title="取消跨行（拆掉最下一行）"
            data-header-shrink-row="true"
            :disabled="!canShrinkRow"
            @click="shrink('row')"
          >
            −
          </button>
          <b>{{ selectedCell.rowSpan }}</b>
          <button
            type="button"
            title="向下合并一行"
            data-header-grow-row="true"
            :disabled="!canGrowRow"
            @click="grow('row')"
          >
            +
          </button>
          <span class="v2-cellbar__unit">行</span>
        </span>
        <button
          class="v2-cellbar__del"
          type="button"
          title="删除该表头格（占地并入相邻格）"
          data-header-remove-cell="true"
          :disabled="!canDeleteCell"
          @click="removeCell"
        >
          删格
        </button>
      </div>
      <label class="v2-control v2-control--area">
        <span>标题</span>
        <textarea
          data-header-title-editor="true"
          rows="2"
          :value="selectedCell.text"
          placeholder="格内标题，可换行"
          @change="commitSelectedTitle"
        ></textarea>
      </label>
    </template>
    <span v-else class="v2-cellbar__empty">
      点选表头格 → 改标题 / 向右、向下合并 / 拆分 / 删除
    </span>
  </div>

  <!-- 列清单（2026-10-28）：原来是「与网格逐列对齐的列带」——10 列时每列只剩 56px，
       字段名被压成两个字、宽高与删除还要横向滚动才可见。改为纵向列表：一列一行，
       字段名独占剩余宽度、宽度单独一列，列数再多也不需要横向滚动。 -->
  <div class="v2-sidebar__subheading">列（{{ node.columns.length }}）</div>
  <div class="v2-col-list" data-table-columns="true">
    <div
      v-for="(column, index) in node.columns"
      :key="column.key"
      class="v2-col-row"
      :class="{ 'is-active': activeColumnIndex === index }"
      :data-table-column="column.key"
      @click="selectColumn(index)"
    >
      <span class="v2-col-row__index">{{ index + 1 }}</span>
      <input
        class="v2-col-row__key"
        data-col-key="true"
        :value="column.key"
        placeholder="字段名"
        title="字段名（导出 / 数据回填用的键）"
        @click.stop
        @change="api.renameTableColumnKey(column.key, $event)"
      />
      <input
        class="v2-col-row__width"
        data-col-width="true"
        :value="column.width ?? ''"
        placeholder="auto"
        title="列宽：mm 数值 / 1fr / auto"
        @click.stop
        @change="api.updateTableColumn(column.key, 'width', $event)"
      />
      <button
        class="v2-col-row__del"
        type="button"
        :disabled="node.columns.length <= 1"
        :title="`删除列 ${column.key}`"
        data-col-remove="true"
        @click.stop="api.removeTableColumn(column.key)"
      >
        ✕
      </button>
    </div>
  </div>
</template>
