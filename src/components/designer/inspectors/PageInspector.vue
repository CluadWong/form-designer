<script setup lang="ts">
/** 页面设置：纸张 / 四边边距 / 基础行高 / 基础字号 / 分页开关 / 页眉 / 页脚（Inspector 组件化，2026-09-07 批次 2）。 */
import type { FormSchemaV2, HeaderFooterV2 } from "@/types";
import { FONT_SIZE_MAX_PX, FONT_SIZE_MIN_PX } from "@/types";
import type { SchemaEdits } from "../composables/useSchemaEdits";
import HeaderFooterFields from "./HeaderFooterFields.vue";

defineProps<{
  paperSize: FormSchemaV2["paper"]["size"];
  baseRowHeight: number;
  /**
   * 全局基础字号（px，已 resolve）：未设时即引擎默认 13。
   * 设为后作用于**所有未单独设字号**的文字（正文 / 字段 / 表格内容），
   * 表格表头按其与正文的既有比例（16/13）等比跟随。
   */
  baseFontSize: number;
  /** 四边边距（mm），独立配置。 */
  paperMarginTop: number;
  paperMarginRight: number;
  paperMarginBottom: number;
  paperMarginLeft: number;
  /** 页眉（paper 级全局配置，作用于所有物理页）。 */
  header?: HeaderFooterV2;
  /** 页脚（paper 级全局配置，作用于所有物理页）。 */
  footer?: HeaderFooterV2;
  api: SchemaEdits;
}>();

const paginate = defineModel<boolean>("paginate", { required: true });
</script>

<template>
  <div class="v2-sidebar__subheading">页面设置</div>
  <label class="v2-control v2-control--inline">
    <span>纸张类型</span>
    <select :value="paperSize" @change="api.updatePaperSize">
      <option value="A4">A4（纵向）</option>
      <option value="A3">A3（横向）</option>
    </select>
  </label>
  <div class="v2-grid-dimensions">
    <label class="v2-control v2-control--inline">
      <span>上边距(mm)</span>
      <input
        type="number"
        min="0"
        max="99"
        step="1"
        :value="paperMarginTop"
        @change="api.updatePaperMarginSide('top', $event)"
      />
    </label>
    <label class="v2-control v2-control--inline">
      <span>右边距(mm)</span>
      <input
        type="number"
        min="0"
        max="99"
        step="1"
        :value="paperMarginRight"
        @change="api.updatePaperMarginSide('right', $event)"
      />
    </label>
    <label class="v2-control v2-control--inline">
      <span>下边距(mm)</span>
      <input
        type="number"
        min="0"
        max="99"
        step="1"
        :value="paperMarginBottom"
        @change="api.updatePaperMarginSide('bottom', $event)"
      />
    </label>
    <label class="v2-control v2-control--inline">
      <span>左边距(mm)</span>
      <input
        type="number"
        min="0"
        max="99"
        step="1"
        :value="paperMarginLeft"
        @change="api.updatePaperMarginSide('left', $event)"
      />
    </label>
  </div>
  <div class="v2-grid-dimensions">
    <label class="v2-control v2-control--inline">
      <span>行高(mm)</span>
      <input
        type="number"
        min="0.1"
        max="99"
        step="0.1"
        :value="baseRowHeight"
        @change="api.updateBaseRowHeight"
      />
    </label>
    <!-- 全局默认字号：设定后作用于所有未单独设字号的文字；表格表头按 16/13 等比跟随。
         面板显示的是「生效值」（未设 = 13），写回 schema 的只有用户实际改过的值。

         绑定 `@change`（失焦 / 回车提交），与面板其余数值输入保持一致。
         本项曾一度改绑 `@input`（逐键提交），依据是「拖拽起手不会让输入框失焦、`change`
         不触发 → 值被静默丢弃」这一推断；该推断**未经浏览器验证**，且实际改回 `@change`
         后可正常跟随（点击 palette 项与拖拽起手的 mousedown 都会让输入框失焦），故恢复。
         低于下限的输入（如想输 20 时的中间态 "2"）由 `updateBaseFontSize` 挡掉并回写生效值。 -->
    <label class="v2-control v2-control--inline">
      <span>基础字号(px)</span>
      <input
        type="number"
        :min="FONT_SIZE_MIN_PX"
        :max="FONT_SIZE_MAX_PX"
        step="1"
        data-base-font-size="true"
        :value="baseFontSize"
        @change="api.updateBaseFontSize"
      />
    </label>
  </div>
  <label class="v2-control v2-control--toggle">
    <input v-model="paginate" type="checkbox" data-paginate="true" />
    <span>分页显示（仅影响编辑画面，打印始终分页）</span>
  </label>
  <HeaderFooterFields
    label="页眉"
    kind="header"
    :band="header"
    :margin="paperMarginTop"
    :api="api"
  />
  <HeaderFooterFields
    label="页脚"
    kind="footer"
    :band="footer"
    :margin="paperMarginBottom"
    :api="api"
  />
</template>
