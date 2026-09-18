<script setup lang="ts">
/**
 * 页眉 / 页脚配置字段（header / footer 共用一份模板，靠 `kind` 选取对应更新动作）。
 *
 * MVP 范围：开关 / 左中右三栏文本（含 `{page}` `{total}` 占位符）/ 带高 /
 * 字号 / 粗细 / 颜色 / 分隔线 / 每页重复开关（关闭=仅首页显示）。
 * 字段绑定 `{field:key}`、logo、首页不同内容均不在本轮。
 */
import { computed } from "vue";
import { DEFAULT_BAND_HEIGHT_MM, type HeaderFooterV2 } from "@/types";
import type { SchemaEdits } from "../composables/useSchemaEdits";

const props = defineProps<{
  /** 段标题（页眉 / 页脚）。 */
  label: string;
  band: HeaderFooterV2 | undefined;
  kind: "header" | "footer";
  api: SchemaEdits;
  /** 当前纸张边距（mm，四边同值）：用于提示「带高不得超过边距」。 */
  margin?: number;
}>();

/** 按 kind 选取对应的更新动作（header / footer 两套 handler 由同一工厂生成）。 */
const onEnabled = computed(() =>
  props.kind === "header"
    ? props.api.updatePaperHeaderEnabled
    : props.api.updatePaperFooterEnabled,
);
const onContent = computed(() =>
  props.kind === "header"
    ? props.api.updatePaperHeaderContent
    : props.api.updatePaperFooterContent,
);
const onHeight = computed(() =>
  props.kind === "header"
    ? props.api.updatePaperHeaderHeight
    : props.api.updatePaperFooterHeight,
);
const onSeparator = computed(() =>
  props.kind === "header"
    ? props.api.updatePaperHeaderSeparator
    : props.api.updatePaperFooterSeparator,
);
const onRepeat = computed(() =>
  props.kind === "header"
    ? props.api.updatePaperHeaderRepeatOnEveryPage
    : props.api.updatePaperFooterRepeatOnEveryPage,
);
const onFontSize = computed(() =>
  props.kind === "header"
    ? props.api.updatePaperHeaderFontSize
    : props.api.updatePaperFooterFontSize,
);
const onFontWeight = computed(() =>
  props.kind === "header"
    ? props.api.updatePaperHeaderFontWeight
    : props.api.updatePaperFooterFontWeight,
);
const onColor = computed(() =>
  props.kind === "header"
    ? props.api.updatePaperHeaderColor
    : props.api.updatePaperFooterColor,
);

/** 未启用时不展开细节（避免配置了一堆却看不到效果）。 */
const active = computed(() => props.band?.enabled === true);
</script>

<template>
  <div class="v2-sidebar__subheading">{{ label }}</div>
  <label class="v2-control v2-control--toggle">
    <input
      type="checkbox"
      :checked="band?.enabled === true"
      @change="onEnabled"
    />
    <span>启用{{ label }}</span>
  </label>
  <template v-if="active">
    <label class="v2-control v2-control--inline">
      <span>左</span>
      <input
        type="text"
        :value="band?.content?.left ?? ''"
        placeholder="变量： {page} {total}"
        @change="onContent('left', $event)"
      />
    </label>
    <label class="v2-control v2-control--inline">
      <span>中</span>
      <input
        type="text"
        :value="band?.content?.center ?? ''"
        placeholder="变量： {page} {total}"
        @change="onContent('center', $event)"
      />
    </label>
    <label class="v2-control v2-control--inline">
      <span>右</span>
      <input
        type="text"
        :value="band?.content?.right ?? ''"
        placeholder="变量： {page} {total}"
        @change="onContent('right', $event)"
      />
    </label>
    <div class="v2-grid-dimensions">
      <label class="v2-control v2-control--inline">
        <span>高度(mm)</span>
        <input
          type="number"
          min="1"
          step="1"
          :value="band?.height ?? DEFAULT_BAND_HEIGHT_MM"
          @change="onHeight"
        />
      </label>
      <label class="v2-control v2-control--inline">
        <span>字号(px)</span>
        <input
          type="number"
          min="1"
          step="1"
          :value="band?.style?.fontSize ?? 12"
          @change="onFontSize"
        />
      </label>
    </div>
    <p
      v-if="band?.height != null && margin != null && band.height > margin"
      class="v2-hint"
      style="color: #b45309"
    >
      高度 {{ band.height }}mm 超过纸张边距 {{ margin }}mm：显示时已按边距
      收敛（页眉/页脚画在边距内，超出会压到正文、打印被裁切）。
    </p>
    <div class="v2-grid-dimensions">
      <label class="v2-control v2-control--inline">
        <span>粗细</span>
        <select
          :value="band?.style?.fontWeight ?? 'normal'"
          @change="onFontWeight"
        >
          <option value="normal">常规</option>
          <option value="bold">加粗</option>
        </select>
      </label>
      <label class="v2-control v2-control--inline">
        <span>颜色</span>
        <input
          type="color"
          :value="band?.style?.color ?? '#111827'"
          @change="onColor"
        />
      </label>
    </div>
    <label class="v2-control v2-control--toggle">
      <input
        type="checkbox"
        :checked="band?.separator !== false"
        @change="onSeparator"
      />
      <span>分隔线</span>
    </label>
    <label class="v2-control v2-control--toggle">
      <input
        type="checkbox"
        :checked="band?.repeatOnEveryPage !== false"
        @change="onRepeat"
      />
      <span>每页重复（关闭则仅首页显示）</span>
    </label>
  </template>
</template>
