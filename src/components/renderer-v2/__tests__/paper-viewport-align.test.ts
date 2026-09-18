import { describe, expect, it } from "vitest";
import { computeAlignPan, type AlignPanInput } from "@/components/renderer-v2/paper-viewport-align";

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
