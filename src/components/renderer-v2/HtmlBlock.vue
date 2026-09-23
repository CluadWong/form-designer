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

/**
 * 字段**可写**口径（与内核 P 字段同一道闸门）：`readonly` 是真的硬闸门 —— 为真时**所有字段
 * 降级为「只读回显」**（语义等价于全字段 READ：值照常进 DOM、可被采集，但用户改不动），
 * 非只读时仅权限 EDIT 可写。
 *
 * ⚠️ 勿退回「非 canFill 即可写」的旧口径：那会把**只读态误判成设计态**，让只读票面
 * 可直接打字（P 字段侧从未如此）。设计态的就地输入由 `data == null` 单独承载（见
 * `withBindings` / `applyFieldState`），与 P 字段 `canFill || isDesign` 同口径。
 */
function canWrite(perm: FieldPermissionV2): boolean {
  return !props.readonly && perm === "EDIT";
}

/** 单字段运行时权限（缺省 EDIT，向后兼容未声明字段）。 */
function fieldPermission(field: string): FieldPermissionV2 {
  return props.fieldPermissions?.[field] ?? "EDIT";
}

const host = ref<HTMLDivElement | null>(null);

/**
 * 上一次注入的标记串：**结构没变就不重建 shadow**。
 *
 * ⚠️ 这是「输入一个字符就掉焦点」的根因防线。`inject()` 是 `node.html / node.css /
 * fieldPermissions / readonly` 的 watch 回调，而这些 prop 的**对象身份**在真实浏览器里
 * 会因为分页重算（`GridFormRenderer.renderedPages` 依赖 `data`）而每次输入都变一次 ——
 * watch 的 getter 又返回**新数组**，`Object.is` 恒不相等 ⇒ 回调照跑。若此时无条件
 * `shadowRoot.innerHTML = ...`，正在输入的 `<p contenteditable>` 会被**整体换掉**，
 * 焦点随元素一起消失：表现即「敲 1 个字符后光标没了、后续按键全丢」（真实 Chromium 实测复现）。
 * 故重建必须由「标记串真的变了」把关，与 prop 身份变化解耦。
 */
let lastMarkup: string | null = null;

/** shadow root 上的委托监听是否已挂（重建子树不影响 root，故只挂一次）。 */
let wired = false;

/** 用户 CSS 仅写入 Shadow DOM，并禁用可能逃逸样式的 @import。 */
function safeCss(css?: string): string {
  if (!css) return "";
  return css
    .replace(/@import[^;]+;?/gi, "")
    .replace(/<\/style>/gi, "");
}

/**
 * 将 {{field}} 占位替换为可编辑/只读/脱敏绑定元素（P9.2d 方案 A）：
 * - 设计态（`data == null`）→ 占位 `<span data-bind>`，设计器靠它选中/编辑片段；
 * - HIDDEN → `<span data-bind data-masked>***</span>`（脱敏，值不进 DOM）；
 * - 非设计态**一律渲染 `<input data-bind>`**：可写（EDIT 且非 readonly）无 `readonly`，
 *   其余（READ / 只读回显）加 `readonly` —— **值都进 DOM**，故只读态既能看到值，
 *   又能被 `collectFieldValues` 采集（导出 / 复制成新单不丢值）。
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
      if (props.data == null) {
        return `<span data-bind="${field}"></span>`;
      }
      return `<input data-bind="${field}"${canWrite(perm) ? "" : " readonly"} />`;
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
 * 元素是否为 Shadow 内当前聚焦元素：用于「正在输入就不抢 DOM」的焦点保护。
 * jsdom 未实现 `ShadowRoot.activeElement` 时取到 null（退化为无保护，不影响正确性）。
 */
function isShadowActive(root: ShadowRoot, el: Element): boolean {
  const active = (root as ShadowRoot & { activeElement?: Element | null }).activeElement ?? null;
  return active === el;
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
    if (perm === "HIDDEN") {
      el.textContent = "***";
      el.setAttribute("data-masked", "");
      el.setAttribute("contenteditable", "false");
      return;
    }
    // 回填与可编辑性**正交**：只读回显同样要把值写进 DOM，否则只读票面全是空格子。
    // 焦点在本元素时跳过重写，避免外部 data 变化（如宿主逐键回写、重置）把光标顶位。
    if (props.data && !isShadowActive(root, el)) {
      const value = props.data[field];
      const text = value == null ? "" : String(value);
      if (el.textContent !== text) el.textContent = text;
    }
    // contenteditable 由引擎统一闸门控制：可写 = 非 readonly + EDIT 权限；
    // 设计态（data 为 null）不受 readonly 影响，恒可就地输入看交互（不回写 schema，与 P 字段同口径）。
    el.setAttribute("contenteditable", canWrite(perm) ? "true" : "false");
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
  // 只在标记串变化时重建（见 lastMarkup 注释）：否则会摧毁正在输入的 DOM ⇒ 掉焦点。
  const markup = buildMarkup();
  if (markup !== lastMarkup) {
    el.shadowRoot!.innerHTML = markup;
    lastMarkup = markup;
  }
  // 值 / contenteditable 一律按当前 props 重落一遍：幂等，且必须在「未重建」分支里也执行
  // —— 只读闸门（readonly）切换时标记串可能不变（原生 [data-field] 的 contenteditable 不在标记串里），
  // 靠这一步把可编辑性同步过去。
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
    // 焦点在本元素时跳过（用户正在输入，别抢 DOM 导致光标跳位）
    if (isShadowActive(root, el)) return;
    const value = props.data?.[key];
    const text = value == null ? "" : String(value);
    if (el instanceof HTMLInputElement) {
      if (el.value !== text) el.value = text;
    } else if (!el.hasAttribute("data-masked")) {
      if (el.textContent !== text) el.textContent = text;
    }
  });
}

/**
 * 读取可编辑区域的文本，保留换行：优先 `innerText`（浏览器按渲染返回带 \n 的文本），
 * jsdom 等无 innerText 实现时回退 `textContent`（与 P 字段 `readEditableText` 同口径）。
 */
function readEditableText(el: HTMLElement): string {
  const inner = el.innerText;
  return typeof inner === "string" ? inner : (el.textContent ?? "");
}

/**
 * 事件目标 → 可回写字段。只认引擎判定为**可写**的两类元素：
 * `{{field}}` 的 `<input data-bind>`（非 readonly）与原生 `[data-field][contenteditable=true]`；
 * 其余（只读 input / contenteditable=false / 容器自身 / 脱敏 span）一律不参与回写。
 */
function resolveWritableTarget(target: EventTarget | null): { field: string; value: string } | null {
  const el = target as HTMLElement | null;
  if (!el || typeof el.getAttribute !== "function") return null;
  if (el instanceof HTMLInputElement) {
    const key = el.dataset.bind;
    if (!key || el.readOnly) return null;
    return { field: key, value: el.value };
  }
  const field = el.getAttribute("data-field");
  if (!field || el.getAttribute("contenteditable") !== "true") return null;
  return { field, value: readEditableText(el) };
}

/**
 * 失焦回写：用户离开字段时 emit **一次** `field-change`（与 P 字段 `GridSchemaNode.onFillBlur` 同口径），
 * **输入过程中不逐键回写**。
 *
 * 逐键回写会让使用方每键重建响应式 data ⇒ 分页重算 + 整树重渲染（大表单每键一次全量重排），
 * 也是「输入掉焦点」的放大器。取值出口有两个，都不依赖逐键回写：
 * ① `collectFieldValues(rootEl)` 直接遍历渲染 DOM —— 保存时全量读取（推荐口径）；
 * ② 本事件（失焦口径）—— 供 `v-model:data` / 草稿自动保存等增量消费。
 *
 * 用 `focusout`（冒泡）而非 `blur`（不冒泡）：监听挂在 shadow root 上做事件委托，子树重建后无需重挂。
 */
function onShadowFocusOut(event: Event): void {
  if (!canFill()) return;
  const hit = resolveWritableTarget(event.target);
  if (hit) emit("field-change", hit.field, hit.value);
}

/** 事件委托：监听挂 shadow root（不随子树重建失效）⇒ 只挂一次。 */
function wireInputs(): void {
  const root = host.value?.shadowRoot;
  if (!root || wired) return;
  root.addEventListener("focusout", onShadowFocusOut);
  wired = true;
}

onMounted(inject);
// `readonly` 必须参与重建：可编辑性（`contenteditable` / readonly input）与输入事件绑定
// 都只在 inject() 里落一次。漏掉它会出现「只读切到填写态后仍然打不了字」（事件没绑上）。
watch(
  () => [props.node.html, props.node.css, props.fieldPermissions, props.readonly],
  inject,
);
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
