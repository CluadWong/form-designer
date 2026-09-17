<script setup lang="ts">
/**
 * 右侧检查器面板（Inspector 组件化，2026-09-07 批次 2）。
 *
 * 本组件只做「按当前选中节点的类型，分发到对应类型子组件」+ 头部信息 + 校验面板，
 * 不含任何改 schema 的逻辑：编辑动作统一来自 `api`（`useSchemaEdits()` 的返回对象），
 * 避免为每个字段声明一个 emit。
 */
import { computed } from "vue";
import type { EditorNodeV2, HeaderFooterV2, SchemaIssueV2 } from "@/types";
import type { SchemaEdits } from "./composables/useSchemaEdits";
import { nodeLabel } from "./composables/useNodeSelection";
import PageInspector from "./inspectors/PageInspector.vue";
import GridInspector from "./inspectors/GridInspector.vue";
import CellInspector from "./inspectors/CellInspector.vue";
import TextInspector from "./inspectors/TextInspector.vue";
import FieldPInspector from "./inspectors/FieldPInspector.vue";
import HtmlInspector from "./inspectors/HtmlInspector.vue";
import ImageInspector from "./inspectors/ImageInspector.vue";
import TableInspector from "./inspectors/TableInspector.vue";
import ParamsFields from "./inspectors/ParamsFields.vue";
import IssuesPanel from "./inspectors/IssuesPanel.vue";
// designer-ui.css 改由宿主 FormDesigner 统一引入（批次 4，2026-09-08）：
// 工具栏/左栏壳层也依赖这些类，不应挂在右侧面板上引入。

const props = withDefaults(
  defineProps<{
    /** 当前选中节点（Table 内派生节点不可选中，故为 null 时不渲染类型分支）。 */
    node: EditorNodeV2 | null;
    nodeId: string | null;
    /** 中文类型名（未选择时为「未选择」）。 */
    nodeType: string;
    cellContext: {
      rowIndex: number;
      columnIndex: number;
      hasNextSibling: boolean;
      canSplit: boolean;
    } | null;
    cellBox: { padding?: number; align?: string; verticalAlign?: string } | null;
    issues: SchemaIssueV2[];
    api: SchemaEdits;
    paperSize: "A4" | "A3";
    baseRowHeight: number;
    /** 四边边距（mm），独立配置；选中页面时取该页 margin，否则回退 12。 */
    paperMarginTop: number;
    paperMarginRight: number;
    paperMarginBottom: number;
    paperMarginLeft: number;
    /** 页眉配置（paper 级，透传给 PageInspector）。 */
    header?: HeaderFooterV2;
    /** 页脚配置（paper 级，透传给 PageInspector）。 */
    footer?: HeaderFooterV2;
  }>(),
  { node: null, nodeId: null },
);

/** 四边边距：选中页面节点时取其实际 margin（窄化到 PageSchemaV2），否则回退 12。 */
const pageMargins = computed(() => {
  const node = props.node;
  if (node && node.type === "page") {
    return {
      top: node.margin.top ?? 12,
      right: node.margin.right ?? 12,
      bottom: node.margin.bottom ?? 12,
      left: node.margin.left ?? 12,
    };
  }
  return { top: 12, right: 12, bottom: 12, left: 12 };
});

/** 分页开关（仅设计态生效）：双向绑定到宿主的 `paginate`。 */
const paginate = defineModel<boolean>("paginate", { required: true });

/**
 * 全局基础字号（px，已 resolve）：页面属性里的「基础字号」，即全局默认字号。
 * 由宿主 api 的 computed 解出（未设 → 引擎默认 13），透传给各 Inspector 作为
 * 「未显式设字号」的默认显示值 —— 保证面板所见 = 画布生效 = 分页估算。
 */
const baseFontSize = computed(() => props.api.baseFontSize.value);

const emit = defineEmits<{ selectIssue: [issue: SchemaIssueV2] }>();

/**
 * 当前选中的可读名称（面向普通用户，不显示内部 ID）：
 * 选中格子时附带行列位置（如「格子 1-2」），其余组件显示语义名称
 * （如 “单位” 文本、字段：unit）。
 */
const selectedLabel = computed(() => {
  const node = props.node;
  if (!node) return "未选择";
  if (node.type === "grid-cell" && props.cellContext) {
    const { rowIndex, columnIndex } = props.cellContext;
    if (rowIndex >= 0) return `格子 ${rowIndex + 1}-${columnIndex + 1}`;
  }
  return nodeLabel(node);
});
</script>

<template>
  <aside class="v2-sidebar v2-sidebar--right">
    <div class="v2-inspector-row">
      <span>组件类型</span>
      <strong>{{ nodeType }}</strong>
    </div>
    <div class="v2-inspector-row v2-inspector-row--head">
      <span>当前选中</span>
      <code>{{ selectedLabel }}</code>
    </div>

    <PageInspector
      v-if="node?.type === 'page'"
      v-model:paginate="paginate"
      :paper-size="paperSize"
      :base-row-height="baseRowHeight"
      :base-font-size="baseFontSize"
      :paper-margin-top="pageMargins.top"
      :paper-margin-right="pageMargins.right"
      :paper-margin-bottom="pageMargins.bottom"
      :paper-margin-left="pageMargins.left"
      :header="header"
      :footer="footer"
      :api="api"
    />
    <GridInspector v-else-if="node?.type === 'grid'" :node="node" :api="api" />
    <TextInspector
      v-else-if="node?.type === 'text'"
      :node="node"
      :base-font-size="baseFontSize"
      :api="api"
    />
    <FieldPInspector
      v-else-if="node?.type === 'p'"
      :node="node"
      :base-font-size="baseFontSize"
      :api="api"
    />
    <CellInspector
      v-else-if="node?.type === 'grid-cell'"
      :node="node"
      :cell-context="cellContext"
      :cell-box="cellBox"
      :api="api"
    />
    <HtmlInspector v-else-if="node?.type === 'html'" :node="node" :api="api" />
    <ImageInspector v-else-if="node?.type === 'image'" :node="node" :api="api" />
    <TableInspector
      v-else-if="node?.type === 'table'"
      :node="node"
      :base-font-size="baseFontSize"
      :api="api"
    />

    <!-- 通用「额外属性」（params）：挂在 SchemaNodeBaseV2 上，故**任何**可选中的节点都有；
         键值对渲染时作为 HTML 属性插到该节点根标签上，内核不解释其含义。 -->
    <ParamsFields v-if="node" :params="node.params" :api="api" />

    <IssuesPanel :issues="issues" @select="emit('selectIssue', $event)" />
  </aside>
</template>

<style scoped>
.v2-sidebar--right {
  border-right: 0;
  border-left: 1px solid #d8dee8;
}

.v2-inspector-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  color: #64748b;
  font-size: 12px;
}

.v2-inspector-row--head {
  position: sticky;
  top: 0;
  padding-bottom: 10px;
  border-bottom: 1px solid #e2e8f0;
  background: #ffffff;
}

.v2-inspector-row code {
  max-width: 150px;
  overflow: hidden;
  color: #334155;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
