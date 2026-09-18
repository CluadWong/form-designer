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
