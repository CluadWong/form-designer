<script setup lang="ts">
/** HTML 模块：片段 + 模块内 CSS（Shadow DOM 隔离）。 */
import type { HtmlNodeV2 } from "@/types";
import type { SchemaEdits } from "../composables/useSchemaEdits";

defineProps<{ node: HtmlNodeV2; api: SchemaEdits }>();
</script>

<template>
  <label class="v2-control v2-control--full">
    <span>HTML 片段（不含脚本）</span>
    <textarea
      class="v2-textarea"
      rows="6"
      :value="node.html"
      placeholder="如 &lt;p&gt;客户签字：&lt;/p&gt;（可用字段占位符）"
      @input="api.updateSelectedHtml"
    ></textarea>
  </label>
  <label class="v2-control v2-control--full">
    <span>样式代码（仅模块内生效）</span>
    <textarea
      class="v2-textarea"
      rows="4"
      :value="node.css ?? ''"
      placeholder="如 .box { border: 1px solid #333; }"
      @input="api.updateSelectedCss"
    ></textarea>
  </label>
  <p class="v2-sidebar__hint" v-pre>
    支持 {{ 字段 }} 占位符，展示时自动替换为填写内容；样式仅在模块内部生效，不影响整张表单。
  </p>
</template>
