<script setup lang="ts">
/**
 * 文本样式字段组（text / p 共用）：字号 / 行高 / 粗细 / 颜色 / 对齐。
 *
 * 2026-10-28 改版：
 * - 「字体」项移除（字体族统一由宿主决定，面板不再暴露一个写 `font-family` 的自由文本）；
 * - 单位从标签移入输入框后缀（「字号(px)」→「字号」+ px），标签只剩纯名词；
 * - 颜色由撑满整行的 26px 纯色条改成「22px 色块 + 等宽 hex」，不再压过其他配置；
 * - 对齐从「标签在上」的两列块改为同一行两格（面板每行 28px）。
 */
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
 * 用户改动时才经 `@change` 落值。
 */
</script>

<template>
  <div class="v2-sidebar__subheading">文本样式</div>
  <div class="v2-grid-dimensions">
    <label class="v2-control v2-control--inline">
      <span>字号</span>
      <span class="v2-unit">
        <input
          type="number"
          min="1"
          step="1"
          :value="style?.fontSize ?? baseFontSize ?? DEFAULT_TEXT_FONT_SIZE_PX"
          @change="api.updateSelectedFontSize"
        />
        <span>px</span>
      </span>
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
  </div>
  <div class="v2-grid-dimensions">
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
      <span class="v2-color">
        <input
          type="color"
          :value="style?.color ?? '#111827'"
          @input="api.updateSelectedColor"
        />
        <span class="v2-color__hex">{{ style?.color ?? "#111827" }}</span>
      </span>
    </label>
  </div>
  <div class="v2-grid-dimensions">
    <label class="v2-control v2-control--inline">
      <span>水平对齐</span>
      <select :value="style?.align ?? 'left'" @change="api.updateSelectedAlign">
        <option value="left">左</option>
        <option value="center">居中</option>
        <option value="right">右</option>
      </select>
    </label>
    <label class="v2-control v2-control--inline">
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
  </div>
</template>
