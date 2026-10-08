<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Panzoom from "@panzoom/panzoom";
import type { PanzoomObject, PanzoomGlobalOptions } from "@panzoom/panzoom";
import { computeAlignPan } from "./paper-viewport-align";

/**
 * 纸张视口（表面层 · 浏览缩放）
 *
 * 纯「视图/浏览」外壳：把渲染内核（GridFormRenderer）或设计表面层（CanvasSurface）
 * 包进一个可平移 / 缩放的视口，内核与表面层保持纯净（schema + 交互，不含缩放态）。
 *
 * 选型：@panzoom/panzoom（timmywil，v4）——
 * - 拖拽平移 + 滚轮缩放（`zoomWithWheel` 需手动绑定，v4 不自动绑 wheel）+ 触屏双指捏合（`pinch` 内置）；
 * - 通过 `excludeClass`（默认 `panzoom-exclude`）排除指定元素上的「平移手势」：被排除元素的指针按下不触发 pan，
 *   从而表单字段可正常编辑/选中、设计态可拖拽节点；其余空白区域照常平移。
 * - 缩放变化（滚轮 / 捏合 / 按钮 / reset）统一经原生事件 `panzoomchange`（`detail.scale`）同步百分比显示。
 *
 * 内容对齐（2026-09-18）：panzoom 以「scaler 自身中心」为 transform-origin，而 scaler 的布局盒是
 * 「视口宽 × 内容高」——缩放后内容会整体右移 / 下移 `size/2·(1−s)`，左侧 / 顶部留大片空白、
 * 右侧 / 底部溢出（父级 overflow 被置为 hidden，无滚动条），于是「表单不居中、还得拖拽才能浏览」。
 * 故在程序化定位（挂载适配 / 适应宽度 / 重置 / 容器尺寸变化）后统一调 {@link alignContent}
 * 把内容对齐进视口（水平居中；垂直始终顶部对齐，留 18px 间隔，不垂直居中）。解算与实测见 `paper-viewport-align.ts`。
 *
 * 适应宽度（2026-10-08）：比例按 `可用宽 / 内容自然宽` 算，可用宽 = 视口宽 − 2×`fitPadding`
 * （见该 prop 注释）。留白是**参与比例解算**的，不是 CSS 内边距 —— 否则内容会被裁而不是被缩小。
 *
 * 打印安全：`@media print` 下 `.paper-viewport__scaler { transform: none !important }` 覆盖 panzoom 内联 transform，
 * 配合内核 `@media print`（`grid-form-canvas` 转 `overflow:visible`、纸张 `margin:0`）走真实 mm 出页，缩放被完全忽略。
 *
 * 注意：panzoom 会在 `onMounted` 时给 scaler（`userSelect:none`）与 parent（`.paper-viewport` `overflow:hidden`、
 * `touchAction:none`）写内联样式；本组件在挂载后把 scaler/parent 的 `userSelect` 复位为 `''`（被排除的字段单独设为 text），
 * 否则字段内文本无法选中；打印时由 `!important` 复位 `overflow` / `transform`。
 */
const props = withDefaults(
  defineProps<{
    /** 初始缩放比例（默认 1 = 100%）。 */
    initialScale?: number;
    /**
     * 挂载后自动适应宽度（窄屏 / 移动端查看场景），并在**容器或内容尺寸变化**时按同一规则重算
     * （窗口缩放 / 侧栏开合 / 抽屉动画 / 切换表单 / 分页校正改变内容高后自愈）；
     * 用户手动缩放或平移过则不再自动干预（显式「适应宽度」会复位该标记）。
     */
    fitOnMount?: boolean;
    /**
     * 「适应宽度」时**左右各留出**的空白（px，默认 `0` = 内容贴边）。
     *
     * 为什么在视口侧而不是消费页：适应宽度的比例是 `可用宽 / 内容自然宽`，而「可用宽」只有本组件
     * 量得到（`viewport.clientWidth`）——消费页在外层加 padding 改变不了这个测量值，只在
     * CSS 上留白又会让内容被裁（panzoom 把父级 `overflow` 置为 `hidden`，没有滚动条）。
     * 故留白必须参与比例解算：`s = (视口宽 − 2×fitPadding) / 内容宽`，坐落后由水平居中
     * （`computeAlignPan`）自然给出左右各 `fitPadding` 的间隔。
     *
     * 只影响**比例**，不影响顶部间隔：后者恒为 `TOP_GAP`（18px，见 `paper-viewport-align.ts`），
     * 与比例无关，故「上方留白」在任何缩放下都成立。
     *
     * 默认 `0`：设计态 / 既有消费页的适应宽度结果逐像素不变，需要留白的一方显式声明。
     */
    fitPadding?: number;
    /**
     * 「适应宽度」测量与对齐所依据的**内容元素选择器**（在缩放层内查；缺省取缩放层的第一个子元素）。
     *
     * 为什么需要它（2026-10-08 实测）：有的消费方在纸张外面还包了一层**铺满视口的画布**
     * （FD 内核的 `.grid-form-canvas`，宽 = 100%）。此时第一个子元素不是纸、而是那层画布 ——
     * 它的 `scrollWidth` 恒等于视口宽，于是比例恒等于 1：宽容器里纸只有自然宽、**铺不满**，
     * 加 `fitPadding` 还会把它缩小（留白变成 `padding × 视口宽 / 纸宽`，比预期大得多）。
     * 指名真正的纸之后，比例按纸的自然宽解算，宽度方向才真的铺满。
     *
     * 实测对照（容器 900×800、A4 纸 793.69px、`fitPadding: 24`）：
     * 不指名 → scale 0.9467、纸 751.36px、两侧各空 74.32px（反而变小）；
     * 指名 `.grid-form-paper` → 预期 scale ≈ 1.0730、纸 852px、两侧各 24px。
     *
     * 选择器查不到时静默回退到「第一个子元素」（消费方拼错选择器不该让视口崩掉或缩放乱跳）。
     */
    fitContentSelector?: string;
    /** 允许的最小缩放（默认 0.2）。 */
    minScale?: number;
    /** 允许的最大缩放（默认 4）。 */
    maxScale?: number;
    /**
     * 隐藏内置缩放工具栏（`.paper-viewport__bar`）。
     *
     * 宿主已有自己的工具栏时置真——否则页面上会叠两套缩放 UI，且两者的百分比显示会互相打架
     * （宿主按自己的状态渲染、视口按 `panzoomchange` 渲染）。隐藏后缩放仍由 `zoomIn/zoomOut/zoomTo`
     * 与滚轮 / 捏合驱动，`scale-change` 照常上报，宿主工具栏据此显示百分比。
     */
    hideBar?: boolean;
    /**
     * 非「适应宽度」模式（`fitOnMount` 为假）下，挂载时是否按 `initialScale` 解算一次**落点对齐**。
     *
     * 为什么需要这个开关：panzoom 的 `transform-origin` 是本元素中心，而 `.paper-viewport__scaler`
     * 的布局盒是「视口宽 × 内容高」——于是任何 `s ≠ 1` 都会让内容整体偏移 `W/2·(1−s)`（放大时
     * 左移，缩小时右移；垂直同理由 scaler 高决定）。「适应宽度」靠 `measureFit()` 顺带对齐了，
     * 而**固定百分比**模式（宿主的工具栏按 110% / 120% 下发）没有这一步，内容就会顶出左上角、
     * 右下留白，用户必须自己拖回来。
     *
     * 默认 `false`：**设计态**必须保持「不写起始平移」的既有契约（缩放恒为 1，本就没有偏移），
     * 由消费页显式置真声明「我要固定比例浏览」。
     */
    alignOnMount?: boolean;
  }>(),
  { initialScale: 1, fitOnMount: false, fitPadding: 0, fitContentSelector: "", minScale: 0.2, maxScale: 4, hideBar: false, alignOnMount: false },
);

const emit = defineEmits<{
  (e: "scale-change", scale: number): void;
}>();

const viewport = ref<HTMLElement | null>(null);
const scaler = ref<HTMLElement | null>(null);
const scale = ref(props.initialScale);
let pz: PanzoomObject | null = null;
let observer: MutationObserver | null = null;
let resizeObserver: ResizeObserver | null = null;
/** 本组件正在写入程序化定位（fit / reset / 对齐）：期间 panzoom 事件不算「用户操作」。 */
let programmaticTransform = false;
/** 用户是否手动缩放过（滚轮 / 按钮）或平移过：手动干预后不再按容器尺寸自动重排。 */
let userAdjusted = false;

/** 包住一次程序化 transform 写入：panzoom 的写入在 rAF 内，标志需活到那一帧之后。 */
function asProgrammatic(run: () => void): void {
  programmaticTransform = true;
  try {
    run();
  } finally {
    requestAnimationFrame(() => {
      programmaticTransform = false;
    });
  }
}

const scaleText = computed(() => `${Math.round(scale.value * 100)}%`);

/**
 * 「可编辑控件」选择器：`panzoom-exclude` 打标与 `user-select` 恢复共用同一份口径。
 *
 * ⚠️ 不能只写 `[contenteditable]`（2026-09-24）：属性选择器匹配的是「属性存在」，
 * `contenteditable="false"` 同样命中 —— 于是只读字段、脱敏 span 会被误当成输入区排除掉平移，
 * 且「关闭可编辑后标记应随之清除」的 reconcile 逻辑会失效（永远命中）。故显式排除 `="false"`。
 */
const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
/**
 * 需要打 `panzoom-exclude` 标记（isExcluded 会向上查祖先）的元素：可编辑控件 + 设计态可拖拽节点。
 * 这些元素上的指针手势不触发平移——字段可编辑/选中、设计态可拖拽节点，其余区域照常平移。
 */
const EXCLUDE_SELECTOR = `${EDITABLE_SELECTOR}, [draggable='true']`;
/**
 * 收集需要打 `panzoom-exclude` 的元素 = 选择器命中项 + **含可编辑控件的 Shadow 宿主**。
 *
 * ⚠️ 必须**穿透 Shadow DOM**（2026-09-24）：HTML 模块内的表单控件长在 shadow root 里，
 * `querySelectorAll` 穿不过影子边界；而 panzoom 判定 exclude 时看到的 `event.target` 是
 * **宿主元素**（事件跨 shadow 边界被重定向，`closest` 同样止步于边界）—— 故只给 shadow 内的
 * 元素打标毫无作用，**必须把宿主一并打标**。漏掉它的症状：预览/填写态下 panzoom 吞掉 HTML
 * 模块内的 `mousedown` ⇒ 字段点不进去、键盘打不出字。设计态因宿主本身带 `draggable="true"`、
 * 已被本选择器命中，所以该缺陷只在预览态暴露，容易被误判成「HTML 里的表单不能输入」。
 */
function collectExcludeTargets(root: HTMLElement): HTMLElement[] {
  const targets = Array.from(
    root.querySelectorAll<HTMLElement>(EXCLUDE_SELECTOR),
  );
  root.querySelectorAll<HTMLElement>("*").forEach((el) => {
    if (el.shadowRoot?.querySelector(EXCLUDE_SELECTOR)) targets.push(el);
  });
  return targets;
}

/**
 * 给表单控件与「可拖拽节点」打 `panzoom-exclude` 标记（isExcluded 会向上查祖先），
 * 使这些元素上的指针手势不触发平移——字段可编辑/选中、设计态可拖拽节点，其余区域照常平移。
 * 同时把表单控件（含 Shadow 宿主）的 `user-select` 恢复为 `text`，抵消 panzoom 对整体的
 * `user-select:none`；该属性可继承，shadow 内控件的继承源正是宿主，故宿主上恢复即生效。
 *
 * ⚠️ 必须「先清后打」（reconcile），不能只 `add`：设计态 `CanvasSurface` 会给所有节点设
 * `draggable="true"`（被本选择器命中 → 打标记）；切到预览态时 `draggable` 被移除，
 * 若只 add 则过期标记残留，`panzoom-exclude` 类永不消失 —— 于是预览态「拖拽非输入组件」
 * 仍被误判为排除区、无法平移（即 design→preview 切换后平移失效的回归）。
 * 先清掉全部 `panzoom-exclude`，再按当前 EXCLUDE_SELECTOR 重新打标，保证 draggable 移除后
 * 节点即时恢复可平移；字段（contenteditable）始终命中、持续排除，输入不被平移吞掉。
 */
function tagExclusions(): void {
  const root = scaler.value;
  if (!root) return;
  // 先清除全部 panzoom-exclude（含 design→preview 切回后残留的过期标记），并清掉内联 user-select。
  root.querySelectorAll<HTMLElement>(".panzoom-exclude").forEach((el) => {
    el.classList.remove("panzoom-exclude");
    el.style.userSelect = "";
  });
  // 再按当前选择器重新打标。
  collectExcludeTargets(root).forEach((el) => {
    el.classList.add("panzoom-exclude");
    if (el.matches(EDITABLE_SELECTOR) || el.shadowRoot) {
      el.style.userSelect = "text";
    }
  });
}

// ── 空格长按平移 ──
// 设计态下纸张中间区域的拖拽被「节点拖拽」占用，按住空格临时禁用画布内一切节点交互
// （指针事件穿透到缩放层 scaler），由 panzoom 统一接管整片平移；松开空格恢复原交互。
// 实现上【不触碰 panzoom 的排除标记】，仅靠 pointer-events 把事件路由到 scaler，
// 避免了此前「中途解除字段 panzoom-exclude」方案在真实环境失效的问题（更稳健），
// 且与模式正交：设计态可越过节点拖拽平移，预览态可越过 contenteditable 字段平移。
const panMode = ref(false);

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return Boolean(
    el &&
    typeof el.closest === "function" &&
    el.closest("input, textarea, select, [contenteditable]"),
  );
}

function activatePan(): void {
  if (panMode.value) return;
  panMode.value = true;
  viewport.value?.classList.add("is-space-pan");
}

function deactivatePan(): void {
  if (!panMode.value) return;
  panMode.value = false;
  viewport.value?.classList.remove("is-space-pan");
}

function onSpaceKeyDown(e: KeyboardEvent): void {
  if (e.code !== "Space" && e.key !== " ") return;
  // 正在输入字段（contenteditable / input 等）：让空格正常输入，不进入平移态
  if (isTypingTarget(e.target)) return;
  e.preventDefault(); // 阻止空格滚动页面
  activatePan();
}

function onSpaceKeyUp(e: KeyboardEvent): void {
  if (e.code !== "Space" && e.key !== " ") return;
  deactivatePan();
}

function onPanChange(e: Event): void {
  // 用户经滚轮 / 按钮 / 捏合缩放（非本组件的程序化定位）→ 之后不再按容器尺寸自动重排。
  if (!programmaticTransform) userAdjusted = true;
  const detail = (e as CustomEvent<{ scale: number }>).detail;
  if (typeof detail?.scale === "number" && detail.scale !== scale.value) {
    scale.value = detail.scale;
    emit("scale-change", detail.scale);
  }
}

/** panzoom 平移事件：用户拖拽过即记为用户操作（保留其浏览位置，后续 resize 不重排）。 */
function onPanEvent(): void {
  if (!programmaticTransform) userAdjusted = true;
}

/** 滚轮缩放（v4 不自动绑 wheel）：表单控件上交给原生滚动，其余区域交给 panzoom。 */
function onWheel(e: WheelEvent): void {
  if (!pz) return;
  const t = e.target as HTMLElement | null;
  if (t && t.closest("input, textarea, select, [contenteditable]")) return;
  userAdjusted = true;
  pz.zoomWithWheel(e);
}

function clampScale(s: number): number {
  return Math.min(props.maxScale, Math.max(props.minScale, s));
}

function zoomIn(): void {
  const cur = pz?.getScale() ?? scale.value;
  userAdjusted = true;
  asProgrammatic(() => pz?.zoom(clampScale(cur * 1.2)));
}

function zoomOut(): void {
  const cur = pz?.getScale() ?? scale.value;
  userAdjusted = true;
  asProgrammatic(() => pz?.zoom(clampScale(cur / 1.2)));
}

/**
 * 缩放到**指定比例**（宿主按百分比下发时用，如宿主工具栏的 `110%` → `zoomTo(1.1)`）。
 *
 * 与 `zoomIn` / `zoomOut` 同语义：只改比例、**不动平移**——缩放围绕视口中心进行，用户此前
 * 拖到的浏览位置得以保留（宿主每次 ±10% 都把内容拉回原点会很难用）。故这里刻意不调
 * `alignContent`：那是「重排落点」的职责，只在挂载与 `relayout`（换 schema）时执行。
 *
 * 幂等：与当前比例几乎相同（< 1e-6）时直接返回，避免「宿主下发 → 视口上报 → 宿主再下发」的回环空转。
 */
function zoomTo(next: number): void {
  if (!pz || !Number.isFinite(next)) return;
  const target = clampScale(next);
  const current = pz.getScale() ?? scale.value;
  if (Math.abs(target - current) < 1e-6) return;
  userAdjusted = true;
  asProgrammatic(() => pz?.zoom(target, { animate: false, force: true }));
}

/**
 * 显式重排（换 schema / 换纸张方向后调用）：按当前模式重算**落点**。
 *
 * - `fitOnMount` 模式（浏览场景）：重新「适应宽度 + 对齐」——内容宽变了，比例本就该重算；
 * - `alignOnMount` 模式（宿主固定百分比）：只重排落点，比例保持宿主下发的值；
 * - 两者皆否（设计态）：什么都不做，不干预用户的浏览位置。
 *
 * 视为显式重排请求（同 `fitWidth`），故先复位 `userAdjusted`——否则用户滚过一次滚轮后，
 * 换表单就不再对齐，首页会偏在一角。
 */
function relayout(): void {
  userAdjusted = false;
  if (props.fitOnMount) {
    fitWidth();
    return;
  }
  if (!props.alignOnMount) return;
  asProgrammatic(() => alignContent());
}

/** 重置为 100%：同时把内容对齐进视口（否则 100% 下宽纸张仍左对齐、需拖拽）。 */
function reset(): void {
  userAdjusted = true;
  const s = clampScale(props.initialScale);
  asProgrammatic(() => {
    // 不用 `pz.reset()`：它会把平移量写成构造器传入的 `startX/startY`（现在是「适应宽度」的目标值），
    // 与这里的 100% 对齐解不一致；直接用 zoom + align 表达「回到 100% 并居中」。
    pz?.zoom(s, { animate: false, force: true });
    alignContent(s);
  });
}

/**
 * 把内容对齐进视口：**水平居中**；垂直**始终顶部对齐**（纸张首页贴渲染区域顶部，留 18px 间隔），不垂直居中。
 *
 * 修正 panzoom 以「scaler 自身中心」为 transform-origin 带来的整体偏移——
 * scaler 的布局盒是「视口宽 × 内容高」，缩放围绕它进行会让内容右移 / 下移 `size/2·(1−s)`，
 * 于是在左侧 / 顶部留下大片空白、右侧 / 底部溢出（父级 overflow 被 panzoom 置为 hidden，无滚动条），
 * 表现为「表单不居中、还得拖拽才能浏览」。解算过程与实测数据见 `paper-viewport-align.ts`。
 * 幂等：`offset*` / `client*` 均不受 transform 影响，重复调用结果一致。
 */
function alignPanFor(s: number): { x: number; y: number } {
  const vp = viewport.value;
  const el = scaler.value;
  const content = resolveFitContent();
  if (!vp || !el || !content) return { x: 0, y: 0 };
  return computeAlignPan({
    viewportWidth: vp.clientWidth,
    viewportHeight: vp.clientHeight,
    scalerWidth: el.clientWidth,
    scalerHeight: el.clientHeight,
    contentWidth: content.scrollWidth,
    contentHeight: content.scrollHeight,
    contentLeft: content.offsetLeft - el.offsetLeft,
    contentTop: content.offsetTop - el.offsetTop,
    scale: s,
  });
}

/**
 * 留白归一：非数 / 负数一律当 `0`（负留白会把「可用宽」算得比视口还大 ⇒ 内容被算出更大的比例）。
 * 取整不必要（比例解算按 px 浮点算，实际落点由 panzoom 按小数缩放）。
 */
function fitPaddingPx(): number {
  return Number.isFinite(props.fitPadding) && props.fitPadding > 0 ? props.fitPadding : 0;
}

/**
 * 「测量与对齐」所依据的内容元素：默认缩放层的第一个子元素；`fitContentSelector` 命中时以它为准。
 *
 * ⚠️ 必须**同一份解析**喂给比例解算（`measureFit`）与落点对齐（`alignPanFor`），否则两者对
 * 「内容是谁」的认知不一致 —— 比例按纸算、平移按画布算，落点就会偏。
 *
 * 为什么面积（`offsetLeft` / `scrollWidth`）都能用：二者都是**布局值**，不受 transform 影响，
 * 所以「纸比画布窄、画布铺满缩放层」的场景下，`content.offsetLeft - scaler.offsetLeft` 仍是
 * 「内容相对缩放层原点的偏移」，与既有的水平居中公式完全同口径（实测：换成纸之后 x 解不变，
 * 只有比例变）。选择器查不到时回退第一个子元素 —— 消费方拼错选择器不该让缩放乱跳。
 */
function resolveFitContent(): HTMLElement | null {
  const el = scaler.value;
  if (!el) return null;
  const selector = String(props.fitContentSelector ?? "").trim();
  if (selector) {
    const hit = el.querySelector<HTMLElement>(selector);
    if (hit) return hit;
  }
  return (el.firstElementChild as HTMLElement | null) ?? el;
}

/**
 * 量取当前布局，解算「适应宽度 + 对齐」的**目标**（缩放比例 + 平移量），只读不写 DOM。
 * 用于两处：① 挂载时作为 panzoom 的起始值；② `fitWidth` 的实际重排。
 *
 * 比例按**扣掉 `fitPadding` 的可用宽 / 被指名内容的自然宽**算（见两个 prop 的注释）；
 * 顶部间隔仍由 `computeAlignPan` 的 `TOP_GAP` 固定给出，故「左右留白 + 顶部留白」是两件事。
 */
function measureFit(): { scale: number; x: number; y: number } {
  const vp = viewport.value;
  const content = resolveFitContent();
  if (!vp || !content) return { scale: props.initialScale, x: 0, y: 0 };
  const contentW = content.scrollWidth || 0;
  const available = vp.clientWidth - fitPaddingPx() * 2;
  const s =
    contentW > 0 && available > 0
      ? clampScale(available / contentW)
      : props.initialScale;
  return { scale: s, ...alignPanFor(s) };
}

/**
 * 把内容对齐进视口：**水平居中**；垂直**始终顶部对齐**（纸张首页贴渲染区域顶部，留 18px 间隔），不垂直居中。
 *
 * 修正 panzoom 以「scaler 自身中心」为 transform-origin 带来的整体偏移——
 * scaler 的布局盒是「视口宽 × 内容高」，缩放围绕它进行会让内容右移 / 下移 `size/2·(1−s)`，
 * 于是在左侧 / 顶部留下大片空白、右侧 / 底部溢出（父级 overflow 被 panzoom 置为 hidden，无滚动条），
 * 表现为「表单不居中、还得拖拽才能浏览」。解算过程与实测数据见 `paper-viewport-align.ts`。
 * 幂等：`offset*` / `client*` 均不受 transform 影响，重复调用结果一致。
 */
function alignContent(scaleValue?: number): void {
  if (!pz) return;
  const s = scaleValue ?? pz.getScale() ?? scale.value;
  const { x, y } = alignPanFor(s);
  pz.pan(x, y, { animate: false, force: true });
}

/**
 * 适应宽度：按视口可见宽 / 内容自然宽算缩放，**并把内容对齐进视口**——
 * 否则「适应宽度」只算对了比例，落点仍偏（A3 横向 420mm 落进 912px 容器时右移 194px、
 * 右缘被切 194px，屏幕上看反而没适应）。
 *
 * 视为「显式重排请求」：先复位 `userAdjusted`，使随后的内容 / 容器尺寸变化重新触发自动重排
 * （切换表单、分页校正改变内容高度后需要再对齐一次）。
 */
function fitWidth(): void {
  const vp = viewport.value;
  const el = scaler.value;
  if (!vp || !el || !pz) return;
  userAdjusted = false;
  const target = measureFit();
  asProgrammatic(() => {
    pz?.zoom(target.scale);
    pz?.pan(target.x, target.y, { animate: false, force: true });
  });
}

function getScale(): number {
  return pz?.getScale() ?? scale.value;
}

defineExpose({
  zoomIn,
  zoomOut,
  zoomTo,
  reset,
  fitWidth,
  relayout,
  getScale,
});

onMounted(() => {
  const el = scaler.value;
  const vp = viewport.value;
  if (!el || !vp) return;
  const options: PanzoomGlobalOptions = {
    minScale: props.minScale,
    maxScale: props.maxScale,
    startScale: props.initialScale,
    step: 0.3,
    cursor: "grab",
    touchAction: "none",
  };
  // panzoom 构造器把 `pan(startX, startY)` **延后到一个 `setTimeout` 才执行**（panzoom 4.6.2 源码
  // `zoom(startScale); setTimeout(() => pan(options.startX, options.startY))`），且默认值 `startX/startY = 0`。
  // 这次延后写入排在 onMounted 的同步代码之后，会把此处算好的「适应宽度 + 对齐」平移量**清零**
  // （scale 保留、translate 归零）——首次进入 A3 横向（需缩放）时纸张整体偏移即由此而来（A4 不缩放，
  // 平移量本就接近 0，故看不出）。
  // 解：先把目标量出来交给构造器的起始值，使那次延后写入落到的正是目标位置（并避免挂载瞬间的未缩放闪烁）。
  //
  // 非「适应宽度」模式有两种落点：
  // - `alignOnMount`（宿主固定百分比浏览）：按 `initialScale` 解一次对齐，抵消 transform-origin
  //   在中心带来的 `W/2·(1−s)` 整体偏移；
  // - 否则（设计态）：起始平移保持 0——设计态缩放恒为 1，本就没有偏移，且这是既有契约。
  const startScale = clampScale(props.initialScale);
  const initial = props.fitOnMount
    ? measureFit()
    : props.alignOnMount
      ? { scale: startScale, ...alignPanFor(startScale) }
      : { scale: startScale, x: 0, y: 0 };
  pz = Panzoom(el, {
    ...options,
    startScale: initial.scale,
    startX: initial.x,
    startY: initial.y,
  });
  scale.value = initial.scale;
  // 挂载即上报一次初始比例（2026-10-08）。
  //
  // 为什么必须显式发：`panzoomchange` 只在**比例真的变了**时才值得转发（`onPanChange` 里
  // `detail.scale !== scale.value` 才 emit），而挂载期的写入链恰好都是「比例没变」——
  // ① 构造器那次 `zoom(startScale)` 发生在监听器挂上之前，收不到；② `fitOnMount` 那次
  // `fitWidth()` 用的是构造器刚设好的同一个比例。于是宿主工具栏（`hideBar` 后百分比只认
  // `scale-change`）在自适应模式下会一直停在它自己的占位数字上，与视口实际比例不符。
  // 这里补一次「当前比例」上报，宿主的百分比从第一帧起就与视口一致。
  emit("scale-change", initial.scale);
  // 抵消 panzoom 对整体的 user-select:none，保证字段内可选中文本（被排除元素已单独恢复 text）。
  el.style.userSelect = "";
  vp.style.userSelect = "";
  tagExclusions();
  observer = new MutationObserver(tagExclusions);
  observer.observe(el, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["draggable", "contenteditable"],
  });
  el.addEventListener("panzoomchange", onPanChange);
  el.addEventListener("panzoompan", onPanEvent);
  vp.addEventListener("wheel", onWheel, { passive: false });
  // 空格长按平移：全局监听 keydown/keyup；按住空格临时接管整片平移，松开恢复。
  window.addEventListener("keydown", onSpaceKeyDown);
  window.addEventListener("keyup", onSpaceKeyUp);
  if (props.fitOnMount) {
    // 构造器那次延后的 `pan` 仍在「程序化写入窗口」之外派发 `panzoompan` / `panzoomchange`
    // （`asProgrammatic` 的标志已在本帧复位），会被 `onPanEvent` 误记为「用户手动拖拽」，
    // 从而永久关闭后续的尺寸自愈（容器/内容变化不再重排）——这正是「先看哪张表单决定后一张」的成因之一。
    // 紧随其后（同一宏任务队列，必然晚于构造器的定时器）复位标记，并按**可能已被分页校正改变**的
    // 内容尺寸再对齐一次。
    setTimeout(() => {
      if (!pz) return; // 期间已卸载
      userAdjusted = false;
      fitWidth();
    }, 0);
  }
  // 尺寸后变时自愈：只要用户没手动干预过，就按「适应宽度 + 对齐」重算——避免挂载瞬间量到的
  // 中间态被永久固化（表单缩得很小、偏在一角）。观察两个盒：
  // - `vp`（height:100%）：容器尺寸（窗口缩放 / 侧栏开合 / 抽屉动画）；
  // - `el`（scaler，height = 内容高）：**内容尺寸**。切换表单 / 分页校正（确定性 → 实测修正）
  //   会改变内容高，而 `alignContent` 的平移量依赖 scaler 高 —— 只观察 vp 会漏掉这类变化，
  //   于是沿用按旧内容高算出的平移量、首页落点整体上/下漂移。
  if (props.fitOnMount && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      if (userAdjusted) return;
      fitWidth();
    });
    resizeObserver.observe(vp);
    resizeObserver.observe(el);
  }
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
  const el = scaler.value;
  const vp = viewport.value;
  el?.removeEventListener("panzoomchange", onPanChange);
  el?.removeEventListener("panzoompan", onPanEvent);
  vp?.removeEventListener("wheel", onWheel);
  window.removeEventListener("keydown", onSpaceKeyDown);
  window.removeEventListener("keyup", onSpaceKeyUp);
  // 复位 panzoom 写入的 parent/elem 内联样式，并移除指针监听。
  pz?.resetStyle();
  pz?.destroy();
  pz = null;
});
</script>

<template>
  <div
    ref="viewport"
    class="paper-viewport"
    :class="{ 'is-space-pan': panMode }"
  >
    <div ref="scaler" class="paper-viewport__scaler">
      <slot />
    </div>
    <div v-if="!hideBar" class="paper-viewport__bar" role="toolbar" aria-label="缩放控制">
      <button
        type="button"
        class="paper-viewport__btn"
        title="缩小"
        @click="zoomOut"
      >
        −
      </button>
      <span class="paper-viewport__scale">{{ scaleText }}</span>
      <button
        type="button"
        class="paper-viewport__btn"
        title="放大"
        @click="zoomIn"
      >
        +
      </button>
      <button
        type="button"
        class="paper-viewport__btn paper-viewport__btn--text"
        title="适应宽度"
        @click="fitWidth"
      >
        适应
      </button>
      <button
        type="button"
        class="paper-viewport__btn paper-viewport__btn--text"
        title="重置为 100%"
        @click="reset"
      >
        重置
      </button>
    </div>
  </div>
</template>

<style scoped>
.paper-viewport {
  position: relative;
  width: 100%;
  height: 100%;
  background: #e5e7eb;
  /* overflow 由 panzoom 设为 hidden；打印时经 @media print 复位 */
}

.paper-viewport__scaler {
  transform-origin: 50% 50%;
  /* ⚠️ 严禁加 `will-change: transform`（或 `translateZ(0)` / `backface-visibility` 等任何
     合成层提示）——2026-10-08 实测：它会把这个 scaler 提升为独立合成层，Chrome 按**提升时刻**
     的比例一次性栅格化图层，之后 `transform: scale()` 只做位图放大 ⇒ **放大即糊**。

     症状与量级（无头 Chromium 实测，A4 表单先「适应宽度」= 0.499× 再放大到 3×，取页面文字带
     做 Laplacian 方差对焦度量）：
       有 will-change → lapVar 158.43、gradMean 3.398、midFrac 0.5253（位图放大，边缘发虚）
       无 will-change → lapVar 920.05、gradMean 4.055、midFrac 0.5084（按 3× 重新栅格化，清晰）
     即锐度提升 5.8 倍。比例越小越明显（移动端/侧栏「适应宽度」常到 0.3~0.5×，再放大到 300%
     等于把位图放大约 6~10 倍）。

     取舍：去掉提示后，平移时由重绘代替图层位移，重表单在超大比例下拖动可能略不如前；但
     「放大清晰」是本组件的第一诉求（用户会在 300% 下核对票面文字），故此处以清晰优先。
     若日后确需两者兼得，只能在**仅平移**（比例不变 ⇒ 栅格比例本就正确）期间临时加提示，
     且必须在缩放前移除——不可常驻。 */
}

/* 空格长按平移：临时让纸张内容「指针穿透」，整片平移交给 panzoom（scaler）接管。
   内容（字段 / 可拖拽节点）不再拦截指针，指针按下直达 scaler，panzoom 不再因
   panzoom-exclude 标记而忽略 —— 设计/预览态都可直接拖拽空白或节点区域平移。 */
.paper-viewport.is-space-pan .paper-viewport__scaler > * {
  pointer-events: none;
}

.paper-viewport.is-space-pan,
.paper-viewport.is-space-pan .paper-viewport__scaler > * {
  cursor: grab;
}

.paper-viewport.is-space-pan:active {
  cursor: grabbing;
}

.paper-viewport__bar {
  position: absolute;
  right: 6px;
  top: 6px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  background: rgb(255 255 255 / 92%);
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgb(15 23 42 / 12%);
  font-size: 13px;
  user-select: none;
}

.paper-viewport__btn {
  min-width: 26px;
  height: 26px;
  padding: 0 6px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  color: #0f172a;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}

.paper-viewport__btn:hover {
  background: #f1f5f9;
}

.paper-viewport__btn--text {
  font-size: 12px;
}

.paper-viewport__scale {
  min-width: 44px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: #334155;
}

@media print {
  .paper-viewport {
    overflow: visible !important;
    height: auto !important;
    background: white !important;
  }

  .paper-viewport__scaler {
    /* 覆盖 panzoom 内联 transform，打印走真实 mm */
    transform: none !important;
  }

  .paper-viewport__bar {
    display: none !important;
  }
}
</style>
