<script setup lang="ts">
import { computed, ref } from "vue";
import FormRenderer from "@/components/renderer-v2/FormRenderer.vue";
import { collectFieldValues } from "@/components/renderer-v2/collectFieldValues";
import { makeYunlvSecondTicketFullSchema } from "@/dev/yunlv-second-ticket-full";
import { parseTolerantFormSchemaV2 } from "@/types";
import type { FormDataV2, FormSchemaV2 } from "@/types";
import signTableExport from "@/fixtures/formdesigner-schema-v2-sign-table.json";
import jinglingExport from "@/dev/金陵-第二种操作票.json";

/**
 * 消费页演示（G8 独立运行，最简形态）：schema → 渲染 / 填写 / 取数。
 * 只验证渲染内核可脱离设计器独立运行。设计页（FormDesigner）保持纯设计用途。
 *
 * `readonly` 是 `options` 里的字段（`FormRenderer` 无同名 prop）：显式 false 即「填写」态。
 *
 * URL 参数（缺省 = 金陵第二种操作票，2026-10-21）：
 * - `?schema=jingling`（缺省）：`src/dev/金陵-第二种操作票.json` —— 设计器真实导出的模板，
 *   可直接看版面 / 填值 / 取数；
 * - `?schema=yunlv`：云铝第二种工作票全工单（代码内构造的基线模板）；
 * - `?schema=sign-table`：切到「HTML 复杂表」——设计器**真实导出**的收工/开工签名时间表
 *   （36 格原生 `data-field`），用于验证 HTML 模块「能填 / 能取数 / 只读态能回显」；
 * - `?readonly=1`：以只读回显态打开，对照填写态看值是否照常显示。
 */
const SAMPLE_KEYS = ["jingling", "yunlv", "sign-table"] as const;
type SampleKey = (typeof SAMPLE_KEYS)[number];

/** 未知 / 缺省的 `?schema=` 一律回落到缺省模板，避免演示页白屏。 */
function resolveSample(raw: string | null): SampleKey {
  return raw && (SAMPLE_KEYS as readonly string[]).includes(raw)
    ? (raw as SampleKey)
    : "jingling";
}

const query = new URLSearchParams(window.location.search);
const sample = resolveSample(query.get("schema"));
const readonly = ref(query.get("readonly") === "1");

/** 导入的模板 / 数据（导入后优先于 `?schema=` 样例）。 */
const importedSchema = ref<FormSchemaV2 | null>(null);
const importedData = ref<FormDataV2 | null>(null);
/** 每次导入都换 key 强制重建渲染器：schema 与 data 一起换，避免沿用上一份的内部填写态。 */
const renderKey = ref(0);
/** 顶部标签：当前渲染的是哪份来源。 */
const sourceLabel = ref(`样例：${sample}`);
const importNote = ref("");

const schema = computed<FormSchemaV2 | null>(() => {
  if (importedSchema.value) return importedSchema.value;
  if (sample === "sign-table") return parseTolerantFormSchemaV2(signTableExport).schema;
  if (sample === "yunlv") return makeYunlvSecondTicketFullSchema();
  return parseTolerantFormSchemaV2(jinglingExport).schema;
});

const schemaFileInput = ref<HTMLInputElement | null>(null);
const dataFileInput = ref<HTMLInputElement | null>(null);

function readJsonFile(file: File): Promise<unknown> {
  return file.text().then((text) => JSON.parse(text) as unknown);
}

/**
 * 导入模板文件（设计器「导出文件」产出的 .json）：容错解析后替换当前 schema。
 * 模板一换，上一份的填写数据即失效，故同时清空数据并重建渲染器。
 */
async function onImportSchemaFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const parsed = parseTolerantFormSchemaV2(await readJsonFile(file));
    if (!parsed.schema) {
      throw new Error(
        parsed.issues.length > 0
          ? `模板不是合法的 V2 Schema（${parsed.issues[0]?.message ?? "未知问题"}）`
          : "模板不是合法的 V2 Schema",
      );
    }
    importedSchema.value = parsed.schema;
    importedData.value = null;
    renderKey.value += 1;
    sourceLabel.value = `导入文件：${file.name}`;
    importNote.value = parsed.issues.length > 0
      ? `已导入（${parsed.issues.length} 处容错修复）`
      : "已导入";
  } catch (error) {
    alert(`导入文件失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    input.value = "";
  }
}

/**
 * 导入数据文件（设计器「导出数据」产出的 .json，纯 `{字段: 值}` 对象）：
 * 作为 `data` 交给渲染器回显。数据键与模板不对应时只是不显示，不报错。
 */
async function onImportDataFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const parsed = await readJsonFile(file);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("数据文件应为 { 字段名: 值 } 的 JSON 对象");
    }
    importedData.value = parsed as FormDataV2;
    renderKey.value += 1;
    importNote.value = `已导入数据：${Object.keys(importedData.value).length} 项`;
    sourceLabel.value = `导入文件：${file.name} · 数据`;
  } catch (error) {
    alert(`导入数据失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    input.value = "";
  }
}

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
      <span class="preview-tag">{{ sourceLabel }}</span>
      <button type="button" @click="schemaFileInput?.click()">导入文件</button>
      <input
        ref="schemaFileInput"
        class="preview-file"
        type="file"
        accept=".json,application/json"
        @change="onImportSchemaFile"
      />
      <button type="button" @click="dataFileInput?.click()">导入数据</button>
      <input
        ref="dataFileInput"
        class="preview-file"
        type="file"
        accept=".json,application/json"
        @change="onImportDataFile"
      />
      <label class="preview-switch">
        <input v-model="readonly" type="checkbox" />
        只读回显（view）
      </label>
      <button type="button" @click="dumpState">取数：getFormData()</button>
      <button type="button" @click="dumpDom">取数：collectFieldValues()</button>
      <span v-if="importNote" class="preview-dump-label">{{ importNote }}</span>
      <span v-if="dumpLabel" class="preview-dump-label">{{ dumpLabel }}</span>
    </div>
    <pre v-if="dump" class="preview-dump">{{ dump }}</pre>
    <FormRenderer
      v-if="schema"
      :key="renderKey"
      ref="rendererRef"
      :schema="schema"
      :data="importedData"
      :options="{ readonly }"
    />
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

/* 两个「导入」按钮是文件选择器的触发器，原生 input 只在点按钮时被 click() 唤起 */
.preview-file {
  display: none;
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
