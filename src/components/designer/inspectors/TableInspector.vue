<script setup lang="ts">
/** 表格：最小行数 / 边框 / 列配置（增删列即增删派生字段）。 */
import type { TableNodeV2 } from "@/types";
import type { SchemaEdits } from "../composables/useSchemaEdits";

defineProps<{ node: TableNodeV2; api: SchemaEdits }>();
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
        :value="node.headerStyle?.fontSize ?? 16"
        @change="api.updateTableHeaderFontSize"
      />
    </label>
    <label class="v2-control v2-control--inline">
      <span>粗细</span>
      <select
        :value="node.headerStyle?.fontWeight ?? 'normal'"
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
      <span class="v2-col-table__th v2-col-table__th--action"></span>
    </div>
    <div
      v-for="column in node.columns"
      :key="column.key"
      class="v2-col-table__row"
    >
      <input
        class="v2-col-table__input"
        :value="column.title"
        placeholder="列标题"
        @input="api.updateTableColumn(column.key, 'title', $event)"
      />
      <input
        class="v2-col-table__input v2-col-table__input--mono"
        :value="column.key"
        placeholder="字段名"
        @input="api.renameTableColumnKey(column.key, $event)"
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
