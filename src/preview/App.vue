<script setup lang="ts">
import FormRenderer from "@/components/renderer-v2/FormRenderer.vue";
import { makeYunlvSecondTicketFullSchema } from "@/dev/yunlv-second-ticket-full";

/**
 * 消费页演示（G8 独立运行，最简形态）：schema → 渲染，
 * 只验证渲染内核可脱离设计器独立运行。
 * 设计页（FormDesigner）保持纯设计用途。
 *
 * `readonly` 是 `options` 里的字段（`FormRenderer` 无同名 prop）：默认 true（只读回显），
 * 这里显式设为 false 进入「填写」态，便于在本页手动点字段验证 `field-activate` 触发。
 */
const schema = makeYunlvSecondTicketFullSchema();
</script>

<template>
  <div class="preview-page">
    <FormRenderer :schema="schema" :options="{ readonly: false }" />
  </div>
</template>

<style>
.preview-page {
  font-family: system-ui, sans-serif;
}
</style>
