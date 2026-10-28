<script setup lang="ts">
/**
 * Grid 配置：行列数 / 列宽 / 边框 / 格子默认 / 间距。
 *
 * 2026-10-28 分组：结构（行列）→ 列宽 → 外观（边框 / 间距 / 内边距）→ 默认对齐。
 * 「边框」从孤立的一整行并进外观组，默认对齐两项合成一行。
 */
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

  <div class="v2-sidebar__subheading">列宽</div>
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

  <div class="v2-sidebar__subheading">外观</div>
  <label class="v2-control">
    <span>边框</span>
    <select :value="node.border" @change="api.updateGridBorder">
      <option value="all">外框 + 内部</option>
      <option value="outer">仅外框</option>
      <option value="inner">仅内部</option>
      <option value="none">无边框</option>
    </select>
  </label>
  <div class="v2-grid-dimensions">
    <label class="v2-control v2-control--inline">
      <span>格子间距</span>
      <span class="v2-unit">
        <input
          type="number"
          min="0"
          step="1"
          data-grid="gap"
          :value="node.gap ?? 0"
          @change="api.updateGridGap"
        />
        <span>mm</span>
      </span>
    </label>
    <label class="v2-control v2-control--inline">
      <span>内边距</span>
      <span class="v2-unit">
        <input
          type="number"
          min="0"
          step="1"
          data-cell-default="padding"
          :value="node.cellPadding ?? DEFAULT_CELL_PADDING"
          @change="api.updateGridCellDefault('cellPadding', $event)"
        />
        <span>mm</span>
      </span>
    </label>
  </div>

  <div class="v2-sidebar__subheading">格子默认对齐</div>
  <div class="v2-grid-dimensions">
    <label class="v2-control v2-control--inline">
      <span>水平</span>
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
      <span>垂直</span>
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
