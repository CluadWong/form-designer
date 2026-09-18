import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import PaperViewport from "@/components/renderer-v2/PaperViewport.vue";
import {
  __getLastOptions,
  __getLastPan,
  __getPz,
  __resetPzRegistry,
} from "@/test-utils/panzoom-stub";

/**
 * PaperViewport（表面层 · 浏览缩放）测试。
 *
 * @panzoom/panzoom 在 jsdom 下经 vitest resolve.alias 指向 `panzoom-stub` 轻量替身
 * （**复刻真实库的构造语义**：立即 `zoom(startScale)`，并把 `pan(startX, startY)` 延后到 setTimeout），
 * 仅实现本组件实际调用的方法（getScale / zoom / pan / reset / zoomWithWheel / resetStyle / destroy），
 * 并经由 `__getPz` / `__getLastOptions` / `__getLastPan` 暴露最近实例、入参与平移量供断言。重点验证：
 * - 工具栏渲染与初始百分比；
 * - 放大/缩小按钮按 1.2 倍步进调用 zoom（并受 min/max 钳制）；
 * - panzoomchange 原生事件驱动百分比文本与 scale-change 发射；
 * - jsdom（clientWidth/scrollWidth=0）下 fitWidth 安全回退 initialScale，不抛错；
 * - fitWidth / 重置在缩放之后调用 `pan` 把内容对齐进视口（jsdom 尺寸为 0 → 平移量 0）；
 * - 有布局尺寸时，「适应宽度 + 对齐」的目标被写进 panzoom **起始值**，且不被构造器延后的
 *   `pan(0, 0)` 清零（A3 横向首次挂载偏移的回归）；
 * - 滚轮在非控件区域交给 zoomWithWheel、在表单控件上放行原生滚动；
 * - onBeforeUnmount 复位样式并销毁。
 */
beforeEach(() => {
  __resetPzRegistry();
});

/**
 * 伪造布局尺寸：jsdom 无排版引擎，`clientWidth / scrollWidth` 恒为 0，
 * 无法覆盖「按真实尺寸解算落点」的路径。故在 `HTMLElement.prototype` 上按类名挂 getter，
 * 使挂载期（onMounted 内的测量）也能读到尺寸——A3 回归用例必须依赖它。
 */
const LAYOUT = {
  vpWidth: 960,
  vpHeight: 800,
  scalerHeight: 1121,
  contentWidth: 1587, // A3 横向 420mm ≈ 1587px
  contentHeight: 1121,
};
const savedLayoutDescriptors: Array<[string, PropertyDescriptor | undefined]> = [];

function installLayout(): void {
  const isVp = (el: HTMLElement) => el.classList.contains("paper-viewport");
  const isScaler = (el: HTMLElement) => el.classList.contains("paper-viewport__scaler");
  const defs: Array<[string, (el: HTMLElement) => number]> = [
    // 视口 / scaler 的宽即容器宽；内容（scaler 的首个子元素，缺省回退 scaler 自身）取内容尺寸。
    ["clientWidth", (el) => (isVp(el) || isScaler(el) ? LAYOUT.vpWidth : LAYOUT.contentWidth)],
    ["clientHeight", (el) => (isVp(el) ? LAYOUT.vpHeight : LAYOUT.scalerHeight)],
    ["scrollWidth", (el) => (isVp(el) ? LAYOUT.vpWidth : LAYOUT.contentWidth)],
    ["scrollHeight", (el) => (isVp(el) ? LAYOUT.vpHeight : LAYOUT.contentHeight)],
  ];
  for (const [prop, read] of defs) {
    savedLayoutDescriptors.push([prop, Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)]);
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        return read(this);
      },
    });
  }
}

function restoreLayout(): void {
  for (const [prop, descriptor] of savedLayoutDescriptors) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, prop, descriptor);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  }
  savedLayoutDescriptors.length = 0;
}

describe("PaperViewport（纸张视口 · 浏览缩放）", () => {
  it("挂载即创建 panzoom，并以 props 透传缩放边界/光标", () => {
    mount(PaperViewport, { props: { initialScale: 1, minScale: 0.2, maxScale: 4 } });
    const opts = __getLastOptions() as Record<string, unknown> | undefined;
    expect(opts).toBeTruthy();
    expect(opts).toMatchObject({ minScale: 0.2, maxScale: 4, startScale: 1, cursor: "grab" });
  });

  it("工具栏渲染：初始显示 100%，含放大/缩小/适应/重置按钮", () => {
    const wrapper = mount(PaperViewport);
    expect(wrapper.find(".paper-viewport__bar").exists()).toBe(true);
    expect(wrapper.find(".paper-viewport__scale").text()).toBe("100%");
    expect(wrapper.find('button[title="缩小"]').exists()).toBe(true);
    expect(wrapper.find('button[title="放大"]').exists()).toBe(true);
    expect(wrapper.find('button[title="适应宽度"]').exists()).toBe(true);
    expect(wrapper.find('button[title="重置为 100%"]').exists()).toBe(true);
  });

  it("放大按钮：当前比例 1 时以 1.2 步进调用 zoom", async () => {
    const wrapper = mount(PaperViewport);
    await wrapper.find('button[title="放大"]').trigger("click");
    expect(__getPz().zoom).toHaveBeenCalledWith(1.2);
  });

  it("缩小按钮：当前比例 1 时以 1/1.2 步进调用 zoom", async () => {
    const wrapper = mount(PaperViewport, { props: { minScale: 0.2 } });
    await wrapper.find('button[title="缩小"]').trigger("click");
    expect(__getPz().zoom).toHaveBeenCalledWith(1 / 1.2);
  });

  it("重置按钮：回到 100% 并对齐（不再走 pz.reset —— 它会把平移写成构造器起始值）", async () => {
    const wrapper = mount(PaperViewport);
    await wrapper.find('button[title="重置为 100%"]').trigger("click");
    expect(__getPz().zoom).toHaveBeenCalledWith(1, { animate: false, force: true });
    expect(__getPz().reset).not.toHaveBeenCalled();
  });

  it("panzoomchange 原生事件：更新百分比文本并发射 scale-change", async () => {
    const wrapper = mount(PaperViewport);
    const scaler = wrapper.find(".paper-viewport__scaler").element;
    scaler.dispatchEvent(new CustomEvent("panzoomchange", { detail: { scale: 1.5 } }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".paper-viewport__scale").text()).toBe("150%");
    expect(wrapper.emitted("scale-change")?.[0]).toEqual([1.5]);
  });

  it("适应宽度：jsdom 下 clientWidth/scrollWidth 均为 0，安全回退 initialScale", async () => {
    const wrapper = mount(PaperViewport, { props: { initialScale: 1 } });
    await expect(
      wrapper.find('button[title="适应宽度"]').trigger("click"),
    ).resolves.not.toThrow();
    // 回退路径：pz.zoom(initialScale)
    expect(__getPz().zoom).toHaveBeenCalledWith(1);
  });

  it("适应宽度：缩放之后调用 pan 把内容对齐进视口（jsdom 尺寸为 0 → 平移量 0）", async () => {
    const wrapper = mount(PaperViewport, { props: { initialScale: 1 } });
    await wrapper.find('button[title="适应宽度"]').trigger("click");
    expect(__getPz().pan).toHaveBeenCalledWith(0, 0, { animate: false, force: true });
  });

  it("重置为 100%：拉到 100% 之后同样把内容对齐进视口", async () => {
    const wrapper = mount(PaperViewport, { props: { initialScale: 1 } });
    await wrapper.find('button[title="重置为 100%"]').trigger("click");
    expect(__getPz().zoom).toHaveBeenCalledWith(1, { animate: false, force: true });
    expect(__getPz().pan).toHaveBeenCalledWith(0, 0, { animate: false, force: true });
  });

  it("fitOnMount：把「适应宽度 + 对齐」目标写进 panzoom 起始值（而非挂载后同步 pan）", async () => {
    const wrapper = mount(PaperViewport, { props: { fitOnMount: true } });
    // jsdom 无布局（尺寸 0）→ 目标退化为 initialScale + 零平移，但仍须作为构造器起始值传入，
    // 因为真实 panzoom 会把 `pan(startX, startY)` 延后到 setTimeout，晚于挂载期任何同步 pan。
    expect(__getLastOptions()).toMatchObject({ startScale: 1, startX: 0, startY: 0, cursor: "grab" });
    // 构造器的延后 pan 之后还有一次兜底重排（复位被误置的用户干预标记并按最新布局对齐）
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(__getPz().pan).toHaveBeenCalledWith(0, 0, { animate: false, force: true });
    wrapper.unmount();
  });

  it("未开启 fitOnMount：不写入适应宽度起始值（设计态保持原始落点）", () => {
    installLayout();
    try {
      mount(PaperViewport);
      const opts = __getLastOptions() as { startScale: number; startX: number; startY: number };
      // 即便内容远宽于视口，未开启时也不得把缩放/平移写进起始值
      expect(opts.startScale).toBe(1);
      expect(opts.startX).toBe(0);
      expect(opts.startY).toBe(0);
    } finally {
      restoreLayout();
    }
  });

  it("回归：首次挂载的落点不被构造器的延后 pan(0, 0) 清零（A3 横向 420mm 落进 960 抽屉）", async () => {
    installLayout();
    try {
      const wrapper = mount(PaperViewport, { props: { fitOnMount: true } });
      // 起始值必须是解算出的目标：scale = 960/1587，y = (18 − 1121/2)/s + 1121/2，x = (960 − 1587)/2
      const opts = __getLastOptions() as { startScale: number; startX: number; startY: number };
      expect(opts.startScale).toBeCloseTo(0.6049, 3);
      expect(opts.startX).toBeCloseTo(-313.5, 1);
      expect(opts.startY).toBeCloseTo(-336.32, 1);

      // 放行构造器那个延后的 pan(startX, startY) 与随后的兜底重排
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));

      // 最终落点仍是目标值 —— 若起始值走默认 0，这里会是 [0, 0]（纸张整体偏移的根因）
      const lastPan = __getLastPan();
      expect(lastPan?.[0]).toBeCloseTo(-313.5, 1);
      expect(lastPan?.[1]).toBeCloseTo(-336.32, 1);
      wrapper.unmount();
    } finally {
      restoreLayout();
    }
  });

  it("滚轮：空白区域交给 zoomWithWheel；表单控件上放行原生滚动不触发缩放", async () => {
    const wrapper = mount(PaperViewport, {
      slots: { default: '<input class="ctl" />' },
    });
    const viewport = wrapper.find(".paper-viewport").element;
    // 非控件：事件 target = 视口本身 → 走 zoomWithWheel
    viewport.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    expect(__getPz().zoomWithWheel).toHaveBeenCalledTimes(1);

    // 控件：target = input（含 contenteditable 也被排除）→ 不触发缩放
    const input = wrapper.find("input.ctl").element;
    input.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    expect(__getPz().zoomWithWheel).toHaveBeenCalledTimes(1); // 次数不变
  });

  it("onBeforeUnmount：复位 panzoom 内联样式并销毁实例", () => {
    const wrapper = mount(PaperViewport);
    wrapper.unmount();
    expect(__getPz().resetStyle).toHaveBeenCalledTimes(1);
    expect(__getPz().destroy).toHaveBeenCalledTimes(1);
  });

  it("设计态 draggable 节点切到预览（移除 draggable）后，过期 panzoom-exclude 被清除、可平移", async () => {
    const wrapper = mount(PaperViewport, {
      attachTo: document.body,
      slots: { default: '<div class="node" draggable="true">design node</div>' },
    });
    const node = wrapper.find(".node").element as HTMLElement;
    // 设计态：draggable 命中选择器 → 打上 panzoom-exclude（被排除，不平移）
    expect(node.classList.contains("panzoom-exclude")).toBe(true);

    // 切到预览态：CanvasSurface 移除 draggable
    node.removeAttribute("draggable");
    // 等 MutationObserver（attributeFilter: draggable）触发 reconcile
    await new Promise((r) => setTimeout(r, 0));

    // 过期标记被清除 → 节点不再被排除，可正常平移（拖拽非输入组件允许平移）
    expect(node.classList.contains("panzoom-exclude")).toBe(false);
    wrapper.unmount();
  });

  it("字段（contenteditable）在 draggable 移除后仍保持排除，输入不被平移吞掉", async () => {
    const wrapper = mount(PaperViewport, {
      attachTo: document.body,
      slots: {
        default: '<p class="field" draggable="true" contenteditable="true">field</p>',
      },
    });
    const field = wrapper.find(".field").element as HTMLElement;
    expect(field.classList.contains("panzoom-exclude")).toBe(true);

    // 切到预览态：draggable 移除，但 contenteditable（真实输入区）仍在
    field.removeAttribute("draggable");
    await new Promise((r) => setTimeout(r, 0));

    // 仅 contenteditable 命中 → 仍被排除（字段可输入、不平移）
    expect(field.classList.contains("panzoom-exclude")).toBe(true);
    wrapper.unmount();
  });

  it("空格长按平移：keydown 空格给视口加 is-space-pan，keyup 移除；输入态空格不触发", async () => {
    const wrapper = mount(PaperViewport, {
      attachTo: document.body,
      slots: { default: '<div class="node" draggable="true">design node</div>' },
    });
    const vp = wrapper.find(".paper-viewport").element as HTMLElement;

    // 初始未进入平移态
    expect(vp.classList.contains("is-space-pan")).toBe(false);

    // 空白区域按下空格 → 进入平移态（事件冒泡到 window 监听）
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(vp.classList.contains("is-space-pan")).toBe(true);

    // 松开空格 → 退出平移态
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", key: " ", bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(vp.classList.contains("is-space-pan")).toBe(false);

    // 在 contenteditable 字段内按下空格（target 命中输入区）→ 不进入平移态，空格正常输入
    const field = document.createElement("div");
    field.setAttribute("contenteditable", "true");
    document.body.appendChild(field);
    field.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(vp.classList.contains("is-space-pan")).toBe(false);
    field.remove();

    wrapper.unmount();
  });

  it("空格长按平移：卸载时移除 window 键盘监听，不残留 is-space-pan", () => {
    const wrapper = mount(PaperViewport, { attachTo: document.body });
    const vp = wrapper.find(".paper-viewport").element as HTMLElement;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true }));
    expect(vp.classList.contains("is-space-pan")).toBe(true);
    wrapper.unmount();
    // 卸载后即便再收到 keydown 也不再响应（监听已移除）
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true }));
    const detached = document.querySelector(".paper-viewport");
    // 组件已卸载，DOM 中不应再有 .paper-viewport，或即便有也不再被本实例控管
    expect(detached === null || !detached.classList.contains("is-space-pan")).toBe(true);
  });
});

/**
 * 尺寸变化自愈（2026-09-18）：jsdom 无布局，用 ResizeObserver 桩验证「观察哪些盒 + 何时重排」。
 *
 * 背景：消费页在同一实例上切换 `schema`（换表单）时视口不重建，而 fit / 对齐只在挂载时跑一次；
 * 且分页校正会二次改变内容高（`alignContent` 的平移量依赖 scaler 高）。故除容器（vp）外还需
 * 观察 scaler，并在内容变化时重排；用户手动干预后则不再自动干预。
 */
describe("PaperViewport（尺寸变化自愈）", () => {
  class ROStub {
    static instances: ROStub[] = [];
    cb: ResizeObserverCallback;
    targets: Element[] = [];
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
      ROStub.instances.push(this);
    }
    observe(t: Element): void {
      this.targets.push(t);
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  const originalRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;

  beforeEach(() => {
    ROStub.instances = [];
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ROStub;
  });
  afterEach(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalRO;
  });

  /** stub 的 `pan` 由 `vi.fn` 生成，但其对外类型是普通函数签名 → 断言调用次数需取 `.mock`。 */
  const panCallCount = (): number =>
    (__getPz().pan as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

  it("fitOnMount：同时观察视口与 scaler（内容高变化才能触发重排）", () => {
    const wrapper = mount(PaperViewport, { props: { fitOnMount: true } });
    expect(ROStub.instances.length).toBe(1);
    const ro = ROStub.instances[0];
    const vp = wrapper.find(".paper-viewport").element;
    const scaler = wrapper.find(".paper-viewport__scaler").element;
    expect(ro.targets).toContain(vp);
    expect(ro.targets).toContain(scaler);
    wrapper.unmount();
  });

  it("内容尺寸变化（未手动干预）→ 重新适应宽度 + 对齐", () => {
    const wrapper = mount(PaperViewport, { props: { fitOnMount: true } });
    const ro = ROStub.instances[0];
    const before = panCallCount();
    ro.cb([], ro as unknown as ResizeObserver);
    expect(panCallCount()).toBe(before + 1);
    wrapper.unmount();
  });

  it("用户手动缩放后，内容尺寸变化不再自动重排（保留用户视图）", async () => {
    const wrapper = mount(PaperViewport, { props: { fitOnMount: true } });
    await wrapper.find('button[title="放大"]').trigger("click"); // userAdjusted = true
    const ro = ROStub.instances[0];
    const before = panCallCount();
    ro.cb([], ro as unknown as ResizeObserver);
    expect(panCallCount()).toBe(before);
    wrapper.unmount();
  });

  it("未开启 fitOnMount：不建观察者（设计态保持原始落点）", () => {
    const wrapper = mount(PaperViewport);
    expect(ROStub.instances.length).toBe(0);
    wrapper.unmount();
  });

  it("回归：构造器延后的 pan 不得把「用户手动干预」误置（否则此后尺寸变化不再自愈）", async () => {
    installLayout();
    try {
      const wrapper = mount(PaperViewport, { props: { fitOnMount: true } });
      // 放行构造器延后的 `pan(startX, startY)` 与紧随其后的兜底重排
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      const ro = ROStub.instances[0];
      const before = panCallCount();
      ro.cb([], ro as unknown as ResizeObserver);
      // 该次 pan 事件派发在程序化窗口之外，若被误记为「用户拖拽」则此处不会重排
      expect(panCallCount()).toBe(before + 1);
      wrapper.unmount();
    } finally {
      restoreLayout();
    }
  });
});
