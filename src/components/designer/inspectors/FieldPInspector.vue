<script setup lang="ts">
/**
 * 字段 P：字段名 / 前后标签 / 值类型 / 文本样式 / 默认值 / 宽度 / 内部边框。
 *
 * 「值类型」（2026-09-29）：`text`（缺省，按文本渲染）或 `image`（按图片地址渲染为
 * **坐落在下划线上**的 `<img>`）——后者用于电子签名：宿主经 `params.action`（落到字段
 * 标签属性上）识别签名栏并弹签名框、回填图片地址，票面直接贴到线上，空值仍显示下划线
 * （「签名：____」空态占位）。
 *
 * 2026-10-28 布局改版：
 * - 前后标签**各占一整行**（标签可能很长，如「（签字）日期：」，并排两列时输入框会被挤到
 *   只剩几个字宽）；
 * - 「值类型」从面板末尾提到基本信息之后：它是开关，决定下面哪些配置生效（默认内容 /
 *   初始行数只在文本值下有意义，图片高度 / 间距 / 上限只在图片值下有意义）；
 * - 单位改后缀（初始行数 → 行），布尔项改为占整行的右侧开关。
 */
import { computed } from "vue";
import type { FieldPNodeV2 } from "@/types";
import type { SchemaEdits } from "../composables/useSchemaEdits";
import HelpLink from "./HelpLink.vue";
import TextStyleFields from "./TextStyleFields.vue";

const props = defineProps<{ node: FieldPNodeV2; api: SchemaEdits; baseFontSize?: number }>();

/** 图片值形态（电子签名）：只有显式选中才是——缺省即文本。 */
const isImageValue = computed(() => props.node.valueType === "image");

/**
 * 面板里的签名图尺寸只认 mm（2026-10-28）：schema 存的是 CSS 长度字符串（`10mm` / `2mm`），
 * 面板显示数值、单位做后缀。显式 `Xmm` → 数值；其它单位（历史 `1.6em` 等）或未设 → 空，
 * 由 placeholder 表达「用默认」——不在面板上臆造换算式，避免所见与生效值不一致。
 */
function mmValueOf(length: string | undefined): string {
  const hit = length?.trim().match(/^(\d+(?:\.\d+)?)mm$/i);
  return hit ? hit[1] : "";
}

const imageHeightMm = computed(() => mmValueOf(props.node.imageHeight));
const signGapMm = computed(() => mmValueOf(props.node.gap));
</script>

<template>
  <label class="v2-control">
    <span>字段名</span>
    <input :value="node.field" @input="api.updateSelectedField" />
  </label>
  <label class="v2-control">
    <span>前标签</span>
    <input
      :value="node.prefix ?? ''"
      placeholder="如「单位：」"
      @input="api.updateSelectedPrefix"
    />
  </label>
  <label class="v2-control">
    <span>后标签</span>
    <input
      :value="node.suffix ?? ''"
      placeholder="如「元」"
      @input="api.updateSelectedSuffix"
    />
  </label>

  <div class="v2-sidebar__subheading v2-sidebar__subheading--row">
    <span>值类型</span>
    <span class="v2-subheading__actions">
      <HelpLink section="sign" hint="查看电子签名怎么配" />
    </span>
  </div>
  <label class="v2-control">
    <span>渲染为</span>
    <select
      data-field-value-type="true"
      :value="node.valueType ?? 'text'"
      @change="api.updateSelectedValueType"
    >
      <option value="text">文本</option>
      <option value="image">图片（电子签名）</option>
    </select>
  </label>
  <label v-if="!isImageValue" class="v2-control v2-control--area">
    <span>默认内容</span>
    <textarea
      data-field-default="true"
      rows="2"
      :value="node.default ?? ''"
      placeholder="填写时的初始内容（可选）"
      @input="api.updateSelectedDefault"
    ></textarea>
  </label>
  <!-- 图片值（电子签名）专属：高度留空与标签文字行盒等高；多人签名时值传数组，
       多张在下划线上并排、超宽自动换行，下列两项只影响多张时的排布。 -->
  <div v-if="isImageValue" class="v2-grid-dimensions">
    <label class="v2-control">
      <span>图片高度</span>
      <span class="v2-unit" title="留空 = 与标签文字等高（1.6em，随纸张基础字号自适应）">
        <input
          data-field-image-height="true"
          type="number"
          min="0"
          step="0.5"
          placeholder="默认"
          :value="imageHeightMm"
          @change="api.updateSelectedImageHeight"
        />
        <span>mm</span>
      </span>
    </label>
    <label class="v2-control">
      <span>多图间距</span>
      <span class="v2-unit" title="留空 = 默认间距（0.5em，约 1.7mm）">
        <input
          data-field-image-gap="true"
          type="number"
          min="0"
          step="0.5"
          placeholder="默认"
          :value="signGapMm"
          @change="api.updateSelectedSignGap"
        />
        <span>mm</span>
      </span>
    </label>
  </div>
  <label v-if="isImageValue" class="v2-control">
    <span>数量上限</span>
    <span class="v2-unit">
      <input
        data-field-image-max-count="true"
        type="number"
        min="1"
        placeholder="留空不限"
        :value="node.maxCount ?? ''"
        @input="api.updateSelectedSignMaxCount"
      />
      <span>张</span>
    </span>
  </label>

  <TextStyleFields :style="node.style" :base-font-size="baseFontSize" :api="api" />

  <div class="v2-sidebar__subheading">盒</div>
  <!-- 初始行数（2026-10-27）：空值就占 N 行，输入内容超出后**继续长高**（不是固定高度）。
       此前多行只能靠「默认内容」里回车撑，而默认值是初始内容，一输入就被整体替换 → 掉回一行。 -->
  <label v-if="!isImageValue" class="v2-control">
    <span>初始行数</span>
    <span class="v2-unit">
      <input
        type="number"
        min="1"
        step="1"
        data-field-rows="true"
        placeholder="留空 = 1 行"
        :value="node.rows ?? ''"
        @change="api.updateSelectedRowCount"
      />
      <span>行</span>
    </span>
  </label>
  <!-- 输入区宽度接受自由写法（30mm / 50% / 留空不限），故不加固定单位后缀 -->
  <label class="v2-control">
    <span>输入区宽度</span>
    <input
      data-field-width="true"
      placeholder="留空不限，如 30mm、50%"
      :value="node.width ?? ''"
      @input="api.updateSelectedWidth"
    />
  </label>
  <label class="v2-control v2-control--switch">
    <span>内部边框</span>
    <input
      type="checkbox"
      data-field-inner-border="true"
      :checked="node.innerBorder ?? false"
      @change="api.updateSelectedInnerBorder"
    />
  </label>
</template>
