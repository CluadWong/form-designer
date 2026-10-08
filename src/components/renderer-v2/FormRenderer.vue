<script setup lang="ts">
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from "vue";
import type {
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
   * 「适应宽度」时左右各留出的空白（px，缺省 `0` = 内容贴边）。仅当 `zoom` 为真时生效。
   *
   * 宿主希望票面**铺满显示区域但不贴边**时传一个正数（如 `24`）：视口按
   * `(视口宽 − 2×fitPadding) / 内容宽` 解比例，由水平居中自然给出左右等宽间隔。
   * 顶部间隔不受它影响（恒为视口内的 `TOP_GAP = 18px`）。
   */
  fitPadding?: number;
  /**
   * 「适应宽度」按哪个元素量（视口内 CSS 选择器，缺省第一个子元素）。仅当 `zoom` 为真时生效。
   *
   * 本内核的 DOM 是 `缩放层 > .grid-form-canvas > .grid-form-paper`（纸外面还包了一层铺满视口的
   * 画布）⇒ 缺省量到的是**画布**（宽 = 视口宽），比例恒等于 1，适应宽度退化为「不缩放」。
   * 需要「按纸宽铺满」的消费方传 `".grid-form-paper"`。
   *
   * **默认不改**：审批 / 新建 / 表单管理那些页面用的是内核原生的「缩到能放下」（不做放大），
   * 传选择器会变成「铺满（含放大）」，属于另一个形态，由消费方显式声明。
   */
  fitContentSelector?: string;
  /**
   * 隐藏视口**内置**的缩放工具栏（`.paper-viewport__bar`）。仅当 `zoom` 为真时生效。
   *
   * 宿主已有自己的缩放控件（如详情页顶栏的 TDesign 缩放组）时置真：让宿主工具栏成为唯一 UI 与
   * 唯一百分比真源，避免页面上叠两套缩放条、两处百分比各说各话。隐藏后仍可用
   * `zoomIn / zoomOut / zoomTo / resetZoom / fitWidth / getScale`（本组件 `defineExpose`）
   * 驱动缩放，视口的 `scale-change` 事件照常上报（滚轮 / 双指捏合同样会触发）。
   */
  hideZoomBar?: boolean;
  /**
   * 允许的最小 / 最大缩放。仅当 `zoom` 为真时生效，缺省沿用视口的 `0.2 / 4`。
   *
   * 宿主按百分比界定时**必须**与宿主自己的上下界对齐（如宿主工具栏是 50%~200%，
   * 这里就要传 `0.5 / 2`）—— 否则滚轮 / 捏合能把比例带到宿主工具栏显示不出的区间
   * （视口 4× 而工具栏 clamped 到 200%），两处百分比永久不一致。
   */
  minScale?: number;
  /** 见 {@link FormRendererOptions.minScale}。 */
  maxScale?: number;
  /**
   * 视口初始缩放比例（缺省 `1` = 100%）。仅当 `zoom` 为真时生效。
   *
   * 只被**挂载时**读取：之后改它不会让视口重新缩放（否则宿主的百分比状态与滚轮缩放会互相打架）。
   * 宿主按百分比下发时传 `percent / 100`，这样挂载那一刻就是目标比例，不会先闪一帧 100%。
   */
  initialScale?: number;
  /**
   * 固定比例模式（`zoom: true` 且 `fitOnMount` 为假）下，挂载时是否解算一次落点对齐。
   *
   * **默认 true**：消费页固定比例浏览时必须对齐，否则 panzoom 以元素中心为 `transform-origin`
   * 会把内容整体顶出左上角（偏移 `size/2·(1−s)`），用户得自己拖回来。置 `false` 可回到
   * 「原样不干预落点」的旧行为（设计态场景——那里缩放恒为 1，本就没有偏移）。
   */
  alignOnMount?: boolean;
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
  /**
   * 视口缩放比例变化（滚轮 / 双指捏合 / `zoomIn`·`zoomOut`·`zoomTo`·`fitWidth`·`reset`）。
   *
   * 宿主自持工具栏时靠它把「视口当前比例」同步回工具栏百分比显示——不给这个事件，用户滚一次
   * 滚轮后工具栏就会停在旧数字上。仅当 `options.zoom` 为真时有事件。
   */
  (e: "scale-change", scale: number): void;
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

/** 内核实例引用（`$el` 即 `.grid-form-canvas`）：`printForm` 需要根元素才能圈定纸张。 */
const rendererRef = ref<ComponentPublicInstance | null>(null);

/**
 * 纸张视口实例引用：`schema` 变化（换表单 / 换纸张方向）时重新「适应宽度 + 对齐」。
 *
 * 视口实例不随 `schema` 重建（`v-if` 只看 `options.zoom`），而 fit / 对齐只在**挂载时**执行一次
 * ⇒ 同一消费页里切换到另一张表单时，会沿用上一张的 scale / 平移量，落点错乱（A4↔A3 切换尤其明显）。
 * 故在此 watch `schema` 显式重排；视口内部还会在内容尺寸（分页校正后）变化时再自愈一次。
 */
const viewportRef = ref<{
  fitWidth?: () => void;
  relayout?: () => void;
  zoomIn?: () => void;
  zoomOut?: () => void;
  zoomTo?: (scale: number) => void;
  reset?: () => void;
  getScale?: () => number;
} | null>(null);

watch(
  () => props.schema,
  () => {
    // `relayout` 而非 `fitWidth`：固定比例模式（宿主工具栏主导、`fitOnMount` 为假）下换表单
    // 只该重排落点，不该把宿主下发的比例改掉。
    nextTick(() => viewportRef.value?.relayout?.());
  },
);

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

function zoomIn(): void {
  viewportRef.value?.zoomIn?.();
}

function zoomOut(): void {
  viewportRef.value?.zoomOut?.();
}

function zoomTo(scale: number): void {
  viewportRef.value?.zoomTo?.(scale);
}

function resetZoom(): void {
  viewportRef.value?.reset?.();
}

function fitWidth(): void {
  viewportRef.value?.fitWidth?.();
}

function getScale(): number {
  return viewportRef.value?.getScale?.() ?? 1;
}

/**
 * 缩放能力透出（仅 `options.zoom` 为真时可用；否则各方法空转、`getScale()` 返回 1）。
 *
 * 宿主接自己的工具栏时用这组方法驱动视口，并用 `scale-change` 事件回读比例：
 * - `zoomIn / zoomOut`：视口自带的**乘法**步进（×1.2 / ÷1.2），适合「放大 / 缩小」按钮；
 * - `zoomTo(scale)`：**绝对**比例，适合宿主用**加法**步进（如百分比 ±10）或滑块；
 * - `resetZoom`：回到 `initialScale`；`fitWidth`：按视口宽自适应；`getScale`：当前比例。
 *
 * 语义提示：`zoomTo` 与 `zoomIn` / `zoomOut` 都**不动平移**（围绕视口中心缩放，保留用户的浏览位置），
 * 只有 `fitWidth` / `resetZoom` 会重排落点——这与宿主自研缩放「每次改比例都回到左上」的旧行为不同，
 * 是刻意的：3× 下微调 ±10% 时被拉回原点会很难用。
 */
defineExpose({
  print,
  getFormData,
  validate,
  zoomIn,
  zoomOut,
  zoomTo,
  resetZoom,
  fitWidth,
  getScale,
});
</script>

<template>
  <PaperViewport
    ref="viewportRef"
    v-if="options?.zoom"
    :fit-on-mount="options?.fitOnMount ?? false"
    :fit-padding="options?.fitPadding ?? 0"
    :fit-content-selector="options?.fitContentSelector ?? ''"
    :hide-bar="options?.hideZoomBar ?? false"
    :initial-scale="options?.initialScale ?? 1"
    :min-scale="options?.minScale"
    :max-scale="options?.maxScale"
    :align-on-mount="options?.alignOnMount ?? true"
    @scale-change="(scale: number) => emit('scale-change', scale)"
  >
    <GridFormRenderer
      ref="rendererRef"
      :schema="schema"
      :mode="renderMode"
      :data="data"
      :readonly="readonly"
      :field-permissions="options?.fieldPermissions"
      :bare="true"
      @field-change="onFieldChange"
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
  />
</template>
