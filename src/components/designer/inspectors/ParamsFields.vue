<script setup lang="ts">
/**
 * 节点「额外属性」（`SchemaNodeBaseV2.params`）编辑器。
 *
 * 交互与样式**对齐表格的「列配置」**（同一个 `.v2-col-table`，样式在
 * `styles/designer-ui.css`）：键 / 值 / 删除 三列 + 下方「+ 添加属性」。
 *
 * 权责：这里只负责把设计态写下的键值交给 schema；**内核不解释任何键**——渲染时由
 * `src/utils/node-params.ts` 过滤后作为 HTML 属性插到节点根标签上，语义完全归宿主
 * （如 `action="datePicker"`、`date-validate="after:计划工作时间_1"`）。
 * 因此面板对**会被内核过滤掉**的键给出即时反馈（红字 + 提示），避免「写了却没生效」。
 *
 * 说明文字**不常驻**（与表格「列配置」一致：列配置也没有常驻说明，避免每个节点的面板都多一行灰字）；
 * 仅在出现会被丢弃的键时给出红字警示，其余靠子标题 `title` 与输入框 placeholder 传达。
 */
import { computed } from "vue";
import type { NodeParamsV2 } from "@/types";
import type { SchemaEdits } from "../composables/useSchemaEdits";
import { isParamNameAllowed } from "@/utils/node-params";

const props = defineProps<{ params?: NodeParamsV2; api: SchemaEdits }>();

/** 属性名列表（保持 params 的插入顺序，与渲染/导出一致）。 */
const keys = computed(() => Object.keys(props.params ?? {}));

/** 是否存在会被内核丢弃的键 → 决定是否显示红字警示（唯一的常驻文案来源）。 */
const hasRejected = computed(() => keys.value.some((key) => !isParamNameAllowed(key)));
</script>

<template>
  <div
    class="v2-sidebar__subheading"
    title="键值对会作为 HTML 属性插到该组件的标签上（如 action=&quot;datePicker&quot;）；内核不解释这些属性，怎么消费由宿主决定。"
  >
    额外属性
  </div>
  <div class="v2-col-table" data-node-params="true">
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
  </div>
  <button
    class="v2-toolbar__button v2-add-col"
    type="button"
    data-param-add="true"
    @click="api.addSelectedParam"
  >
    + 添加属性
  </button>
  <p v-if="hasRejected" class="v2-hint v2-hint--warn">
    红字属性名不会被渲染：内核会丢弃 <code>on*</code>（事件）与 <code>data-*</code>（节点寻址），
    以及 <code>class</code> / <code>style</code> / <code>field</code> 等保留名；属性名须全小写，
    仅含小写字母、数字、<code>-</code>、<code>_</code>。
  </p>
</template>
