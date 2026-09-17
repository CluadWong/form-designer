<script setup lang="ts">
/** 表格：最小行数 / 边框 / 列配置（增删列即增删派生字段）。 */
import { computed } from "vue";
import type { TableNodeV2 } from "@/types";
import type { SchemaEdits } from "../composables/useSchemaEdits";
import {
  DEFAULT_TEXT_FONT_SIZE_PX,
  resolveTableHeaderFontSizeV2,
} from "@/engine-v2/derivation";

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
</script>

<template>
  <div class="v2-grid-dimensions">
    <label class="v2-control">
      <span>最小行数</span>
      <input
        type="number"
        min="0"
        step="1"
        :value="node.minRows"
        @change="api.updateTableRows"
      />
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
  <div class="v2-sidebar__subheading">表头样式</div>
  <div class="v2-style-grid">
    <label class="v2-control v2-control--inline">
      <span>字号(px)</span>
      <input
        type="number"
        min="1"
        step="1"
        data-table-header-font-size="true"
        :value="node.headerStyle?.fontSize ?? headerFontSizeDefault"
        @change="api.updateTableHeaderFontSize"
      />
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
  <div class="v2-grid-dimensions">
    <label class="v2-control">
      <span>水平对齐</span>
      <select
        :value="node.headerStyle?.align ?? 'left'"
        @change="api.updateTableHeaderAlign"
      >
        <option value="left">左</option>
        <option value="center">居中</option>
        <option value="right">右</option>
      </select>
    </label>
  </div>
  <div class="v2-sidebar__subheading">列配置</div>
  <div class="v2-col-table" data-table-columns="true">
    <div class="v2-col-table__row v2-col-table__head">
      <span class="v2-col-table__th">标题</span>
      <span class="v2-col-table__th">字段</span>
      <span class="v2-col-table__th">宽度</span>
      <span class="v2-col-table__th v2-col-table__th--action"></span>
    </div>
    <div
      v-for="column in node.columns"
      :key="column.key"
      class="v2-col-table__row"
    >
      <textarea
        class="v2-col-table__input v2-col-table__input--title"
        :value="column.title"
        placeholder="列标题（支持换行）"
        rows="2"
        @change="api.updateTableColumn(column.key, 'title', $event)"
      ></textarea>
      <input
        class="v2-col-table__input v2-col-table__input--mono"
        :value="column.key"
        placeholder="字段名"
        @change="api.renameTableColumnKey(column.key, $event)"
      />
      <input
        class="v2-col-table__input v2-col-table__input--mono v2-col-table__input--width"
        :value="column.width ?? ''"
        placeholder="auto"
        @change="api.updateTableColumn(column.key, 'width', $event)"
      />
      <button
        class="v2-inspector__delete v2-inspector__delete--small"
        type="button"
        :disabled="node.columns.length <= 1"
        :title="`删除列 ${column.key}`"
        @click="api.removeTableColumn(column.key)"
      >
        ✕
      </button>
    </div>
  </div>
  <button
    class="v2-toolbar__button v2-add-col"
    type="button"
    @click="api.addTableColumn"
  >
    + 添加列
  </button>
</template>
