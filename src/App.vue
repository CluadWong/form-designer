<script setup lang="ts">
/**
 * 应用根组件（dev 入口）
 *
 * 设计器核心不依赖 `dev` 样例目录（B3）：样例由本 dev 入口通过 props 注入，
 * 生产/消费端可传入自己的样例集，无需改动 `FormDesigner`。
 * 预览态不注入预置数据（2026-09-08）：点击「预览」进入空表单，数据经填写/导入产生。
 */

import FormDesigner from "@/components/designer/FormDesigner.vue";
import type { SampleEntry } from "@/samples/types";
import type { DesignerUIConfig } from "@/components/designer/config";

// 正式版隐藏「载入完整工作票」样例入口（内部演示/调试用，不参与发布）。
const samples: SampleEntry[] = [];
const config: DesignerUIConfig = {
  locale: "zh-CN",
};
</script>

<template>
  <FormDesigner :samples="samples" :ui-config="config" />
</template>
