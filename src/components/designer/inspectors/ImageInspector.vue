<script setup lang="ts">
/**
 * 图片列表：字段名 / 布局方式 + **水平对齐 + 垂直对齐** / 数量上限 + 填充方式 / 默认宽高 /
 * 是否显示名称 + 按 index 分行的图片地址列表。
 *
 * 尺寸有两档，**行内优先**：
 * 1. 行内 `images[i].width/height`（图中「图片地址」表格每行的宽高列）——精确到某一张；
 * 2. 节点级 `defaultWidth/defaultHeight`（本面板「默认宽 / 默认高」）——整组图的统一尺寸兜底，
 *    某行留空时吃默认值；两档都没有才按图片自身比例。
 *
 * 对齐有两个方向，**各管一个方向、可同时生效**（同名取值函数见 `derivation`）：
 * - 水平 `align`：垂直布局下每张图在容器内左 / 中 / 右，水平布局下整行内容左 / 中 / 右；
 *   未显式设置时按布局取默认（垂直居中、水平靠左）；
 * - 垂直 `verticalAlign`：垂直布局下整组内容顶 / 中 / 底，水平布局下每行顶 / 中 / 底；
 *   未显式设置时取默认 `top`（= 升级前的 CSS 默认）；
 * - 填充布局每行被撑满，两个对齐都不生效（面板仍显示、可配，便于切回其它布局时保留意图）。
 *
 * 列表行与字段值同构（`{ name, src, width, height }`）：`maxCount` 限制张数。
 * 模板行既是设计期占位，也是**样式预设**——数据里给了 `field` 的值时，按 index 与模板行
 * 逐字段合并（数据项没给宽高的，继承本面板配的宽高），故「宿主只回填地址」的图片
 * （如签名条）也能保持这里配好的尺寸。
 */
import { computed } from "vue";
import type { ImageAlignV2, ImageItemV2, ImageNodeV2, ImageVerticalAlignV2 } from "@/types";
import { resolveImageAlignV2, resolveImageVerticalAlignV2 } from "@/engine-v2/derivation";
import type { SchemaEdits } from "../composables/useSchemaEdits";

const props = defineProps<{ node: ImageNodeV2; api: SchemaEdits }>();

/** 至少显示一行（index 0）：新建节点即可直接填，不必先点「添加图片」。 */
const rows = computed<ImageItemV2[]>(() =>
  props.node.images && props.node.images.length > 0 ? props.node.images : [{}],
);

/** 当前生效的水平对齐（显式配置 → 否则按布局取默认），下拉框直接显示它。 */
const imageAlign = computed<ImageAlignV2>(() => resolveImageAlignV2(props.node));

/** 当前生效的垂直对齐（显式配置 → 否则默认 top），与画布同源。 */
const imageVerticalAlign = computed<ImageVerticalAlignV2>(() =>
  resolveImageVerticalAlignV2(props.node),
);
</script>

<template>
  <div class="v2-grid-dimensions">
    <label class="v2-control v2-control--full">
      <span>字段名</span>
      <input
        :value="node.field ?? ''"
        placeholder="字段"
        @input="api.updateSelectedImageField"
      />
    </label>
  </div>
  <div class="v2-grid-dimensions v2-grid-dimensions--triple">
    <label class="v2-control">
      <span>布局方式</span>
      <select
        data-image-layout="true"
        :value="node.layout ?? 'vertical'"
        @change="api.updateSelectedImageLayout"
      >
        <option value="vertical">垂直（一张一行）</option>
        <option value="horizontal">水平（并排一行）</option>
        <option value="fill">填充（自适应铺满）</option>
      </select>
    </label>
    <label class="v2-control">
      <span>水平对齐</span>
      <select
        data-image-align="true"
        :value="imageAlign"
        @change="api.updateSelectedImageAlign"
      >
        <option value="left">左对齐</option>
        <option value="center">居中</option>
        <option value="right">右对齐</option>
      </select>
    </label>
    <label class="v2-control">
      <span>垂直对齐</span>
      <select
        data-image-vertical-align="true"
        :value="imageVerticalAlign"
        @change="api.updateSelectedImageVerticalAlign"
      >
        <option value="top">顶对齐</option>
        <option value="middle">居中</option>
        <option value="bottom">底对齐</option>
      </select>
    </label>
  </div>
  <div class="v2-grid-dimensions">
    <label class="v2-control">
      <span>数量上限</span>
      <input
        type="number"
        min="0"
        step="1"
        data-image-max-count="true"
        :value="node.maxCount ?? ''"
        placeholder="0 = 不限"
        @change="api.updateSelectedImageMaxCount"
      />
    </label>
    <label class="v2-control">
      <span>填充方式</span>
      <select
        data-image-fit="true"
        :value="node.objectFit ?? 'contain'"
        @change="api.updateSelectedImageFit"
      >
        <option value="contain">等比完整显示</option>
        <option value="cover">裁剪填满</option>
        <option value="fill">拉伸填满</option>
      </select>
    </label>
  </div>
  <div class="v2-grid-dimensions">
    <label class="v2-control">
      <span>默认宽(mm)</span>
      <input
        type="number"
        min="0"
        step="1"
        data-image-default-width="true"
        :value="node.defaultWidth ?? node.width ?? ''"
        placeholder="自动"
        @change="api.updateSelectedImageDefaultSize('width', $event)"
      />
    </label>
    <label class="v2-control">
      <span>默认高(mm)</span>
      <input
        type="number"
        min="0"
        step="1"
        data-image-default-height="true"
        :value="node.defaultHeight ?? node.height ?? ''"
        placeholder="自动"
        @change="api.updateSelectedImageDefaultSize('height', $event)"
      />
    </label>
  </div>
  <label class="v2-control v2-control--toggle">
    <input
      type="checkbox"
      data-image-show-name="true"
      :checked="node.showName === true"
      @change="api.updateSelectedImageShowName"
    />
    <span>显示名称（图片下方的说明文字）</span>
  </label>

  <div class="v2-sidebar__subheading">图片地址</div>
  <p class="v2-sidebar__hint v2-sidebar__hint--tight">
    每行的宽 / 高优先于上方默认值；都留空则按图片自身比例。
  </p>
  <div class="v2-image-table" data-image-list="true">
    <div class="v2-image-table__grid">
      <div class="v2-image-table__row v2-image-table__head">
        <span class="v2-image-table__th">#</span>
        <span class="v2-image-table__th">名称</span>
        <span class="v2-image-table__th">地址</span>
        <span class="v2-image-table__th">宽(mm)</span>
        <span class="v2-image-table__th">高(mm)</span>
        <span class="v2-image-table__th"></span>
      </div>
      <div
        v-for="(item, index) in rows"
        :key="index"
        class="v2-image-table__row"
        :data-image-row="index"
      >
        <span class="v2-image-table__index">{{ index + 1 }}</span>
        <input
          class="v2-col-table__input"
          :value="item.name ?? ''"
          placeholder="名称（可选）"
          @input="api.updateSelectedImageItemName(index, $event)"
        />
        <input
          class="v2-col-table__input v2-col-table__input--mono"
          :value="item.src ?? ''"
          placeholder="https:// 链接或 Base64"
          @input="api.updateSelectedImageItemSrc(index, $event)"
        />
        <input
          class="v2-col-table__input v2-col-table__input--width"
          type="number"
          min="0"
          :value="item.width ?? ''"
          placeholder="如 40"
          @change="api.updateSelectedImageItemSize(index, 'width', $event)"
        />
        <input
          class="v2-col-table__input v2-col-table__input--width"
          type="number"
          min="0"
          :value="item.height ?? ''"
          placeholder="如 40"
          @change="api.updateSelectedImageItemSize(index, 'height', $event)"
        />
        <button
          class="v2-inspector__delete v2-inspector__delete--small"
          type="button"
          :title="`删除第 ${index + 1} 张`"
          @click="api.removeSelectedImageItem(index)"
        >
          ✕
        </button>
      </div>
    </div>
  </div>
  <button
    class="v2-toolbar__button v2-add-col"
    type="button"
    @click="api.addSelectedImageItem"
  >
    + 添加图片
  </button>
</template>
