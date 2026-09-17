<script setup lang="ts">
/** 图片：地址 / 数据字段 / 尺寸 / 填充方式。 */
import type { ImageNodeV2 } from "@/types";
import type { SchemaEdits } from "../composables/useSchemaEdits";

defineProps<{ node: ImageNodeV2; api: SchemaEdits }>();
</script>

<template>
  <div class="v2-grid-dimensions">
    <label class="v2-control v2-control--full">
      <span>字段名</span>
      <input
        :value="node.field ?? ''"
        placeholder="绑定数据字段（可选）"
        @input="api.updateSelectedImageField"
      />
    </label>
    <label class="v2-control v2-control--full">
      <span>图片地址</span>
      <input
        :value="node.src ?? ''"
        placeholder="https:// 链接或 Base64"
        @input="api.updateSelectedImageSrc"
      />
    </label>
  </div>
  <div class="v2-grid-dimensions">
    <label class="v2-control">
      <span>宽(mm)</span>
      <input
        type="number"
        min="0"
        :value="node.width ?? ''"
        placeholder="如 40"
        @change="api.updateSelectedImageSize('width', $event)"
      />
    </label>
    <label class="v2-control">
      <span>高(mm)</span>
      <input
        type="number"
        min="0"
        :value="node.height ?? ''"
        placeholder="如 40"
        @change="api.updateSelectedImageSize('height', $event)"
      />
    </label>
  </div>
  <label class="v2-control">
    <span>填充方式</span>
    <select
      :value="node.objectFit ?? 'contain'"
      @change="api.updateSelectedImageFit"
    >
      <option value="contain">等比完整显示</option>
      <option value="cover">裁剪填满</option>
      <option value="fill">拉伸填满</option>
    </select>
  </label>
  <p v-if="!node.src && !node.field" class="v2-sidebar__hint">
    还没配置图片地址：画布上会显示占位框方便编辑，<strong>打印时不占位置</strong>。
  </p>
</template>
