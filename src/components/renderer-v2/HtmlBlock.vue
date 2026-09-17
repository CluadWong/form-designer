<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import DOMPurify from "dompurify";
import type { FieldPermissionV2, HtmlNodeV2, FormDataV2 } from "@/types";

const props = defineProps<{
  node: HtmlNodeV2;
  data?: FormDataV2 | null;
  /** 只读硬闸门（与 GridSchemaNode 同轨）；为 true 时字段一律不可编辑。 */
  readonly?: boolean;
  /** 字段级权限（P9.2d，与 P 字段同轨经 props 注入）：READ/HIDDEN 作用于 HTML 内 {{field}}。 */
  fieldPermissions?: Record<string, FieldPermissionV2>;
}>();

const emit = defineEmits<{
  (e: "field-change", field: string, value: string): void;
}>();

/**
 * 填写态判定（与 GridSchemaNode.canFill 同口径）：有 data（非 design）且非 readonly。
 * 设计态 data 为 null → 占位 span；填写/预览态 → 可编辑 input。
 */
const canFill = (): boolean => props.data != null && !props.readonly;

/** 单字段运行时权限（缺省 EDIT，向后兼容未声明字段）。 */
function fieldPermission(field: string): FieldPermissionV2 {
  return props.fieldPermissions?.[field] ?? "EDIT";
}

const host = ref<HTMLDivElement | null>(null);

/** 用户 CSS 仅写入 Shadow DOM，并禁用可能逃逸样式的 @import。 */
function safeCss(css?: string): string {
  if (!css) return "";
  return css
    .replace(/@import[^;]+;?/gi, "")
    .replace(/<\/style>/gi, "");
}

/**
 * 将 {{field}} 占位替换为可编辑/只读/脱敏绑定元素（P9.2d 方案 A）：
 * - 设计态（不可填）→ 占位 `<span data-bind>`，设计器靠它选中/编辑片段；
 * - HIDDEN → `<span data-bind data-masked>***</span>`（脱敏，值不进 DOM）；
 * - READ（可填但只读）→ `<input data-bind readonly>`；
 * - EDIT（可填可写）→ `<input data-bind>`。
 * ⚠️ 字段名正则用 `\p{L}\p{N}`（带 u 标志）覆盖中文等 Unicode 字母——
 * 原 `[\w.$-]` 不含 CJK，会导致「签字」等中文占位符无法替换（原型即为此踩坑）。
 */
function withBindings(html: string): string {
  return html.replace(
    /\{\{\s*([\p{L}\p{N}_.$-]+)\s*\}\}/gu,
    (_match: string, field: string) => {
      const perm = fieldPermission(field);
      if (perm === "HIDDEN") {
        return `<span data-bind="${field}" data-masked>***</span>`;
      }
      if (!canFill()) {
        return `<span data-bind="${field}"></span>`;
      }
      const readonly = perm === "READ" ? " readonly" : "";
      return `<input data-bind="${field}"${readonly} />`;
    },
  );
}

function buildMarkup(): string {
  const clean = DOMPurify.sanitize(withBindings(props.node.html ?? ""), {
    USE_PROFILES: { html: true },
    ADD_TAGS: ["input"],
    ADD_ATTR: ["target", "data-bind", "readonly", "contenteditable"],
    FORBID_TAGS: ["style", "script"],
  });
  return `<style>${safeCss(props.node.css)}</style>${clean}`;
}

/**
 * 后处理原生 [data-field] 字段（作者直接在 HTML 里写的 `<p data-field>` 等）：
 * 与 GridSchemaNode 对 P 字段同口径——按权限设置可编辑性与脱敏，并按 data 回填。
 * 与 {{field}} 占位互补：占位走 data-bind（引擎生成元素），原生字段走 data-field（作者控 markup）。
 */
function applyFieldState(root: ShadowRoot): void {
  root.querySelectorAll<HTMLElement>("[data-field]").forEach((el) => {
    const field = el.getAttribute("data-field");
    if (!field) return;
    const perm = fieldPermission(field);
    const editable =
      perm === "HIDDEN"
        ? false
        : canFill()
          ? perm === "EDIT" // 填写态：仅 EDIT 字段可写
          : true; // 设计态：统一可就地输入（占位/看交互，不回写 schema，与 P 字段同口径）
    if (perm === "HIDDEN") {
      el.textContent = "***";
      el.setAttribute("data-masked", "");
      el.setAttribute("contenteditable", "false");
      return;
    }
    if (canFill() && props.data) {
      const value = props.data[field];
      const text = value == null ? "" : String(value);
      if (el.textContent !== text) el.textContent = text;
    }
    // contenteditable 由引擎统一闸门控制（填写态随权限、设计态恒为可编辑占位），覆盖片段硬编码值
    el.setAttribute("contenteditable", editable ? "true" : "false");
  });
}

/** data 变化：同时同步 {{field}}(data-bind) 与 原生 [data-field] 两类字段。 */
function syncData(): void {
  fill();
  const root = host.value?.shadowRoot;
  if (root) applyFieldState(root);
}

function inject(): void {
  const el = host.value;
  if (!el) return;
  if (!el.shadowRoot) el.attachShadow({ mode: "open" });
  el.shadowRoot!.innerHTML = buildMarkup();
  syncData();
  wireInputs();
}

/** 回填：把 data 写进 Shadow DOM 内的绑定元素（input.value / span.textContent）。 */
function fill(): void {
  const root = host.value?.shadowRoot;
  if (!root || !props.data) return;
  root.querySelectorAll<HTMLElement>("[data-bind]").forEach((el) => {
    const key = el.dataset.bind;
    if (!key) return;
    const value = props.data?.[key];
    const text = value == null ? "" : String(value);
    if (el instanceof HTMLInputElement) {
      if (el.value !== text) el.value = text;
    } else if (!el.hasAttribute("data-masked")) {
      if (el.textContent !== text) el.textContent = text;
    }
  });
}

/** 绑定输入事件：填写时经 field-change 把值交还宿主（与 P 字段同机制，不逐键回写 schema）。
 *  覆盖 {{field}}(input[data-bind]) 与 原生 [data-field](contenteditable <p>) 两类。 */
function wireInputs(): void {
  const root = host.value?.shadowRoot;
  if (!root) return;
  // 设计态（data 为 null）不接输入事件：原生 [data-field] 此刻 contenteditable=true 仅作占位，
  // 编辑不回写 schema（与 P 字段设计态同口径）；仅填写态（canFill）时回写 field-change。
  if (!canFill()) return;
  root
    .querySelectorAll<HTMLInputElement>("input[data-bind]:not([readonly])")
    .forEach((input) => {
      input.addEventListener("input", () => {
        const key = input.dataset.bind;
        if (key) emit("field-change", key, input.value);
      });
    });
  root
    .querySelectorAll<HTMLElement>("[data-field][contenteditable='true']")
    .forEach((el) => {
      el.addEventListener("input", () => {
        const key = el.getAttribute("data-field");
        if (key) emit("field-change", key, el.textContent ?? "");
      });
    });
}

onMounted(inject);
watch(() => [props.node.html, props.node.css, props.fieldPermissions], inject);
watch(() => props.data, syncData, { deep: true });
</script>

<template>
  <div
    ref="host"
    class="layout-html"
    :data-node-id="node.id"
  ></div>
</template>

<style scoped>
.layout-html {
  width: 100%;
  min-width: 0;
}
</style>
