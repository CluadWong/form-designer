/**
 * 纸张视口的内容对齐解算（纯函数 · 无 DOM 依赖，便于单测与复用）。
 *
 * ## 为什么需要它
 *
 * `PaperViewport` 用 `@panzoom/panzoom` 写 transform：`scale(s) translate(tx, ty)`，
 * 且（本组件 CSS）`transform-origin: 50% 50%`——**缩放围绕「缩放元素自身」的中心**。
 * 但 `.paper-viewport__scaler` 的布局盒是「视口宽 × 内容高」，既不是视口盒、也不是纸张盒：
 *
 * - 水平：纸张比视口宽时（A3 横向 420mm ≈ 1587px 落进 960px 抽屉，内容盒 = 912px），
 *   纸张在画布内左对齐（`margin: 0 auto` 在溢出时退化为 0），缩放围绕「视口宽的中点」进行，
 *   于是内容整体**右移 W/2·(1−s)**，左侧留白、右侧溢出；
 * - 垂直：scaler 的高度 = 全部物理页叠起来的高度（多页时成倍放大），其中心远在视口之下，
 *   缩放后内容整体**下移 H/2·(1−s)**，顶部留白、底部溢出。
 *
 * 叠加 panzoom 会把父级 `overflow` 设为 `hidden`（没有滚动条），结果就是
 * 「表单不居中、留大片空白、还得拖拽才能浏览」。
 *
 * 实测（Chromium，A3 横向 420×297mm，容器 912×800，`fitWidth` 缩放到 0.5747）：
 * 左空 194px、上空 238px（两页时 481px）、右侧与底部各溢出同量——与本函数给出的修正量一致。
 *
 * ## 解算
 *
 * 已知 panzoom 的映射式（元素内一点 `p` → 以元素中心 `O = (W/2, H/2)` 为原点的缩放结果）：
 *
 * ```text
 * screen(p) = O + s · (p + t − O)
 * ```
 *
 * 令内容（尺寸 `cw × ch`、相对 scaler 原点的布局偏移 `(cx, cy)`）缩放后落在目标位置，
 * 反解出平移量 `(tx, ty)`：
 *
 * - 水平恒**居中**：`tx = (V − W)/(2s) + (W − cw)/2 − cx`（`V` = 视口宽）；
 * - 垂直：**纸张首页始终贴渲染区域顶部，留 `TOP_GAP` 间隔** —— 不垂直居中。窄纸 / 缩放后内容
 *   矮于视口时，居中会把首页推到视口中部、顶部留大片空白（A3 横向适配后尤其明显），不符合预期。
 *
 * 该水平解与缩放比例无关（纸张与视口同心的几何必然），因此 `fitWidth` 之后应用即为
 * 「适应宽度」的应有结果；`reset` 到 100% 后应用即为居中显示。
 */
/** 纸张首页与渲染区域顶部的固定间隔（px）。 */
export const TOP_GAP = 18;

export interface AlignPanInput {
  /** 视口（可见区）宽高，取 `.paper-viewport` 的 `clientWidth / clientHeight`。 */
  viewportWidth: number;
  viewportHeight: number;
  /** 缩放元素（`.paper-viewport__scaler`）的布局宽高——panzoom 的 transform-origin 参考盒。 */
  scalerWidth: number;
  scalerHeight: number;
  /** 内容布局宽高：宽取 `scrollWidth`（纸张比画布宽时按纸张算），高取 `scrollHeight`。 */
  contentWidth: number;
  contentHeight: number;
  /**
   * 内容相对缩放元素布局原点的偏移，取 `offsetLeft / offsetTop` 之差。
   * 必须是**未缩放**的布局值（`offset*` / `client*` 不受 transform 影响），保证解算幂等。
   */
  contentLeft: number;
  contentTop: number;
  /** 当前（或即将应用的）缩放比例。 */
  scale: number;
}

export interface AlignPan {
  /** 传给 `panzoom.pan(x, y, { relative: false })` 的绝对平移量（px，未缩放坐标）。 */
  x: number;
  y: number;
}

/**
 * 解算「把内容对齐进视口」所需的平移量。
 *
 * 尺寸信息缺失（jsdom / 未布局，宽高或比例为 0）时返回 `{ x: 0, y: 0 }`——即不改动 transform，
 * 与 `fitWidth` 的降级路径一致，不抛错、不误位移。
 */
export function computeAlignPan(input: AlignPanInput): AlignPan {
  const {
    viewportWidth,
    viewportHeight,
    scalerWidth,
    scalerHeight,
    contentWidth,
    contentHeight,
    contentLeft,
    contentTop,
    scale,
  } = input;

  if (
    !(scale > 0) ||
    !(viewportWidth > 0) ||
    !(viewportHeight > 0) ||
    !(scalerWidth > 0) ||
    !(scalerHeight > 0)
  ) {
    return { x: 0, y: 0 };
  }

  // 水平：内容（缩放后）中心与视口中心重合。
  const x = (viewportWidth - scalerWidth) / (2 * scale) + (scalerWidth - contentWidth) / 2 - contentLeft;

  // 垂直：纸张首页始终贴渲染区域顶部，留 TOP_GAP 间隔。不垂直居中（否则内容矮于视口时
  // 首页被推到中部、顶部留大片空白，A3 横向适配后尤其明显）。
  const targetTop = TOP_GAP;
  const y = (targetTop - scalerHeight / 2) / scale + scalerHeight / 2 - contentTop;

  return { x, y };
}

export interface CenterPanInput {
  /** 视口（可见区）宽高，取 `.paper-viewport` 的 `clientWidth / clientHeight`。 */
  viewportWidth: number;
  viewportHeight: number;
  /** 缩放元素（`.paper-viewport__scaler`）的布局宽高——panzoom 的 transform-origin 参考盒。 */
  scalerWidth: number;
  scalerHeight: number;
  /**
   * 目标节点相对缩放元素布局原点的偏移与自身尺寸，取 `offset*` 之差 / `offsetWidth`。
   * 必须是**未缩放**的布局值（不受 transform 影响），保证每次调用解算同一结果。
   */
  targetLeft: number;
  targetTop: number;
  targetWidth: number;
  targetHeight: number;
  /** 当前缩放比例。 */
  scale: number;
}

/**
 * 解算「把**某个节点**移到视口正中」所需的平移量（左侧结构树选中 / 悬停时用）。
 *
 * 与 {@link computeAlignPan} 同一映射式（`screen(p) = O + s·(p + t − O)`，`O` 为缩放元素中心），
 * 只是目标从「内容整体」换成「目标节点的中心」：
 *
 * ```text
 * tx = (V/2 − W/2)/s + W/2 − cx      // cx = targetLeft + targetWidth/2
 * ty = (Vh/2 − H/2)/s + H/2 − cy     // cy = targetTop + targetHeight/2
 * ```
 *
 * 垂直方向这里**居中**（不像 `alignContent` 那样贴顶）：需求是「锚定到对应区域并居中显示」，
 * 让用户一眼看到左侧树那一行在整票版式里的位置。
 *
 * 尺寸缺失（jsdom / 未布局，宽高或比例为 0）时返回 `{ x: 0, y: 0 }` —— 不改动 transform，
 * 与 `fitWidth` / `alignContent` 的降级路径一致，不抛错、不误位移。
 */
export function computeCenterPan(input: CenterPanInput): AlignPan {
  const {
    viewportWidth,
    viewportHeight,
    scalerWidth,
    scalerHeight,
    targetLeft,
    targetTop,
    targetWidth,
    targetHeight,
    scale,
  } = input;

  if (
    !(scale > 0) ||
    !(viewportWidth > 0) ||
    !(viewportHeight > 0) ||
    !(scalerWidth > 0) ||
    !(scalerHeight > 0)
  ) {
    return { x: 0, y: 0 };
  }

  const cx = targetLeft + targetWidth / 2;
  const cy = targetTop + targetHeight / 2;
  const x = (viewportWidth / 2 - scalerWidth / 2) / scale + scalerWidth / 2 - cx;
  const y = (viewportHeight / 2 - scalerHeight / 2) / scale + scalerHeight / 2 - cy;

  return { x, y };
}

export interface RestrictCenterPanInput {
  /** 内容整体对齐的解（`computeAlignPan`：水平居中、垂直贴顶留 `TOP_GAP`）。 */
  aligned: AlignPan;
  /** 目标节点居中的解（`computeCenterPan`）。 */
  centered: AlignPan;
  viewportWidth: number;
  viewportHeight: number;
  scalerWidth: number;
  scalerHeight: number;
  /** 内容（纸 / 画布）相对缩放层布局原点的偏移与尺寸。 */
  contentLeft: number;
  contentTop: number;
  contentWidth: number;
  contentHeight: number;
  scale: number;
}

/**
 * 给「节点居中」加上**内容不得被推出视口**的约束（2026-10-28）。
 *
 * 为什么必须有这一步：`computeCenterPan` 只看「把目标中心对到视口中心」，目标越靠近内容边缘，
 * 需要的位移越荒谬 —— 实测（A4 空白页，`translate(0, 0)`，1 行网格，格子中心在内容 y≈30.96）
 * 解出 `translate(0, 369.04)`：为了让第一行格子居中，整张纸被往下推了 369px，
 * 视口上半部空出来、纸"掉到下方"。几何上完全正确，体验上不能接受。
 *
 * 规则（逐轴独立，与 `scrollIntoView({ block: "nearest" })` 同精神，但保留居中倾向）：
 * - **内容缩放后窄/矮于视口**（这一轴本来就整体可见）→ 直接用 `aligned`：该轴不做节点居中，
 *   否则纸会为了把一个小格子居中而整体平移，产生一侧留白。
 * - **内容超出视口** → 允许居中，但把平移量钳进「内容边缘不越过视口边缘」的区间：
 *   水平 `[右缘贴 V, 左缘贴 0]`，垂直 `[下缘贴 Vh, 上缘贴 TOP_GAP]`。
 *
 * 于是「hover 页面顶部的格子」只会落到 `TOP_GAP`（内容几乎不动），
 * 「hover 页面中部的格子」才是真居中 —— 两种都在视野内，且纸张不会飞出屏幕。
 */
export function restrictCenterPanToContent(
  input: RestrictCenterPanInput,
): AlignPan {
  const {
    aligned,
    centered,
    viewportWidth: V,
    viewportHeight: Vh,
    scalerWidth: W,
    scalerHeight: H,
    contentLeft: cl,
    contentTop: ct,
    contentWidth: cw,
    contentHeight: ch,
    scale: s,
  } = input;

  if (
    !(s > 0) ||
    !(V > 0) ||
    !(Vh > 0) ||
    !(W > 0) ||
    !(H > 0)
  ) {
    return { x: 0, y: 0 };
  }

  // `screen(p) = O + s·(p + t − O)` 的反解：给定「内容某条边应落在屏幕何处」，求 t。
  const txForScreenX = (p: number, screenX: number): number =>
    (screenX - W / 2) / s + W / 2 - p;
  const tyForScreenY = (p: number, screenY: number): number =>
    (screenY - H / 2) / s + H / 2 - p;

  const x =
    cw * s <= V
      ? aligned.x
      : Math.min(
          // 内容左缘贴视口左缘（内容最靠右）
          txForScreenX(cl, 0),
          Math.max(
            // 内容右缘贴视口右缘（内容最靠左）
            txForScreenX(cl + cw, V),
            centered.x,
          ),
        );

  const y =
    ch * s <= Vh
      ? aligned.y
      : Math.min(
          // 内容上缘贴 TOP_GAP（内容最靠下）
          tyForScreenY(ct, TOP_GAP),
          Math.max(
            // 内容下缘贴视口底缘（内容最靠上）
            tyForScreenY(ct + ch, Vh),
            centered.y,
          ),
        );

  return { x, y };
}
