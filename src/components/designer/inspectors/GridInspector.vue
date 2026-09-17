<script setup lang="ts">
/** Grid 配置：行列数 / 列宽 / 边框 / 单元格默认 / 间距。 */
import type { GridNodeV2 } from "@/types";
import type { SchemaEdits } from "../composables/useSchemaEdits";
import { DEFAULT_CELL_PADDING } from "@/engine-v2/derivation";

defineProps<{ node: GridNodeV2; api: SchemaEdits }>();
</script>

<template>
  <div class="v2-grid-dimensions">
    <label class="v2-control">
      <span>行数</span>
      <input
        type="number"
        min="1"
        step="1"
        :value="node.rows.length"
        data-dimension="rows"
        @change="api.updateGridDimensions"
      />
    </label>
    <label class="v2-control">
      <span>列数</span>
      <input
        type="number"
        min="1"
        step="1"
        :value="node.rows[0]?.cells.length ?? 1"
        data-dimension="columns"
        @change="api.updateGridDimensions"
      />
    </label>
  </div>
  <div class="v2-sidebar__subheading">列宽（mm / 比例 / 自动）</div>
  <div class="v2-grid-dimensions">
    <label
      v-for="(cell, columnIndex) in node.rows[0].cells"
      :key="columnIndex"
      class="v2-control v2-control--inline"
    >
      <span>第 {{ columnIndex + 1 }} 列</span>
      <input
        :value="node.columns?.[columnIndex] ?? cell.width ?? '1fr'"
        placeholder="如 30、1fr、auto"
        @change="api.updateGridColumnWidth(columnIndex, $event)"
      />
    </label>
  </div>
  <label class="v2-control">
    <span>边框</span>
    <select :value="node.border" @change="api.updateGridBorder">
      <option value="all">外框 + 内部</option>
      <option value="outer">仅外框</option>
      <option value="inner">仅内部</option>
      <option value="none">无边框</option>
    </select>
  </label>
  <div class="v2-sidebar__subheading">格子默认样式（内边距 / 对齐）</div>
  <div class="v2-grid-dimensions">
    <label class="v2-control v2-control--inline">
      <span>格子间距(mm)</span>
      <input
        type="number"
        min="0"
        step="1"
        data-grid="gap"
        :value="node.gap ?? 0"
        @change="api.updateGridGap"
      />
    </label>
    <label class="v2-control v2-control--inline">
      <span>默认内边距(mm)</span>
      <input
        type="number"
        min="0"
        step="1"
        data-cell-default="padding"
        :value="node.cellPadding ?? DEFAULT_CELL_PADDING"
        @change="api.updateGridCellDefault('cellPadding', $event)"
      />
    </label>
    <label class="v2-control v2-control--inline">
      <span>默认水平对齐</span>
      <select
        data-cell-default="align"
        :value="node.cellAlign ?? ''"
        @change="api.updateGridCellDefault('cellAlign', $event)"
      >
        <option value="">居中（默认）</option>
        <option value="left">左</option>
        <option value="center">居中</option>
        <option value="right">右</option>
      </select>
    </label>
    <label class="v2-control v2-control--inline">
      <span>默认垂直对齐</span>
      <select
        data-cell-default="valign"
        :value="node.cellVerticalAlign ?? ''"
        @change="api.updateGridCellDefault('cellVerticalAlign', $event)"
      >
        <option value="">居中（默认）</option>
        <option value="top">顶部</option>
        <option value="middle">居中</option>
        <option value="bottom">底部</option>
      </select>
    </label>
  </div>
</template>

<style scoped></style>
