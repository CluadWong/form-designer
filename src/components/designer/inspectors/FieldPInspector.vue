<script setup lang="ts">
/**
 * 字段 P：字段名 / 前后标签 / 点击触发开关 / 文本样式 / 默认值 / 宽度 / 内部边框。
 *
 * 「输入方式」下拉与「日期格式」输入框已于 2026-09-15 移除——控件类型是**开放集**
 * （date / time / date-time / 宿主自定义…），不该由内核闭枚举表达。字段改由面板底部的
 * 通用「额外属性」（`ParamsFields`，挂在 InspectorPanel 上）承载，如
 * `{ action: "datePicker", "date-format": "{YYYY}年{MM}月{DD}", "date-validate": "after:计划工作时间_1" }`；
 * 内核只把它当属性透传到标签上，**不解释键**。
 */
import type { FieldPNodeV2 } from "@/types";
import type { SchemaEdits } from "../composables/useSchemaEdits";
import TextStyleFields from "./TextStyleFields.vue";

defineProps<{ node: FieldPNodeV2; api: SchemaEdits }>();
</script>

<template>
  <label class="v2-control">
    <span>字段名</span>
    <input :value="node.field" @input="api.updateSelectedField" />
  </label>
  <div class="v2-grid-dimensions">
    <label class="v2-control">
      <span>前标签（可选）</span>
      <input :value="node.prefix ?? ''" @input="api.updateSelectedPrefix" />
    </label>
    <label class="v2-control">
      <span>后标签（可选）</span>
      <input :value="node.suffix ?? ''" @input="api.updateSelectedSuffix" />
    </label>
  </div>
  <label class="v2-control v2-control--toggle">
    <input
      type="checkbox"
      data-field-interactive="true"
      :checked="node.interactive ?? false"
      @change="api.updateSelectedInteractive"
    />
    <span>点击触发外部控件</span>
  </label>
  <TextStyleFields :style="node.style" :api="api" />
  <label class="v2-control v2-control--full">
    <span>默认内容</span>
    <textarea
      class="v2-textarea"
      rows="3"
      data-field-default="true"
      :value="node.default ?? ''"
      @input="api.updateSelectedDefault"
    ></textarea>
  </label>
  <div class="v2-grid-dimensions">
    <label class="v2-control v2-control--full">
      <span>输入区宽度</span>
      <input
        data-field-width="true"
        placeholder="如 30mm、50%，留空不限"
        :value="node.width ?? ''"
        @input="api.updateSelectedWidth"
      />
    </label>
    <label class="v2-control">
      <span>内部边框</span>
      <input
        type="checkbox"
        data-field-inner-border="true"
        :checked="node.innerBorder ?? false"
        @change="api.updateSelectedInnerBorder"
      />
    </label>
  </div>
</template>
