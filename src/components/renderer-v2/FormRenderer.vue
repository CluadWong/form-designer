<script setup lang="ts">
import { computed, ref, watch, type ComponentPublicInstance } from "vue";
import type {
  FieldActivateV2,
  FieldPermissionV2,
  FieldRuleV2,
  FormDataV2,
  FormSchemaV2,
} from "@/types";
import { findEmptyRequiredFields } from "@/engine-v2/derivation";
import GridFormRenderer from "./GridFormRenderer.vue";
import PaperViewport from "./PaperViewport.vue";
import { printForm } from "./print-form";

/**
 * 消费页渲染形态选项（G8 / G10）。
 *
 * 设计态与消费态由**两个正交轴**区分（同一套渲染内核 `GridFormRenderer`）：
 * - `isDesign`（内核 `mode="design"`，仅设计器内）：可编辑组件（表面层负责）+ 字段可就地输入看交互效果（不回写 schema）；
 * - `readonly`（消费态闸门）：消费页不编辑组件，字段是否可输入由 `readonly` 全局控制，**默认 true（只读回显）**，
 *   显式传 `false` 即进入「填写」——这正是 `FormRenderer` 这里唯一的输入控制。
 *
 * 因此 `FormRenderer` 不需要 `preview` / `fill` 这类模式区分：它永远是消费态（非 design），
 * 对内统一传固定的非设计 `mode` 给内核，对外只暴露 `readonly` 与 `getFormData`。
 */
export interface FormRendererOptions {
  /** 无外壳：去掉灰底纸张画布，便于嵌入消费页中部（G8 / G10）。 */
  bare?: boolean;
  /**
   * 启用纸张视口缩放（浏览 / 移动端查看）：包一层可平移缩放的视口。
   * 启用时强制 `bare`（缩放态由视口管理，内核画布不再自带滚动/灰底），
   * 缩放条与滚轮 / 双指捏合由视口提供；打印时缩放被 `@media print` 复位，走真实 mm。
   */
  zoom?: boolean;
  /**
   * 缩放视口挂载后自动适应宽度（窄屏 / 移动端查看场景）。仅当 `zoom` 为真时生效。
   * 默认 false（保持 100%）；窄屏传 true 可让表单自动铺满视口宽度。
   */
  fitOnMount?: boolean;
  /**
   * 只读闸门（与内核 `mode` **正交**）：默认 **true** —— 消费页默认只读回显（仅浏览详情）。
   * 设为 false 即进入「填写」态，字段可输入（契合「预览即消费模板、输入数据以配合业务流程流转」）。
   * 设计态的「不回写 schema 的就地输入」是另一回事（内核 `mode="design"`，由设计器控制），与此无关。
   */
  readonly?: boolean;
  /**
   * 字段级运行时权限（P9.2a / P9.2b）：与 `data` 同轨经 props 注入、不进 schema。
   * `{ 字段名: "READ" | "EDIT" | "HIDDEN" }`——EDIT=可输入（缺省）、READ=只读回显、
   * HIDDEN=脱敏显示（输入内容以 `***` 替代，占位与前后标签保留；真实值不进 DOM，
   * `collectFieldValues` 跳过该字段，`getFormData` 仍返回真实值）。
   * 未注明的字段一律 EDIT，向后兼容。
   */
  fieldPermissions?: Record<string, FieldPermissionV2>;
  /**
   * 字段级校验规则（P9.2c）：与 `data` / `fieldPermissions` 同轨经 props 注入、不进
   * schema。`{ 字段名: { required: true } }`——经 `validate()` 对当前数据做必填校验，
   * 返回值为空的字段名数组（空数组 = 全部通过）。后续可扩展更多规则。
   */
  rules?: Record<string, FieldRuleV2>;
}

/**
 * 公共渲染入口（G8）：消费页引用渲染器的唯一公开组件。
 *
 * 设计器（FormDesigner）仍直接引用内核 `GridFormRenderer`（并包 `CanvasSurface` 负责组件编辑）；
 * 本组件是在内核之上收敛出的「消费页友好」包装——props 收敛为 `schema / data / options`，
 * 不暴露任何设计器私有状态（`selectedNodeId` / 拖拽态 / `node-drag-start`），从而可被独立引用与库化。
 *
 * 消费页典型流程：拿到 JSON 字符串 → `parseTolerantFormSchemaV2(json).schema` →
 * `<FormRenderer :schema="schema" v-model:data="data" />`（只读回显）；
 * 需要录入时 `<FormRenderer :schema="schema" :options="{ readonly: false }" v-model:data="data" />`。
 */
const props = withDefaults(
  defineProps<{
    /** 设计器导出的 Schema（消费页由 json + 容错解析得到）。 */
    schema: FormSchemaV2;
    /** 字段数据；缺省为空（显示静态内容或 default）。 */
    data?: FormDataV2 | null;
    /** 渲染形态选项（G8 / G10：bare / zoom / fitOnMount / readonly）。 */
    options?: FormRendererOptions;
  }>(),
  { options: () => ({}) },
);

const emit = defineEmits<{
  (e: "field-change", field: string, value: string): void;
  (e: "update:data", data: FormDataV2): void;
  (e: "field-activate", payload: FieldActivateV2): void;
}>();

// 内部持有 data，使填写态输入可回写并被消费页 v-model:data 接管。
const data = ref<FormDataV2>({ ...(props.data ?? {}) });
watch(
  () => props.data,
  (next) => {
    data.value = { ...(next ?? {}) };
  },
);

// 消费态只读闸门：默认 true（只读回显），显式 readonly:false → 可填写。与内核 mode 正交。
const readonly = computed(() => props.options?.readonly ?? true);
// FormRenderer 永远是消费态（非 design），内核只需知道不是 design。
const renderMode = "preview" as const;

/**
 * G15（A4）契约化：内核（GridFormRenderer → GridSchemaNode）在填写态 emit `field-change`，
 * 此处统一收口——写回内部响应式 data 并 re-emit `field-change` / `update:data`，
 * 使消费页用 `v-model:data` 即可拿到实时填写结果，无需任何 provide / inject 约定。
 */
function onFieldChange(field: string, value: string): void {
  data.value = { ...data.value, [field]: value };
  emit("update:data", data.value);
  emit("field-change", field, value);
}

/**
 * 字段触发事件透传：内核在填写态对 `interactive` 字段（点击字段元素）发出 `field-activate`，
 * 此处原样 re-emit —— **弹窗/选择器由宿主实现**，宿主从 `payload.params` 自取所需约定
 * （如 `params.action` 决定弹哪个选择器），在回调里回写 data（`v-model:data` / `props.data`）
 * 后票面自动重渲染。内核不认识这些约定。
 */
function onFieldActivate(payload: FieldActivateV2): void {
  emit("field-activate", payload);
}

/** 内核实例引用（`$el` 即 `.grid-form-canvas`）：`printForm` 需要根元素才能圈定纸张。 */
const rendererRef = ref<ComponentPublicInstance | null>(null);

/**
 * D2：向消费页暴露打印能力，使「触发」与「呈现」同归渲染层。
 * 消费页 `ref.value.print()` 即可打印，无需自己 `window.print()`、也无需关心
 * `@page` 纸张注入（由本组件持有内核渲染实例在挂载期完成）。
 *
 * 打印走内核的**局部打印**（vue-print-next）：只把纸张序列化进同源 iframe，
 * 消费页其余内容（导航 / 头部 / 其他区域）不进打印流。
 * @returns 是否真的触发了打印（找不到打印根 / 宿主不支持时为 `false`）。
 */
function print(): boolean {
  const el = rendererRef.value?.$el;
  return printForm({ root: el instanceof HTMLElement ? el : null });
}

/**
 * 获取整个表单当前输入数据（消费页「提交 / 导出填写结果」入口）。
 * 返回内部响应式 data 的快照——初始来自 `props.data`，每次字段 `field-change` 即时并入，
 * 与 `update:data` 发射的口径一致。只读态返回的是回显数据，填写态返回的是已录入值。
 */
function getFormData(): FormDataV2 {
  return { ...data.value };
}

/**
 * P9.2c 提交校验：对当前数据执行 `options.rules` 里的必填规则（引擎
 * `findEmptyRequiredFields` 为真相源），返回**值为空**的必填字段名数组。
 * 空数组 = 全部通过。规则与 data 同轨经 props 注入、不进 schema；
 * HIDDEN 脱敏字段的真实值在响应式数据侧，此处校验不受脱敏影响。
 */
function validate(): string[] {
  return findEmptyRequiredFields(props.options?.rules, data.value);
}

defineExpose({ print, getFormData, validate });
</script>

<template>
  <PaperViewport v-if="options?.zoom" :fit-on-mount="options?.fitOnMount ?? false">
    <GridFormRenderer
      ref="rendererRef"
      :schema="schema"
      :mode="renderMode"
      :data="data"
      :readonly="readonly"
      :field-permissions="options?.fieldPermissions"
      :bare="true"
      @field-change="onFieldChange"
      @field-activate="onFieldActivate"
    />
  </PaperViewport>
  <GridFormRenderer
    v-else
    ref="rendererRef"
    :schema="schema"
    :mode="renderMode"
    :data="data"
    :readonly="readonly"
    :field-permissions="options?.fieldPermissions"
    :bare="options?.bare"
    @field-change="onFieldChange"
    @field-activate="onFieldActivate"
  />
</template>
