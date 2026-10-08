<script setup lang="ts">
/**
 * 字段 P：字段名 / 前后标签 / 值类型 / 文本样式 / 默认值 / 宽度 / 内部边框。
 *
 * 「值类型」（2026-09-29）：`text`（缺省，按文本渲染）或 `image`（按图片地址渲染为
 * **坐落在下划线上**的 `<img>`）——后者用于电子签名：宿主经 `params.action`（落到字段
 * 标签属性上）识别签名栏并弹签名框、回填图片地址，票面直接贴到线上，空值仍显示下划线
 * （「签名：____」空态占位）。
 * 选「图片」时才出现下面三项配置，切回「文本」会连同它们一起清掉。
 * **高度留空即与标签（文字行盒）等高**（渲染层取 `1.6em`，随纸张基础字号自适应：
 * 13px → 5.5mm、16px → 6.77mm），图与标签水平并排、底边压在下划线上；需要更大的
 * 签名条（如贴满整行的 10mm）才需显式填写。
 *
 * 多人签名（2026-09-30）：`data[field]` 传**数组**即为多张——多张在同一条下划线上并排、
 * 超出可用宽度**自动换行**（「多人签名：___________」）。故另给两项只影响多张的配置：
 * 「多图间距」（`gap`，留空 0.5em）与「数量上限」（`maxCount`，留空不限）。
 *
 * 「输入方式」下拉与「日期格式」输入框已于 2026-09-15 移除——控件类型是**开放集**
 * （date / time / date-time / 宿主自定义…），不该由内核闭枚举表达。字段改由面板底部的
 * 通用「额外属性」（`ParamsFields`，挂在 InspectorPanel 上）承载，如
 * `{ action: "datePicker", "date-format": "{YYYY}年{MM}月{DD}", "date-validate": "after:计划工作时间_1" }`；
 * 内核只把它当属性透传到标签上，**不解释键**。
 */
import { computed } from "vue";
import type { FieldPNodeV2 } from "@/types";
import type { SchemaEdits } from "../composables/useSchemaEdits";
import TextStyleFields from "./TextStyleFields.vue";

const props = defineProps<{ node: FieldPNodeV2; api: SchemaEdits; baseFontSize?: number }>();

/** 图片值形态（电子签名）：只有显式选中才是——缺省即文本。 */
const isImageValue = computed(() => props.node.valueType === "image");
</script>

<template>
  <label class="v2-control">
    <span>字段名</span>
    <input :value="node.field" @input="api.updateSelectedField" />
  </label>
  <div class="v2-grid-dimensions">
    <label class="v2-control">
      <span>前标签（可选）</span>
      <input
        :value="node.prefix ?? ''"
        placeholder="如「单位：」"
        @input="api.updateSelectedPrefix"
      />
    </label>
    <label class="v2-control">
      <span>后标签（可选）</span>
      <input
        :value="node.suffix ?? ''"
        placeholder="如「元」"
        @input="api.updateSelectedSuffix"
      />
    </label>
  </div>
  <TextStyleFields :style="node.style" :base-font-size="baseFontSize" :api="api" />
  <label class="v2-control v2-control--full">
    <span>默认内容</span>
    <textarea
      class="v2-textarea"
      rows="3"
      data-field-default="true"
      :value="node.default ?? ''"
      placeholder="填写时的初始内容（可选）"
      @input="api.updateSelectedDefault"
    ></textarea>
  </label>
  <div class="v2-grid-dimensions">
    <label class="v2-control v2-control--full">
      <span>输入区宽度</span>
      <input
        data-field-width="true"
        placeholder="如 30mm、50%，留空不限"
        :value="node.width ?? ''"
        @input="api.updateSelectedWidth"
      />
    </label>
    <label class="v2-control">
      <span>内部边框</span>
      <input
        type="checkbox"
        data-field-inner-border="true"
        :checked="node.innerBorder ?? false"
        @change="api.updateSelectedInnerBorder"
      />
    </label>
  </div>
  <div class="v2-grid-dimensions">
    <label class="v2-control">
      <span>值类型</span>
      <select
        data-field-value-type="true"
        :value="node.valueType ?? 'text'"
        @change="api.updateSelectedValueType"
      >
        <option value="text">文本</option>
        <option value="image">图片（电子签名）</option>
      </select>
    </label>
    <label v-if="isImageValue" class="v2-control">
      <span>图片高度</span>
      <input
        data-field-image-height="true"
        placeholder="如 10mm；留空与标签等高"
        :value="node.imageHeight ?? ''"
        @input="api.updateSelectedImageHeight"
      />
    </label>
  </div>
  <!-- 多人签名（2026-09-30）：值传数组即为多张。`data[field] = ["url1", "url2"]`，
       多张在下划线上并排、超宽自动换行；下列两项只影响多张时的排布。 -->
  <div v-if="isImageValue" class="v2-grid-dimensions">
    <label class="v2-control">
      <span>多图间距</span>
      <input
        data-field-image-gap="true"
        placeholder="如 2mm；留空 0.5em"
        :value="node.gap ?? ''"
        @input="api.updateSelectedSignGap"
      />
    </label>
    <label class="v2-control">
      <span>数量上限</span>
      <input
        data-field-image-max-count="true"
        type="number"
        min="1"
        placeholder="留空不限"
        :value="node.maxCount ?? ''"
        @input="api.updateSelectedSignMaxCount"
      />
    </label>
  </div>
</template>
