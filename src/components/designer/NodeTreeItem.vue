<script setup lang="ts">
import { ref, watch, inject } from "vue";
import { TreeControlKey, treeContainsId, type TreeControl } from "./composables/treeControl";

export interface TreeNode {
  id: string;
  type: string;
  label: string;
  children: TreeNode[];
}

defineOptions({ name: "NodeTreeItem" });

const props = defineProps<{
  node: TreeNode;
  selectedId: string | null;
  depth: number;
}>();

const emit = defineEmits<{ (event: "select", id: string): void }>();

/** 全局折叠/展开信号（由 FormDesigner 经 provide 下发）。 */
const control = inject<TreeControl | null>(TreeControlKey, null);
/**
 * 局部展开态：默认展开。若处于全局信号管控下，新节点以当前 `target` 作为
 * 初始态（「折叠全部」后再挂载的节点也应为折叠态）；挂载后受 `token` 驱动
 * 重设，同时仍允许单独点击 `onToggle` 脱离全局信号。
 */
const expanded = ref(control ? control.target.value : true);

if (control) {
  watch(control.token, () => {
    expanded.value = control.target.value;
  });
  /**
   * 定位展开：画布点选（或问题面板定位）后，`focusToken` 自增。若待定位节点
   * 落在自己子树内就展开自己 —— 目标行被折叠隐藏时无法滚动定位，必须先展开
   * 整条祖先链（每层祖先由各自的实例负责展开）。
   *
   * `immediate`：折叠态下子节点是**未挂载**的（`v-if="expanded"`），祖先展开后
   * 它们才挂载，此时 `focusToken` 已经变过、watch 不会再触发。故挂载瞬间也要
   * 判一次，让展开沿祖先链逐层传递下去。「折叠全部 / 展开全部」会把 `focusId`
   * 清空，所以 `immediate` 不会让已折叠的树被旧焦点复活。
   */
  watch(
    control.focusToken,
    () => {
      if (treeContainsId(props.node, control.focusId.value)) expanded.value = true;
    },
    { immediate: true },
  );
}

function onRowClick(): void {
  emit("select", props.node.id);
}

function onToggle(): void {
  expanded.value = !expanded.value;
}
</script>

<template>
  <div class="v2-tree-node">
    <div
      class="v2-tree-row"
      :class="{ 'v2-tree-row--selected': node.id === selectedId }"
      :style="{ paddingLeft: `${depth * 14 + 6}px` }"
      :data-tree-node-id="node.id"
      @click="onRowClick"
    >
      <button
        v-if="node.children.length"
        class="v2-tree-toggle"
        type="button"
        @click.stop="onToggle"
      >
        {{ expanded ? "▾" : "▸" }}
      </button>
      <span v-else class="v2-tree-dot">·</span>
      <span class="v2-tree-label">{{ node.label }}</span>
      <span class="v2-tree-type">{{ node.type }}</span>
    </div>
    <div v-if="expanded && node.children.length" class="v2-tree-children">
      <NodeTreeItem
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :selected-id="selectedId"
        :depth="depth + 1"
        @select="emit('select', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.v2-tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px 3px 6px;
  font-size: 12px;
  line-height: 1.5;
  color: #334155;
  cursor: pointer;
  border-radius: 3px;
  user-select: none;
}

.v2-tree-row:hover {
  background: #f1f5f9;
}

.v2-tree-row--selected {
  background: #dbeafe;
  color: #1d4ed8;
  font-weight: 600;
}

.v2-tree-toggle {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: transparent;
  color: #64748b;
  font-size: 10px;
  line-height: 16px;
  cursor: pointer;
}

.v2-tree-dot {
  flex: 0 0 auto;
  width: 16px;
  text-align: center;
  color: #cbd5e1;
}

.v2-tree-label {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.v2-tree-type {
  flex: 0 0 auto;
  font-size: 10px;
  color: #94a3b8;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 3px;
  padding: 0 4px;
}
</style>
