<script setup lang="ts">
/** 文本样式字段组（text / p 共用）：字号 / 行高 / 粗细 / 颜色 / 对齐 / 字体。 */
import type { TextStyleV2 } from "@/types";
import type { SchemaEdits } from "../composables/useSchemaEdits";
// 生效默认值取自引擎常量（单一真源），与渲染层 `.layout-p` / `.layout-text` 的
// CSS（`font-size: var(--v2-base-font-size, 13px); line-height: 1.6`）及 `pagination.ts`
// 的高度估算一致。字号默认值优先用**页面属性的基础字号**（`baseFontSize` prop），
// 常量仅在未传时兜底。
import { DEFAULT_TEXT_FONT_SIZE_PX, DEFAULT_TEXT_LINE_HEIGHT } from "@/engine-v2/derivation";

defineProps<{
  style?: TextStyleV2;
  api: SchemaEdits;
  /**
   * 全局基础字号（px，页面属性里「基础字号」的生效值）：本节点未显式设 `fontSize` 时，
   * 面板显示的默认字号就是它 —— 与渲染层纸张上的 `--v2-base-font-size` 同源。
   * 未传（如单测直接挂载）→ 回退引擎常量 13。
   */
  baseFontSize?: number;
}>();

/**
 * schema 刻意**不落**这些默认值（`style` 缺省即用引擎/CSS 默认，见 `useSchemaEdits`
 * 的「空/非法→undefined」契约），故此处只在面板把它们**显示**出来，不写回 schema；
 * 用户改动时才经 `@change` 落值。此前面板对这几项渲染为空白，与已显示默认的
 * select（`?? 'normal'` 等）不一致。
 */
</script>

<template>
  <div class="v2-sidebar__subheading">文本样式</div>
  <div class="v2-style-grid">
    <label class="v2-control v2-control--inline">
      <span>字号(px)</span>
      <input
        type="number"
        min="1"
        step="1"
        :value="style?.fontSize ?? baseFontSize ?? DEFAULT_TEXT_FONT_SIZE_PX"
        @change="api.updateSelectedFontSize"
      />
    </label>
    <label class="v2-control v2-control--inline">
      <span>行高</span>
      <input
        type="number"
        min="0"
        step="0.1"
        :value="style?.lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT"
        @change="api.updateSelectedLineHeight"
      />
    </label>
    <label class="v2-control v2-control--inline">
      <span>粗细</span>
      <select
        :value="style?.fontWeight ?? 'normal'"
        @change="api.updateSelectedFontWeight"
      >
        <option value="normal">常规</option>
        <option value="bold">加粗</option>
      </select>
    </label>
    <label class="v2-control v2-control--inline">
      <span>颜色</span>
      <input
        type="color"
        :value="style?.color ?? '#111827'"
        @input="api.updateSelectedColor"
      />
    </label>
  </div>
  <div class="v2-grid-dimensions">
    <label class="v2-control">
      <span>水平对齐</span>
      <select :value="style?.align ?? 'left'" @change="api.updateSelectedAlign">
        <option value="left">左</option>
        <option value="center">居中</option>
        <option value="right">右</option>
      </select>
    </label>
    <label class="v2-control">
      <span>垂直对齐</span>
      <select
        :value="style?.verticalAlign ?? 'middle'"
        @change="api.updateSelectedVerticalAlign"
      >
        <option value="top">顶部</option>
        <option value="middle">居中</option>
        <option value="bottom">底部</option>
      </select>
    </label>
    <label class="v2-control v2-control--full">
      <span>字体</span>
      <input
        :value="style?.fontFamily ?? ''"
        placeholder="默认（继承宿主字体）"
        @input="api.updateSelectedFontFamily"
      />
    </label>
  </div>
</template>
