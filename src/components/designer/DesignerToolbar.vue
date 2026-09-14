<script setup lang="ts">
/**
 * 顶部工具栏（批次 3 壳层拆件，2026-09-08）：**纯展示 + 事件上抛**，不持有文档状态。
 * - 样例集 / dirty / 撤销重做可用性 / 预览态由宿主（FormDesigner 编排层）注入；
 * - 一切动作（保存/读取/导入导出/打印/帮助…）经 emit 回宿主编排层执行；
 * - 「导出数据」「保存数据」**不限预览态**（设计态同样能采集字段与值，无字段即 `{}`）。
 * - 两个隐藏 file input 留在宿主（`useSchemaDocument` / `useFillData` 直接持有其 ref），
 *   不随工具栏下放；`.v2-toolbar` 基础样式在非 scoped `styles/designer-ui.css`。
 * - `data-view-mode` / `data-help-toggle` 为测试钩子，拆件时必须原样保留。
 */
import { computed } from "vue";
import type { SampleEntry } from "@/samples/types";
import { resolveDesignerUIConfig, type DesignerUIConfig } from "./config";
import { t } from "@/i18n";

const props = defineProps<{
  /** 可载入样例集（B3 注入，正式版可为空数组）。 */
  samples?: SampleEntry[];
  /** 模板脏标记（左上「未保存 / 已保存」）。 */
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** 预览态：决定预览按钮激活态与文案（填充数据组的导出/保存已不限预览态）。 */
  previewMode: boolean;
  /** 全局 UI 配置（设计页可见性开关），缺省见 `defaultDesignerUIConfig`。 */
  uiConfig?: Partial<DesignerUIConfig>;
}>();

/** 合并全局默认后的完整 UI 配置，模板按 `cfg.showXxx` 控制模块显隐。 */
const cfg = computed(() => resolveDesignerUIConfig(props.uiConfig));

/** 配置驱动取文案：显式传入解析后的语言（`cfg.locale`），确定性、可测，
 *  不依赖全局单例（Vitest 下 SFC 与测试可能持有不同模块实例）。 */
function tl(key: string): string {
  return t(key, undefined, cfg.value.locale);
}

const emit = defineEmits<{
  (e: "reset-blank"): void;
  (e: "load-sample", sample: SampleEntry): void;
  (e: "undo"): void;
  (e: "redo"): void;
  (e: "save-template"): void;
  (e: "load-template"): void;
  (e: "export-template"): void;
  (e: "import-template"): void;
  (e: "import-fill-data"): void;
  (e: "export-fill-data"): void;
  (e: "load-fill-data"): void;
  (e: "save-fill-data"): void;
  (e: "toggle-preview"): void;
  (e: "print"): void;
  (e: "help"): void;
}>();
</script>

<template>
  <header class="v2-toolbar">
    <span
      class="v2-toolbar__dirty"
      :class="{ 'v2-toolbar__dirty--on': dirty }"
      >{{ dirty ? tl("toolbar.dirty") : tl("toolbar.saved") }}</span
    >
    <div v-if="cfg.showNewBlank || cfg.showSamples" class="v2-toolbar__group">
      <button
        v-if="cfg.showNewBlank"
        class="v2-toolbar__button"
        type="button"
        @click="emit('reset-blank')"
      >
        {{ tl("toolbar.newBlank") }}
      </button>
      <template v-if="cfg.showSamples">
        <button
          v-for="sample in samples"
          :key="sample.id"
          class="v2-toolbar__button"
          type="button"
          @click="emit('load-sample', sample)"
        >
          {{ tl("toolbar.loadSamplePrefix") }}{{ sample.label }}
        </button>
      </template>
    </div>
    <div v-if="cfg.showUndoRedo" class="v2-toolbar__group">
      <button
        class="v2-toolbar__button"
        type="button"
        :disabled="!canUndo"
        @click="emit('undo')"
      >
        {{ tl("toolbar.undo") }}
      </button>
      <button
        class="v2-toolbar__button"
        type="button"
        :disabled="!canRedo"
        @click="emit('redo')"
      >
        {{ tl("toolbar.redo") }}
      </button>
    </div>
    <div v-if="cfg.showTemplateModule" class="v2-toolbar__group">
      <span class="v2-toolbar__label">{{ tl("toolbar.module.template") }}</span>
      <button
        class="v2-toolbar__button"
        type="button"
        @click="emit('save-template')"
      >
        {{ tl("toolbar.saveTemplate") }}
      </button>
      <button
        class="v2-toolbar__button"
        type="button"
        @click="emit('load-template')"
      >
        {{ tl("toolbar.loadTemplate") }}
      </button>
      <button
        class="v2-toolbar__button"
        type="button"
        @click="emit('export-template')"
      >
        {{ tl("toolbar.exportTemplate") }}
      </button>
      <button
        class="v2-toolbar__button"
        type="button"
        @click="emit('import-template')"
      >
        {{ tl("toolbar.importTemplate") }}
      </button>
    </div>
    <div v-if="cfg.showFillDataModule" class="v2-toolbar__group">
      <span class="v2-toolbar__label">{{ tl("toolbar.module.fillData") }}</span>
      <button
        class="v2-toolbar__button"
        type="button"
        :title="tl('toolbar.saveFillDataTip')"
        @click="emit('save-fill-data')"
      >
        {{ tl("toolbar.saveFillData") }}
      </button>
      <button
        class="v2-toolbar__button"
        type="button"
        :title="tl('toolbar.loadFillDataTip')"
        @click="emit('load-fill-data')"
      >
        {{ tl("toolbar.loadFillData") }}
      </button>
      <button
        class="v2-toolbar__button"
        type="button"
        data-export-fill-data
        :title="tl('toolbar.exportFillDataTip')"
        @click="emit('export-fill-data')"
      >
        {{ tl("toolbar.exportFillData") }}
      </button>
      <button
        class="v2-toolbar__button"
        type="button"
        :title="tl('toolbar.importFillDataTip')"
        @click="emit('import-fill-data')"
      >
        {{ tl("toolbar.importFillData") }}
      </button>
    </div>
    <div v-if="cfg.showPreviewPrint || cfg.showHelp" class="v2-toolbar__group">
      <button
        v-if="cfg.showPreviewPrint"
        class="v2-toolbar__button"
        type="button"
        data-view-mode="preview"
        :class="{ 'v2-toolbar__button--active': previewMode }"
        :title="tl('toolbar.previewTip')"
        @click="emit('toggle-preview')"
      >
        {{ previewMode ? tl("toolbar.exitPreview") : tl("toolbar.preview") }}
      </button>
      <button
        v-if="cfg.showPreviewPrint"
        class="v2-toolbar__button"
        type="button"
        @click="emit('print')"
      >
        {{ tl("toolbar.print") }}
      </button>
      <button
        v-if="cfg.showHelp"
        class="v2-toolbar__button"
        type="button"
        data-help-toggle
        :title="tl('toolbar.helpTip')"
        @click="emit('help')"
      >
        {{ tl("toolbar.help") }}
      </button>
    </div>
  </header>
</template>

<style scoped>
.v2-toolbar__dirty {
  padding: 1px 8px;
  border-radius: 10px;
  color: #94a3b8;
  background: rgb(255 255 255 / 8%);
  font-size: 11px;
}

.v2-toolbar__dirty--on {
  color: #fde68a;
  background: rgb(253 230 138 / 18%);
}

.v2-toolbar__label {
  align-self: center;
  margin-right: 2px;
  font-size: 12px;
  color: #9fb3c8;
}
</style>
