<script setup lang="ts">
/**
 * 单元格（grid-cell）：盒（撑满 / 内边距 / 行高）+ 对齐 + 合并拆分。
 *
 * 2026-10-28：动作按钮不再借用深色 `.v2-toolbar`（白侧栏里像一条异物），改用与配置行
 * 同高的 `.v2-action`；「内容撑满格子」由吊在标签下方的孤立勾选框改为占整行的右侧开关。
 */
import type { GridCellV2 } from "@/types";
import type { SchemaEdits } from "../composables/useSchemaEdits";
import { DEFAULT_CELL_PADDING, DEFAULT_CELL_ROW_HEIGHT } from "@/engine-v2/derivation";

defineProps<{
  node: GridCellV2;
  cellContext: {
    rowIndex: number;
    columnIndex: number;
    hasNextSibling: boolean;
    canSplit: boolean;
  } | null;
  /**
   * 该格的**生效**盒模型（`resolveCellBoxV2`：cell 覆盖 → Grid 默认 → 引擎常量）。
   * 面板据此显示内边距等生效默认，而非留空（`cell.padding` 未设时它由 Grid 默认决定）。
   */
  cellBox: { padding?: number; align?: string; verticalAlign?: string } | null;
  api: SchemaEdits;
}>();
</script>

<template>
  <div class="v2-grid-dimensions">
    <label class="v2-control v2-control--inline">
      <span>内边距</span>
      <!-- 生效值优先取 cellBox（含 Grid 级默认与引擎常量），cellBox 缺失时才退回本格值。 -->
      <span class="v2-unit">
        <input
          type="number"
          min="0"
          step="1"
          data-cell-padding="true"
          :value="cellBox?.padding ?? node.padding ?? DEFAULT_CELL_PADDING"
          @change="api.updateSelectedCellPadding"
        />
        <span>mm</span>
      </span>
    </label>
    <label class="v2-control v2-control--inline">
      <span>行高倍数</span>
      <!-- 未设 cell.rowHeight 时行高由所在行 row.height 决定，1 即其下限（等价于未覆盖）。 -->
      <input
        type="number"
        min="0"
        step="1"
        data-cell-row-height="true"
        :value="node.rowHeight ?? DEFAULT_CELL_ROW_HEIGHT"
        @change="api.updateSelectedCellRowHeight"
      />
    </label>
  </div>
  <div class="v2-grid-dimensions">
    <label class="v2-control v2-control--inline">
      <span>水平</span>
      <select :value="node.align ?? ''" @change="api.updateSelectedCellAlign">
        <option value="">默认（居中）</option>
        <option value="left">左</option>
        <option value="center">居中</option>
        <option value="right">右</option>
      </select>
    </label>
    <label class="v2-control v2-control--inline">
      <span>垂直</span>
      <select
        :value="node.verticalAlign ?? ''"
        @change="api.updateSelectedCellVerticalAlign"
      >
        <option value="">默认（跟随格子）</option>
        <option value="top">顶部</option>
        <option value="middle">居中</option>
        <option value="bottom">底部</option>
      </select>
    </label>
  </div>
  <label class="v2-control v2-control--switch">
    <span>内容撑满格子</span>
    <input
      type="checkbox"
      data-flex="true"
      :checked="!!node.flex"
      @change="api.updateSelectedCellFlex"
    />
  </label>

  <div class="v2-sidebar__subheading">合并 / 拆分</div>
  <div class="v2-action-row">
    <button
      class="v2-action"
      type="button"
      data-cell-merge="true"
      :disabled="!cellContext?.hasNextSibling"
      @click="api.mergeSelectedCellRight"
    >
      合并右侧相邻格
    </button>
    <button
      class="v2-action"
      type="button"
      data-cell-split="true"
      :disabled="!cellContext?.canSplit"
      :title="
        (node.colspan ?? 1) > 1
          ? '把合并过的格子还原成原来的格数（列数不变）'
          : '把本格一分为二：整张网格加一列，其它行在同一列位补一个空格，保持上下对齐'
      "
      @click="api.splitSelectedCell"
    >
      拆分此格
    </button>
  </div>
</template>
