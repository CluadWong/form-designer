<script setup lang="ts">
/**
 * 左侧栏（批次 3 壳层拆件，2026-09-08）：组件零件库 + 结构树，纯展示 + 事件上抛。
 * - 拖拽 MIME 写入仍由宿主 `startPaletteDrag` 完成（`PALETTE_DRAG_MIME` 是内核常量，
 *   落点判定在表面层 CanvasSurface，见 A6），本组件只转发 dragstart；
 * - 结构树的全局折叠/展开信号由宿主 provide（`TreeControlKey`），NodeTreeItem 经
 *   inject 接收，provide/inject 跨层级生效，本组件只转发「折叠全部/展开全部」点击；
 * - **定位**（2026-09-11）：画布点选节点后，宿主置 `focusId` 并自增 `focusToken`，
 *   祖先链的展开由各 `NodeTreeItem` 自行处理；**滚动到可见**只能由本组件做（只有它
 *   持有 `.v2-tree` 容器）。折叠态下目标行不在 DOM 里，故滚动前先 `nextTick` 等
 *   展开渲染完成，未命中时再等一轮；
 * - `data-palette` 为测试/落点钩子，原样保留；`.v2-sidebar` 基础样式在非 scoped
 *   `styles/designer-ui.css`。
 */
import { nextTick, ref, watch } from "vue";
import NodeTreeItem from "./NodeTreeItem.vue";
import type { TreeNode } from "./NodeTreeItem.vue";
import type { NodeKind } from "./composables/useSchemaEdits";
import { scrollRowIntoView } from "./composables/treeControl";

const props = defineProps<{
  /** 统一编辑闸门（C1）：非设计态零件库禁用、删除按钮禁用。 */
  editable: boolean;
  /** 删除按钮完整禁用态（含 page/grid-cell 不可删判定），由宿主计算。 */
  canRemove: boolean;
  nodeTree: TreeNode[];
  selectedNodeId: string | null;
}>();

const treeRef = ref<HTMLElement | null>(null);
const sidebarRef = ref<HTMLElement | null>(null);

/**
 * 结构树里 `id` 对应的行元素。用 `data-tree-node-id` 而**不是** `data-node-id`
 * —— 后者是画布内核的节点寻址属性（`NODE_ID_ATTR`），两侧同名会让 `[data-node-id]`
 * 查询在侧栏与画布间歧义（测试里 `find` 会先命中侧栏行）。节点 id 不做选择器转义，
 * 直接按 dataset 比对。
 */
function findRow(id: string): HTMLElement | null {
  const tree = treeRef.value;
  if (!tree) return null;
  const rows = tree.querySelectorAll<HTMLElement>("[data-tree-node-id]");
  for (const row of Array.from(rows)) {
    if (row.dataset.treeNodeId === id) return row;
  }
  return null;
}

/**
 * 把选中行滚进视野。滚动分两级：先在 `.v2-tree`（自身 `overflow:auto`）内就近滚动，
 * 再确保结构树整块在 `.v2-sidebar` 视野内（侧栏也可能出现滚动条）。用就近算法而非
 * `scrollIntoView`，避免连环滚动整个页面。
 */
function revealSelectedRow(id: string | null): void {
  if (!id) return;
  const row = findRow(id);
  if (!row) return;
  if (treeRef.value) scrollRowIntoView(treeRef.value, row);
  if (sidebarRef.value && treeRef.value) scrollRowIntoView(sidebarRef.value, treeRef.value);
}

watch(
  () => props.selectedNodeId,
  async (id) => {
    if (!id) return;
    await nextTick();
    if (!findRow(id)) await nextTick();
    revealSelectedRow(id);
  },
);

const emit = defineEmits<{
  (e: "add-node", kind: NodeKind): void;
  (e: "add-grid"): void;
  (e: "palette-drag", kind: NodeKind, event: DragEvent): void;
  (e: "select", id: string): void;
  (e: "remove-selected"): void;
  (e: "collapse-all"): void;
  (e: "expand-all"): void;
}>();
</script>

<template>
  <aside ref="sidebarRef" class="v2-sidebar v2-sidebar--left">
    <div class="v2-sidebar__group-title">基础组件</div>
    <button
      class="v2-palette-item v2-palette-item--button"
      type="button"
      draggable="true"
      data-palette="text"
      :disabled="!editable"
      @dragstart="emit('palette-drag', 'text', $event)"
      @click="emit('add-node', 'text')"
    >
      文本
    </button>
    <button
      class="v2-palette-item v2-palette-item--button"
      type="button"
      draggable="true"
      data-palette="field"
      :disabled="!editable"
      @dragstart="emit('palette-drag', 'field', $event)"
      @click="emit('add-node', 'field')"
    >
      输入框
    </button>
    <button
      class="v2-palette-item v2-palette-item--button"
      type="button"
      draggable="true"
      data-palette="image"
      :disabled="!editable"
      @dragstart="emit('palette-drag', 'image', $event)"
      @click="emit('add-node', 'image')"
    >
      图片
    </button>
    <button
      class="v2-palette-item v2-palette-item--button"
      type="button"
      draggable="true"
      data-palette="html"
      :disabled="!editable"
      @dragstart="emit('palette-drag', 'html', $event)"
      @click="emit('add-node', 'html')"
    >
      HTML 模块
    </button>

    <div class="v2-sidebar__group-title">布局组件</div>
    <button
      class="v2-palette-item v2-palette-item--button"
      type="button"
      draggable="true"
      data-palette="grid"
      :disabled="!editable"
      @dragstart="emit('palette-drag', 'grid', $event)"
      @click="emit('add-grid')"
    >
      网格
    </button>
    <button
      class="v2-palette-item v2-palette-item--button"
      type="button"
      draggable="true"
      data-palette="table"
      :disabled="!editable"
      @dragstart="emit('palette-drag', 'table', $event)"
      @click="emit('add-node', 'table')"
    >
      表格
    </button>

    <div class="v2-sidebar__heading v2-sidebar__heading--tree v2-tree-head">
      <span>结构</span>
      <button
        class="v2-tree__delete"
        type="button"
        :disabled="!canRemove"
        :title="editable ? '删除选中的组件' : '预览状态下不可编辑结构'"
        @click="emit('remove-selected')"
      >
        删除
      </button>
    </div>
    <div ref="treeRef" class="v2-tree">
      <NodeTreeItem
        v-for="root in nodeTree"
        :key="root.id"
        :node="root"
        :selected-id="selectedNodeId"
        :depth="0"
        @select="emit('select', $event)"
      />
    </div>
    <div class="v2-tree__buttons">
      <button type="button" class="v2-tree__btn" @click="emit('collapse-all')">
        折叠全部
      </button>
      <button type="button" class="v2-tree__btn" @click="emit('expand-all')">
        展开全部
      </button>
    </div>
  </aside>
</template>

<style scoped>
.v2-sidebar__heading {
  margin-bottom: 14px;
  color: #334155;
  font-size: 13px;
  font-weight: 700;
}

.v2-sidebar__heading--tree {
  margin-top: 16px;
  margin-bottom: 8px;
  padding-top: 12px;
  border-top: 1px solid #e2e8f0;
}

/* 结构行：标题居左、删除按钮靠右（节点删除按钮从右侧 Inspector 移入此处） */
.v2-tree-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.v2-tree__delete {
  padding: 3px 8px;
  border: 1px solid #fca5a5;
  border-radius: 4px;
  color: #b91c1c;
  background: #fff7f7;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.v2-tree__delete:hover:not(:disabled) {
  background: #fee2e2;
}

.v2-tree__delete:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 结构树底部：折叠全部 / 展开全部 */
.v2-tree__buttons {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.v2-tree__btn {
  flex: 1 1 0;
  padding: 5px 0;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  color: #334155;
  background: #f8fafc;
  font-size: 12px;
  cursor: pointer;
}

.v2-tree__btn:hover {
  background: #eef2f7;
}

.v2-tree {
  max-height: 42vh;
  overflow: auto;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 4px 2px;
  background: #fcfdff;
}

.v2-palette-item {
  display: block;
  width: 100%;
  margin-bottom: 8px;
  padding: 9px 10px;
  border: 1px solid #d8dee8;
  border-radius: 4px;
  color: #334155;
  background: #f8fafc;
  font-size: 12px;
}

.v2-palette-item--button {
  text-align: left;
  cursor: pointer;
}

.v2-palette-item--button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.v2-sidebar__group-title {
  margin: 16px 0 8px;
  padding-left: 8px;
  border-left: 3px solid #2563eb;
  color: #1e293b;
  font-size: 12px;
  font-weight: 700;
}
.v2-sidebar__group-title:first-child {
  margin-top: 0;
}
</style>
