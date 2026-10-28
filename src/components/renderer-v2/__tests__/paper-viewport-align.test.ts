import { describe, expect, it } from "vitest";
import {
  computeAlignPan,
  computeCenterPan,
  restrictCenterPanToContent,
  type AlignPanInput,
  type CenterPanInput,
  type RestrictCenterPanInput,
} from "@/components/renderer-v2/paper-viewport-align";

/**
 * 纸张视口对齐解算测试。
 *
 * 用例尺寸与比例**取自 Chromium 实测**（探针照抄 PaperViewport / GridFormRenderer / 宿主 Detail 的 CSS，
 * 挂真 panzoom 后量 `getBoundingClientRect`）：
 * - A3 横向 420×297mm → 纸张 1587×1119px（含 296.5mm 固定纸高），容器 912×800（宿主 960px 抽屉 body 内宽），
 *   `fitWidth` 得 0.5747；
 * - A4 纵向 210×297mm → 纸张 794×1119px。
 *
 * 断言方式：复刻 panzoom 的映射 `screen(p) = O + s·(p + t − O)`（`O` = scaler 中心，即 transform-origin 50% 50%），
 * 用解算出的 `(x, y)` 投影出内容左上角，验证它确实落在「水平居中 / 垂直顶部对齐（留 18px）」的位置——
 * 即修掉实测到的「左空 194px、上空 238px、右 / 下各溢出同量」。
 */
/** 复刻 panzoom 的 transform 映射（元素内一点 → 视口内坐标）。 */
function project(input: AlignPanInput, pan: { x: number; y: number }) {
  const { scalerWidth, scalerHeight, contentLeft, contentTop, scale } = input;
  return {
    left: scalerWidth / 2 + scale * (contentLeft + pan.x - scalerWidth / 2),
    top: scalerHeight / 2 + scale * (contentTop + pan.y - scalerHeight / 2),
  };
}

/** A3 横向（420mm ≈ 1587px）落进 912×800 容器：宽适配后溢出，纸张在画布内左对齐。 */
const A3_IN_DRAWER: AlignPanInput = {
  viewportWidth: 912,
  viewportHeight: 800,
  scalerWidth: 912,
  scalerHeight: 1119,
  contentWidth: 1587,
  contentHeight: 1119,
  contentLeft: 0,
  contentTop: 0,
  scale: 0.5747,
};

describe("computeAlignPan（视口内容对齐解算）", () => {
  it("A3 横向落进 912×800：水平居中 + 垂直贴顶（留 18px），内容完整落在视口内", () => {
    const pan = computeAlignPan(A3_IN_DRAWER);
    // 实测未修正时：左空 194px、上空 238px；修正量 = 该偏移的反向
    expect(pan.x).toBeCloseTo(-337.5, 1);
    expect(pan.y).toBeCloseTo(-382.7, 1);

    const { left, top } = project(A3_IN_DRAWER, pan);
    const scaledW = A3_IN_DRAWER.contentWidth * A3_IN_DRAWER.scale;
    const scaledH = A3_IN_DRAWER.contentHeight * A3_IN_DRAWER.scale;
    // 水平：缩放后恰好铺满容器宽（912 = 912）→ 左右都不留白
    expect(left).toBeCloseTo((A3_IN_DRAWER.viewportWidth - scaledW) / 2, 1);
    expect(left).toBeCloseTo(0, 1);
    // 垂直：首页贴顶，留 18px 间隔（不居中，否则窄纸会被推到视口中部）
    expect(top).toBeCloseTo(18, 1);
    expect(top + scaledH).toBeLessThanOrEqual(A3_IN_DRAWER.viewportHeight);
  });

  it("两页 A3：缩放后高于视口 → 顶部对齐（首页贴顶留 18px，不居中，避免先切掉表单标题）", () => {
    const input: AlignPanInput = {
      ...A3_IN_DRAWER,
      scalerHeight: 2262, // 两页叠高（含 24px 页间距）
      contentHeight: 2262,
    };
    const pan = computeAlignPan(input);
    expect(project(input, pan).top).toBeCloseTo(18, 1);
    // 实测未修正时上空 481px
    expect(pan.y).toBeLessThan(0);
  });

  it("A4 纵向落在宽容器（未缩放）：纸张本就居中 → 解算为贴顶（留 18px）", () => {
    const input: AlignPanInput = {
      viewportWidth: 912,
      viewportHeight: 800,
      scalerWidth: 912,
      scalerHeight: 1119,
      contentWidth: 912, // 画布宽（`scrollWidth` = clientWidth，纸张更窄不溢出）
      contentHeight: 1119,
      contentLeft: 0,
      contentTop: 0,
      scale: 1,
    };
    const pan = computeAlignPan(input);
    expect(pan.x).toBeCloseTo(0, 6);
    // 内容高于视口（1119 > 800）→ 顶部对齐，首页贴顶留 18px
    expect(pan.y).toBeCloseTo(18, 6);
    expect(project(input, pan).top).toBeCloseTo(18, 1);
  });

  it("A4 纵向落在高容器（未缩放）：内容完整可见 → 贴顶留 18px（不居中）", () => {
    const input: AlignPanInput = {
      viewportWidth: 912,
      viewportHeight: 1336,
      scalerWidth: 912,
      scalerHeight: 1119,
      contentWidth: 912,
      contentHeight: 1119,
      contentLeft: 0,
      contentTop: 0,
      scale: 1,
    };
    const pan = computeAlignPan(input);
    expect(project(input, pan).top).toBeCloseTo(18, 1);
  });

  it("宽纸张在窄容器、100% 缩放：水平居中（两侧均匀裁切，而非只露左缘）", () => {
    const input: AlignPanInput = {
      viewportWidth: 700,
      viewportHeight: 600,
      scalerWidth: 700,
      scalerHeight: 1119,
      contentWidth: 794,
      contentHeight: 1119,
      contentLeft: 0,
      contentTop: 0,
      scale: 1,
    };
    const pan = computeAlignPan(input);
    expect(project(input, pan).left).toBeCloseTo((700 - 794) / 2, 1);
  });

  it("尺寸信息缺失（jsdom / 未布局）：返回 0 平移，不抛错、不误位移", () => {
    expect(
      computeAlignPan({
        viewportWidth: 0,
        viewportHeight: 0,
        scalerWidth: 0,
        scalerHeight: 0,
        contentWidth: 0,
        contentHeight: 0,
        contentLeft: 0,
        contentTop: 0,
        scale: 1,
      }),
    ).toEqual({ x: 0, y: 0 });
    expect(computeAlignPan({ ...A3_IN_DRAWER, scale: 0 })).toEqual({ x: 0, y: 0 });
    expect(computeAlignPan({ ...A3_IN_DRAWER, scalerHeight: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("幂等：对已对齐的结果再解一次，仍回到同一落点", () => {
    const pan1 = computeAlignPan(A3_IN_DRAWER);
    const { left, top } = project(A3_IN_DRAWER, pan1);
    // 对齐不改布局：scaler / 内容的 offset、client、scroll 尺寸均不变 → 复算得同一平移量
    const pan2 = computeAlignPan(A3_IN_DRAWER);
    expect(pan2.x).toBeCloseTo(pan1.x, 6);
    expect(pan2.y).toBeCloseTo(pan1.y, 6);
    expect(project(A3_IN_DRAWER, pan2)).toEqual({ left, top });
  });
});

/**
 * `computeCenterPan`：左侧结构树选中 / 悬浮时「把某节点锚定到视口正中」。
 *
 * 同一映射式 `screen(p) = O + s·(p + t − O)`，故这里同样用 `project` 投影出目标节点中心，
 * 断言它落在视口中心——垂直方向与 `computeAlignPan` **不同**（那里贴顶），这是需求使然。
 */
describe("computeCenterPan（节点锚定居中）", () => {
  /** 复刻映射：目标节点中心（布局坐标）→ 视口坐标。 */
  function projectCenter(
    input: CenterPanInput,
    pan: { x: number; y: number },
  ): { cx: number; cy: number } {
    const { scalerWidth, scalerHeight, targetLeft, targetTop, targetWidth, targetHeight, scale } =
      input;
    const cx = targetLeft + targetWidth / 2;
    const cy = targetTop + targetHeight / 2;
    return {
      cx: scalerWidth / 2 + scale * (cx + pan.x - scalerWidth / 2),
      cy: scalerHeight / 2 + scale * (cy + pan.y - scalerHeight / 2),
    };
  }

  /** A4 一页（纸 794×1119）落在 912×800 视口，第 3 行节点在纸内偏下（y ≈ 900px）。 */
  const NEAR_BOTTOM: CenterPanInput = {
    viewportWidth: 912,
    viewportHeight: 800,
    scalerWidth: 912,
    scalerHeight: 1119,
    targetLeft: 100,
    targetTop: 900,
    targetWidth: 200,
    targetHeight: 40,
    scale: 1,
  };

  it("100% 缩放：目标中心投影到视口正中（上下都居中的，不是贴顶）", () => {
    const pan = computeCenterPan(NEAR_BOTTOM);
    const { cx, cy } = projectCenter(NEAR_BOTTOM, pan);
    expect(cx).toBeCloseTo(912 / 2, 6);
    expect(cy).toBeCloseTo(800 / 2, 6);
    // 节点在纸下方 → 必须把内容往上推（平移量为负）
    expect(pan.y).toBeLessThan(0);
  });

  it("缩放后仍居中：比例参与解算（不需要预先换算成缩放坐标）", () => {
    for (const scale of [0.5, 0.5747, 1.5, 2]) {
      const input: CenterPanInput = { ...NEAR_BOTTOM, scale };
      const { cx, cy } = projectCenter(input, computeCenterPan(input));
      expect(cx).toBeCloseTo(912 / 2, 6);
      expect(cy).toBeCloseTo(800 / 2, 6);
    }
  });

  it("视口比缩放层窄（抽屉打开）：依然按视口中心解算，不按缩放层中心", () => {
    const input: CenterPanInput = {
      ...NEAR_BOTTOM,
      viewportWidth: 600,
      viewportHeight: 500,
      scalerWidth: 912,
      scalerHeight: 1119,
      scale: 0.8,
    };
    const { cx, cy } = projectCenter(input, computeCenterPan(input));
    expect(cx).toBeCloseTo(300, 6);
    expect(cy).toBeCloseTo(250, 6);
  });

  it("幂等：同一布局重复解算得同一平移量（offset* 不受 transform 影响）", () => {
    const pan1 = computeCenterPan(NEAR_BOTTOM);
    const pan2 = computeCenterPan(NEAR_BOTTOM);
    expect(pan2).toEqual(pan1);
  });

  it("尺寸缺失（jsdom / 未布局）：返回 0 平移，不抛错、不误位移", () => {
    expect(
      computeCenterPan({
        viewportWidth: 0,
        viewportHeight: 0,
        scalerWidth: 0,
        scalerHeight: 0,
        targetLeft: 0,
        targetTop: 0,
        targetWidth: 0,
        targetHeight: 0,
        scale: 1,
      }),
    ).toEqual({ x: 0, y: 0 });
    expect(computeCenterPan({ ...NEAR_BOTTOM, scale: 0 })).toEqual({ x: 0, y: 0 });
    expect(computeCenterPan({ ...NEAR_BOTTOM, scalerWidth: 0 })).toEqual({ x: 0, y: 0 });
  });
});

/**
 * `restrictCenterPanToContent`：给节点居中加「内容不得被推出视口」的约束。
 *
 * 起因是实报（2026-10-28）：A4 空白页、`translate(0, 0)`，结构 页面-网格-格子，
 * hover 第一行格子后变成 `translate(0, 369.04)` —— 纸张被往下推、上半屏空出来。
 * 几何上没错（格子中心在内容 y≈30.96，居中就得下移 369），但体验不可接受。
 */
describe("restrictCenterPanToContent（居中不得把内容推出视口）", () => {
  /**
   * A4 空白页落进 960×800 视口（`s = 1`）：画布 = 视口宽 960、内容高 1119、贴顶无偏移。
   * 内容高 1119 > 视口 800 ⇒ 垂直允许居中但要钳制；内容宽 960 = 视口宽 ⇒ 水平不参与居中。
   */
  const A4: Omit<RestrictCenterPanInput, "aligned" | "centered"> = {
    viewportWidth: 960,
    viewportHeight: 800,
    scalerWidth: 960,
    scalerHeight: 1121,
    contentLeft: 0,
    contentTop: 0,
    contentWidth: 960,
    contentHeight: 1119,
    scale: 1,
  };
  /** 内容整体对齐解：水平居中、垂直贴顶留 18px。 */
  const A4_ALIGNED = { x: 0, y: 18 };

  it("hover 第一行格子（居中解 y = +369.04）→ 钳到 TOP_GAP，纸张不再被往下推", () => {
    const { x, y } = restrictCenterPanToContent({
      ...A4,
      aligned: A4_ALIGNED,
      centered: { x: 0, y: 369.039 },
    });
    // 垂直：内容上缘最多贴到 18px，不能更靠下
    expect(y).toBeCloseTo(18, 6);
    expect(y).toBeGreaterThan(0); // 仍是「下移」，但只有 18px
    // 水平：内容宽 = 视口宽 ⇒ 该轴不参与节点居中，直接用对齐解
    expect(x).toBe(A4_ALIGNED.x);
  });

  it("hover 中部格子（居中解落在合法区间内）→ 真居中，不被钳", () => {
    const centered = { x: 0, y: -200 };
    const { y } = restrictCenterPanToContent({ ...A4, aligned: A4_ALIGNED, centered });
    expect(y).toBeCloseTo(-200, 6);
  });

  it("hover 末行格子（居中解 y = -600 越下界）→ 钳到「内容下缘贴视口底」，不露出纸外空白", () => {
    const { y } = restrictCenterPanToContent({
      ...A4,
      aligned: A4_ALIGNED,
      centered: { x: 0, y: -600 },
    });
    // 下界 = 内容下缘(1119) 贴到视口底(800)
    expect(y).toBeCloseTo(800 - 1119, 6);
  });

  it("内容窄于视口（A4 纸 794 宽落在 960 视口）→ 水平不参与居中，避免为一格而横向平移整张纸", () => {
    const narrow = { ...A4, contentWidth: 794, scale: 1 };
    const { x } = restrictCenterPanToContent({
      ...narrow,
      aligned: { x: 83, y: 18 },
      centered: { x: -120, y: -200 },
    });
    expect(x).toBe(83);
  });

  it("内容整体矮于视口（单页纸落进高容器）→ 垂直也不参与居中，保持贴顶对齐", () => {
    const short = { ...A4, viewportHeight: 1400 };
    const { y } = restrictCenterPanToContent({
      ...short,
      aligned: { x: 0, y: 18 },
      centered: { x: 0, y: 300 },
    });
    expect(y).toBe(18);
  });

  it("内容超出视口且位于深处时按比例解算（s ≠ 1）", () => {
    const zoomed = { ...A4, scale: 0.5 };
    const { y } = restrictCenterPanToContent({
      ...zoomed,
      aligned: { x: 0, y: 18 },
      // 内容高 1119×0.5 = 559.5 < 视口 800 ⇒ 该轴不居中，直接取对齐解
      centered: { x: 0, y: -400 },
    });
    expect(y).toBe(18);
  });

  it("尺寸缺失：返回 0 平移，不抛错", () => {
    expect(
      restrictCenterPanToContent({
        aligned: { x: 5, y: 6 },
        centered: { x: 7, y: 8 },
        viewportWidth: 0,
        viewportHeight: 0,
        scalerWidth: 0,
        scalerHeight: 0,
        contentLeft: 0,
        contentTop: 0,
        contentWidth: 0,
        contentHeight: 0,
        scale: 1,
      }),
    ).toEqual({ x: 0, y: 0 });
  });
});
