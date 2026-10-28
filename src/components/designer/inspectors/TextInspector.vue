<script setup lang="ts">
/** 固定文本节点：内容 + 文本样式。 */
import type { TextNodeV2 } from "@/types";
import type { SchemaEdits } from "../composables/useSchemaEdits";
import TextStyleFields from "./TextStyleFields.vue";

defineProps<{ node: TextNodeV2; api: SchemaEdits; baseFontSize?: number }>();
</script>

<template>
  <label class="v2-control v2-control--area">
    <span>文本内容</span>
    <textarea
      rows="3"
      :value="node.text"
      placeholder="固定文本"
      @input="api.updateSelectedText"
    ></textarea>
  </label>
  <TextStyleFields :style="node.style" :base-font-size="baseFontSize" :api="api" />
</template>
