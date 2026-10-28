<script setup lang="ts">
/**
 * 节点「额外属性」（`SchemaNodeBaseV2.params`）编辑器。
 *
 * 权责：这里只负责把设计态写下的键值交给 schema；**内核不解释任何键**——渲染时由
 * `src/utils/node-params.ts` 过滤后作为 HTML 属性插到节点根标签上，语义完全归宿主
 * （如 `action="datePicker"`、`date-validate="after:计划工作时间_1"`）。
 *
 * 2026-10-28 改版：
 * - 频次低但入口要顺手：**默认展开**（点标题行可折叠，caret 指示状态），新增入口挂在
 *   标题右侧「+ 新增」，不再让一整行 30px 大按钮常驻在每个面板底部；
 * - 键值表回到 3 列（属性名 / 值 / 删除）：旧模板是 4 列（`1fr 1fr 88px 32px`）而实际只有
 *   3 个单元格，右侧恒留 32px 空列、删除按钮不贴右；
 * - 说明文字仍不常驻，仅出现会被内核丢弃的键时给红字。
 */
import { computed, ref } from "vue";
import type { NodeParamsV2 } from "@/types";
import type { SchemaEdits } from "../composables/useSchemaEdits";
import HelpLink from "./HelpLink.vue";
import { isParamNameAllowed } from "@/utils/node-params";

const props = defineProps<{ params?: NodeParamsV2; api: SchemaEdits }>();

/** 属性名列表（保持 params 的插入顺序，与渲染/导出一致）。 */
const keys = computed(() => Object.keys(props.params ?? {}));

/** 是否存在会被内核丢弃的键 → 决定是否显示红字警示（唯一的常驻文案来源）。 */
const hasRejected = computed(() => keys.value.some((key) => !isParamNameAllowed(key)));

/** 展开态：默认展开（2026-10-28 按用户要求改回常显，仍可点标题行折叠）。 */
const expanded = ref(true);

function addParam(): void {
  expanded.value = true;
  props.api.addSelectedParam();
}
</script>

<template>
  <div class="v2-sidebar__subheading v2-sidebar__subheading--row">
    <button
      class="v2-section-toggle"
      :class="{ 'v2-section-toggle--collapsed': !expanded }"
      type="button"
      :aria-expanded="expanded"
      title="键值对会作为 HTML 属性插到该组件的标签上（如 action=&quot;datePicker&quot;）；内核不解释这些属性，怎么消费由宿主决定。"
      @click="expanded = !expanded"
    >
      <span class="v2-section-toggle__caret">▼</span>
      <span>额外属性</span>
      <span v-if="keys.length" class="v2-section-toggle__count">{{ keys.length }}</span>
    </button>
    <span class="v2-subheading__actions">
      <HelpLink section="attr" hint="查看额外属性的说明" />
      <button
        class="v2-subheading__action"
        type="button"
        data-param-add="true"
        title="添加一条额外属性"
        @click="addParam"
      >
        + 新增
      </button>
    </span>
  </div>
  <div v-show="expanded" class="v2-col-table" data-node-params="true">
    <div class="v2-col-table__row v2-col-table__head">
      <span class="v2-col-table__th">属性名</span>
      <span class="v2-col-table__th">值</span>
      <span class="v2-col-table__th v2-col-table__th--action"></span>
    </div>
    <div v-for="key in keys" :key="key" class="v2-col-table__row">
      <input
        class="v2-col-table__input v2-col-table__input--mono"
        :class="{ 'v2-col-table__input--invalid': !isParamNameAllowed(key) }"
        data-param-key="true"
        placeholder="如 action"
        :value="key"
        @change="api.renameSelectedParam(key, $event)"
      />
      <input
        class="v2-col-table__input"
        data-param-value="true"
        placeholder="如 datePicker"
        :value="params?.[key] ?? ''"
        @input="api.updateSelectedParamValue(key, $event)"
      />
      <button
        class="v2-inspector__delete v2-inspector__delete--small"
        type="button"
        :title="`删除属性 ${key}`"
        @click="api.removeSelectedParam(key)"
      >
        ✕
      </button>
    </div>
    <p v-if="!keys.length" class="v2-col-table__empty">暂无属性 · 键值对会透传到标签上</p>
  </div>
  <p v-if="hasRejected" class="v2-hint v2-hint--warn">
    红字属性名不会被渲染：内核会丢弃 <code>on*</code>（事件）与 <code>data-*</code>（节点寻址），
    以及 <code>class</code> / <code>style</code> / <code>field</code> 等保留名；属性名须全小写，
    仅含小写字母、数字、<code>-</code>、<code>_</code>。
  </p>
</template>
