<script setup lang="ts">
import { computed, ref } from "vue";
import FormRenderer from "@/components/renderer-v2/FormRenderer.vue";
import { collectFieldValues } from "@/components/renderer-v2/collectFieldValues";
import { makeYunlvSecondTicketFullSchema } from "@/dev/yunlv-second-ticket-full";
import { parseTolerantFormSchemaV2 } from "@/types";
import type { FormDataV2 } from "@/types";
import signTableExport from "@/fixtures/formdesigner-schema-v2-sign-table.json";

/**
 * 消费页演示（G8 独立运行，最简形态）：schema → 渲染 / 填写 / 取数。
 * 只验证渲染内核可脱离设计器独立运行。设计页（FormDesigner）保持纯设计用途。
 *
 * `readonly` 是 `options` 里的字段（`FormRenderer` 无同名 prop）：显式 false 即「填写」态。
 *
 * URL 参数（缺省 = 云铝第二种工作票全工单）：
 * - `?schema=sign-table`：切到「HTML 复杂表」——设计器**真实导出**的收工/开工签名时间表
 *   （36 格原生 `data-field`），用于验证 HTML 模块「能填 / 能取数 / 只读态能回显」；
 * - `?readonly=1`：以只读回显态打开，对照填写态看值是否照常显示。
 */
const query = new URLSearchParams(window.location.search);
const sample = query.get("schema") === "sign-table" ? "sign-table" : "yunlv";
const readonly = ref(query.get("readonly") === "1");

const schema = computed(() =>
  sample === "sign-table"
    ? parseTolerantFormSchemaV2(signTableExport).schema
    : makeYunlvSecondTicketFullSchema(),
);

const rendererRef = ref<InstanceType<typeof FormRenderer> | null>(null);
const dumpLabel = ref("");
const dump = ref("");

/** 取数一：响应式数据（只含被改动过的键）——「只存用户填了什么」口径。 */
function dumpState(): void {
  const data: FormDataV2 = rendererRef.value?.getFormData?.() ?? {};
  dumpLabel.value = `getFormData() · ${Object.keys(data).length} 项`;
  dump.value = JSON.stringify(data, null, 2);
}

/** 取数二：遍历渲染 DOM（含全部绑定键，未填为空串）——「导出完整表单」口径。 */
function dumpDom(): void {
  const el: unknown = rendererRef.value?.$el;
  const data = el instanceof HTMLElement ? collectFieldValues(el) : {};
  dumpLabel.value = `collectFieldValues() · ${Object.keys(data).length} 项`;
  dump.value = JSON.stringify(data, null, 2);
}
</script>

<template>
  <div class="preview-page">
    <div class="preview-bar">
      <span class="preview-tag">样例：{{ sample }}</span>
      <label class="preview-switch">
        <input v-model="readonly" type="checkbox" />
        只读回显（view）
      </label>
      <button type="button" @click="dumpState">取数：getFormData()</button>
      <button type="button" @click="dumpDom">取数：collectFieldValues()</button>
      <span v-if="dumpLabel" class="preview-dump-label">{{ dumpLabel }}</span>
    </div>
    <pre v-if="dump" class="preview-dump">{{ dump }}</pre>
    <FormRenderer v-if="schema" ref="rendererRef" :schema="schema" :options="{ readonly }" />
    <p v-else class="preview-error">Schema 解析失败（issues 见控制台）。</p>
  </div>
</template>

<style>
.preview-page {
  font-family: system-ui, sans-serif;
}

.preview-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  padding: 8px 12px;
  font-size: 13px;
  background: #f1f5f9;
  border-bottom: 1px solid #cbd5e1;
}

.preview-bar button {
  font: inherit;
  padding: 4px 10px;
  cursor: pointer;
}

.preview-tag,
.preview-dump-label {
  color: #334155;
}

.preview-dump {
  margin: 0;
  padding: 8px 12px;
  max-height: 200px;
  overflow: auto;
  font-size: 12px;
  background: #0f172a;
  color: #e2e8f0;
}

.preview-error {
  color: #b91c1c;
}
</style>
