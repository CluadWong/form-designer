<script setup lang="ts">
/**
 * 属性面板里的「?」上下文帮助入口（2026-10-28）。
 *
 * 挂在分组标题右侧，点击打开操作指南并直接定位到对应小节 —— 目标是让用户**不用通读指南**
 * 也能在遇到某个配置项时就地查到解释。
 *
 * 缺省注入（`InspectorPanel` 被单独挂载时）不渲染：宁可不出现，也不给一个点了没反应的按钮。
 */
import { inject } from "vue";
import { HELP_OPEN_KEY } from "../help-anchor";

const openHelp = inject(HELP_OPEN_KEY, null);

defineProps<{
  /** 操作指南里的小节 id（见 HelpPanel 的 HELP_SECTIONS）。 */
  section: string;
  /** 悬停提示，缺省为「查看操作指南」。 */
  hint?: string;
}>();

function onOpen(section: string): void {
  openHelp?.(section);
}
</script>

<template>
  <button
    v-if="openHelp"
    class="v2-help-link"
    type="button"
    :title="hint ?? '查看操作指南'"
    :data-help-link="section"
    @click.stop.prevent="onOpen(section)"
  >
    ?
  </button>
</template>
