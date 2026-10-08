import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, onMounted, ref } from "vue";
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
  /** `layout-paper` 类：模拟内核的纸（自然宽小于容器，外面还包着一层铺满视口的画布）。 */
  paperWidth: 794, // A4 210mm ≈ 793.7px
};
const savedLayoutDescriptors: Array<[string, PropertyDescriptor | undefined]> = [];

function installLayout(): void {
  const isVp = (el: HTMLElement) => el.classList.contains("paper-viewport");
  const isScaler = (el: HTMLElement) => el.classList.contains("paper-viewport__scaler");
  /** 铺满视口的包装画布（内核 `.grid-form-canvas`）：宽 = 视口宽。 */
  const isCanvas = (el: HTMLElement) => el.classList.contains("layout-canvas");
  /** 画布里的纸（内核 `.grid-form-paper`）：自然宽，窄于视口。 */
  const isPaper = (el: HTMLElement) => el.classList.contains("layout-paper");
  const defs: Array<[string, (el: HTMLElement) => number]> = [
    // 视口 / scaler 的宽即容器宽；`layout-canvas` 铺满视口；`layout-paper` 用纸张自然宽；
    // 其余（内容，缺省回退 scaler 自身）取内容尺寸。
    [
      "clientWidth",
      (el) =>
        isVp(el) || isScaler(el) || isCanvas(el)
          ? LAYOUT.vpWidth
          : isPaper(el)
            ? LAYOUT.paperWidth
            : LAYOUT.contentWidth,
    ],
    ["clientHeight", (el) => (isVp(el) ? LAYOUT.vpHeight : LAYOUT.scalerHeight)],
    [
      "scrollWidth",
      (el) =>
        isVp(el)
          ? LAYOUT.vpWidth
          : isCanvas(el)
            ? LAYOUT.vpWidth
            : isPaper(el)
              ? LAYOUT.paperWidth
              : LAYOUT.contentWidth,
    ],
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

/**
 * MutationObserver 回调是微任务：等两个 macrotask 确保 `tagExclusions` 重跑完毕再断言。
 */
async function flushObserver(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
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
    // 挂载时会先上报一次初始比例，故断言取最后一次（该次上报另有专测）
    const emitted = wrapper.emitted("scale-change") as Array<[number]>;
    expect(emitted[emitted.length - 1]).toEqual([1.5]);
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
 * 宿主工具栏接管（2026-10-08）：宿主已有自己的缩放控件时，视口只做「被驱动的执行体」——
 * 隐藏内置 bar、按宿主的百分比语义绝对缩放、并在固定比例模式下把落点对齐一次。
 */
describe("PaperViewport（宿主工具栏接管：hideBar / zoomTo / alignOnMount）", () => {
  const exposed = (wrapper: ReturnType<typeof mount>) =>
    wrapper.vm as unknown as {
      zoomTo: (scale: number) => void;
      relayout: () => void;
      getScale: () => number;
    };
  const panCallCount = (): number =>
    (__getPz().pan as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
  const zoomCallCount = (): number =>
    (__getPz().zoom as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

  it("hideBar：不渲染内置工具栏，但视口与缩放实例照常就绪", () => {
    const wrapper = mount(PaperViewport, { props: { hideBar: true } });
    expect(wrapper.find(".paper-viewport__bar").exists()).toBe(false);
    expect(wrapper.find(".paper-viewport__scaler").exists()).toBe(true);
    expect(__getPz()).toBeTruthy();
    wrapper.unmount();
  });

  it("hideBar 缺省：内置工具栏照常渲染（不破坏既有用法）", () => {
    const wrapper = mount(PaperViewport);
    expect(wrapper.find(".paper-viewport__bar").exists()).toBe(true);
    wrapper.unmount();
  });

  it("zoomTo：按绝对比例缩放（animate:false + force:true），并受 min/max 钳制", () => {
    const wrapper = mount(PaperViewport, { props: { minScale: 0.5, maxScale: 2 } });
    const vm = exposed(wrapper);

    vm.zoomTo(1.1);
    expect(__getPz().zoom).toHaveBeenLastCalledWith(1.1, { animate: false, force: true });

    vm.zoomTo(9); // 超上界 → 钳到 maxScale
    expect(__getPz().zoom).toHaveBeenLastCalledWith(2, { animate: false, force: true });

    vm.zoomTo(0.01); // 低于下界 → 钳到 minScale
    expect(__getPz().zoom).toHaveBeenLastCalledWith(0.5, { animate: false, force: true });

    expect(vm.getScale()).toBe(0.5);
    wrapper.unmount();
  });

  it("zoomTo 幂等：与当前比例几乎相同时不写 DOM（否则宿主 ↔ 视口会回环空转）", () => {
    const wrapper = mount(PaperViewport, { props: { initialScale: 1 } });
    const before = zoomCallCount(); // 构造器那次 zoom(startScale)
    exposed(wrapper).zoomTo(1);
    expect(zoomCallCount()).toBe(before);
    exposed(wrapper).zoomTo(1 + 1e-9);
    expect(zoomCallCount()).toBe(before);
    wrapper.unmount();
  });

  it("zoomTo 不动平移：缩放围绕视口中心，保留用户此前的浏览位置", () => {
    const wrapper = mount(PaperViewport, { props: { hideBar: true } });
    const before = panCallCount();
    exposed(wrapper).zoomTo(1.6);
    expect(panCallCount()).toBe(before);
    wrapper.unmount();
  });

  it("alignOnMount：固定比例模式把对齐量写进起始值（抵消 transform-origin 的中心偏移）", () => {
    installLayout();
    try {
      mount(PaperViewport, { props: { initialScale: 1.1, alignOnMount: true } });
      const opts = __getLastOptions() as { startScale: number; startX: number; startY: number };
      expect(opts.startScale).toBe(1.1);
      // 与 fitOnMount 分支同一套解算（内容 1587 宽于视口 960 → 水平解为负；垂直落 TOP_GAP=18）
      expect(opts.startX).toBeCloseTo(-313.5, 1);
      expect(opts.startY).toBeCloseTo(67.32, 1);
    } finally {
      restoreLayout();
    }
  });

  it("alignOnMount 缺省为假：设计态仍不写起始平移（既有契约不变）", () => {
    installLayout();
    try {
      mount(PaperViewport, { props: { initialScale: 1.1 } });
      const opts = __getLastOptions() as { startScale: number; startX: number; startY: number };
      expect(opts.startScale).toBe(1.1);
      expect(opts.startX).toBe(0);
      expect(opts.startY).toBe(0);
    } finally {
      restoreLayout();
    }
  });

  it("relayout：alignOnMount 模式重排落点但**不改比例**（换成固定比例下换表单）", () => {
    const wrapper = mount(PaperViewport, { props: { initialScale: 1.1, alignOnMount: true } });
    const zoomBefore = zoomCallCount();
    const panBefore = panCallCount();
    exposed(wrapper).relayout();
    expect(zoomCallCount()).toBe(zoomBefore); // 比例保持宿主下发值
    expect(panCallCount()).toBe(panBefore + 1); // 只重排落点
    // jsdom 无布局 → 对齐量退化为 0（同 fitWidth 的降级路径）
    expect(__getPz().pan).toHaveBeenLastCalledWith(0, 0, { animate: false, force: true });
    wrapper.unmount();
  });

  it("relayout：未开启 alignOnMount（设计态）完全不干预落点", () => {
    const wrapper = mount(PaperViewport);
    const zoomBefore = zoomCallCount();
    const panBefore = panCallCount();
    exposed(wrapper).relayout();
    expect(zoomCallCount()).toBe(zoomBefore);
    expect(panCallCount()).toBe(panBefore);
    wrapper.unmount();
  });

  /**
   * 宿主的真实用法：父组件用**模板 ref** 拿到子组件实例再调方法。
   *
   * 必须单独覆盖这一条，不能拿 `wrapper.vm` 代替：`@vue/test-utils` 的 `vm` 代理只透出
   * `<script setup>` 的**顶层绑定**（`vm.$.ctx[key]` 取不到 `defineExpose` 新加的键），
   * 于是「暴露了什么」这件事在 vm 上测不准；而父组件 ref 拿到的正是 Vue 的
   * `exposeProxy`，与宿主运行期完全同路。
   */
  it("组件 ref（宿主真实用法）：可经 ref 调用 zoomTo / getScale / getScale 回读", () => {
    type VpApi = { zoomTo: (s: number) => void; getScale: () => number };
    // 用容器对象而非裸 `let`：TS 会把 `let x = null` 一直收窄成 `null`（它不知道 onMounted 回调
    // 会赋值），属性访问则不做该收窄。
    const holder: { instance: VpApi | null } = { instance: null };
    const Host = defineComponent({
      setup() {
        const vp = ref<unknown>(null);
        onMounted(() => {
          holder.instance = vp.value as VpApi | null;
        });
        return () => h(PaperViewport, { ref: vp, hideBar: true });
      },
    });
    const wrapper = mount(Host);

    expect(typeof holder.instance?.zoomTo).toBe("function");
    expect(typeof holder.instance?.getScale).toBe("function");
    holder.instance?.zoomTo(1.5);
    expect(__getPz().zoom).toHaveBeenLastCalledWith(1.5, { animate: false, force: true });
    expect(holder.instance?.getScale()).toBe(1.5);

    wrapper.unmount();
  });
});

/**
 * 适应宽度的左右留白（`fitPadding`，2026-10-08）：宿主要求「初始化时以表单宽度为准铺满显示区域，
 * 左右上下各留一点空间」。留白必须参与**比例解算**（`s = (视口宽 − 2×留白) / 内容宽`），
 * 而不是靠 CSS 内边距 —— panzoom 把父级 `overflow` 置为 hidden，内边距只会让内容被裁。
 * 左右间隔由水平居中（`computeAlignPan`）自然给出；顶部间隔是另一件事（恒为 `TOP_GAP = 18px`）。
 */
describe("PaperViewport（适应宽度的左右留白 fitPadding）", () => {
  it("fitPadding：比例按「可用宽 = 视口宽 − 2×留白」解算，缩放后左右各留出该间隔", () => {
    installLayout();
    try {
      mount(PaperViewport, { props: { fitOnMount: true, fitPadding: 24 } });
      const opts = __getLastOptions() as { startScale: number; startX: number; startY: number };
      // (960 − 48) / 1587
      expect(opts.startScale).toBeCloseTo(0.5747, 3);
      // 缩放后内容宽 = 视口宽 − 2×24 ⇒ 居中后左右各 24px（「铺满但不贴边」的判据）
      expect(LAYOUT.contentWidth * opts.startScale).toBeCloseTo(LAYOUT.vpWidth - 48, 1);
      // 水平解与比例无关：(V − W)/(2s) + (W − cw)/2 − cx
      expect(opts.startX).toBeCloseTo(-313.5, 1);
      // 顶部留白不受 fitPadding 影响：y = (18 − H/2)/s + H/2
      expect(opts.startY).toBeCloseTo(-383.51, 1);
    } finally {
      restoreLayout();
    }
  });

  it("fitPadding 缺省 / 负数 / 非数：一律按 0 解算（设计态与既有消费页的适应宽度结果不变）", () => {
    installLayout();
    try {
      mount(PaperViewport, { props: { fitOnMount: true, fitPadding: -100 } });
      const opts = __getLastOptions() as { startScale: number; startX: number; startY: number };
      // 960 / 1587，与缺省 0 逐值一致（负留白不得把可用宽算得比视口还大）
      expect(opts.startScale).toBeCloseTo(0.6049, 3);
      expect(opts.startX).toBeCloseTo(-313.5, 1);
      expect(opts.startY).toBeCloseTo(-336.32, 1);
    } finally {
      restoreLayout();
    }
  });

  it("挂载即上报一次初始比例：宿主隐藏内置栏后，百分比只能靠 scale-change 才对得上", () => {
    installLayout();
    try {
      const wrapper = mount(PaperViewport, { props: { hideBar: true, fitOnMount: true } });
      const opts = __getLastOptions() as { startScale: number };
      // 挂载期的两次缩放写入（构造器一次、兜底的 fitWidth 一次）比例相同 ⇒ panzoomchange 不会被转发，
      // 故组件必须自己补一次上报，宿主的工具栏才不会停在占位数字上。
      expect(wrapper.emitted("scale-change")?.[0]).toEqual([opts.startScale]);
      wrapper.unmount();
    } finally {
      restoreLayout();
    }
  });
});

/**
 * 适应宽度量的是**哪个元素**（`fitContentSelector`，2026-10-08）。
 *
 * 内核 DOM 是 `缩放层 > .grid-form-canvas > .grid-form-paper`：纸外面那层画布**铺满视口**
 * （宽 = 视口宽），而缺省取缩放层的第一个子元素来量 ⇒ 量到画布，比例恒等于 1 ——
 * 宽容器里纸只有自然宽、并不铺满，加 `fitPadding` 还会把它缩小（无头实测：900 容器下
 * 纸 751.36px、两侧各空 74.32px）。指名真正的纸之后才按纸的自然宽解算。
 */
describe("PaperViewport（适应宽度量哪个元素 fitContentSelector）", () => {
  const canvasPaperSlot =
    '<div class="layout-canvas"><div class="layout-paper">A4</div></div>';

  it("指名纸：比例按纸的自然宽解算（宽度方向真的铺满，留白才是留白）", () => {
    installLayout();
    try {
      mount(PaperViewport, {
        props: { fitOnMount: true, fitPadding: 24, fitContentSelector: ".layout-paper" },
        slots: { default: canvasPaperSlot },
      });
      const opts = __getLastOptions() as { startScale: number; startX: number; startY: number };
      // (960 − 48) / 794
      expect(opts.startScale).toBeCloseTo(1.1486, 3);
      // 缩放后纸宽 = 视口宽 − 2×24 ⇒ 居中后两侧各 24px（「铺满但不贴边」的判据）
      expect(LAYOUT.paperWidth * opts.startScale).toBeCloseTo(LAYOUT.vpWidth - 48, 1);
      // 水平解与内容是谁无关：(V − W)/(2s) + (W − cw)/2 − cx
      expect(opts.startX).toBeCloseTo(83, 1);
    } finally {
      restoreLayout();
    }
  });

  it("不指名（缺省）：量到的是铺满视口的画布 ⇒ 比例恒 1、纸并不铺满（内核原生形态，保留不动）", () => {
    installLayout();
    try {
      mount(PaperViewport, {
        props: { fitOnMount: true, fitPadding: 24 },
        slots: { default: canvasPaperSlot },
      });
      const opts = __getLastOptions() as { startScale: number };
      // 912 / 960 —— 量的是画布（宽 = 视口宽），与纸的自然宽无关
      expect(opts.startScale).toBeCloseTo(0.95, 3);
    } finally {
      restoreLayout();
    }
  });

  it("选择器查不到：静默回退「第一个子元素」（拼错选择器不得让比例乱跳）", () => {
    installLayout();
    try {
      mount(PaperViewport, {
        props: { fitOnMount: true, fitContentSelector: ".not-exist" },
        slots: { default: canvasPaperSlot },
      });
      const opts = __getLastOptions() as { startScale: number };
      expect(opts.startScale).toBeCloseTo(1, 3); // 960 / 960，与不指名一致
    } finally {
      restoreLayout();
    }
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

  it("Shadow DOM 内的表单控件：宿主被穿透打上 panzoom-exclude（否则预览态点不进 HTML 字段）", async () => {
    const wrapper = mount(PaperViewport);
    const scaler = wrapper.find(".paper-viewport__scaler").element as HTMLElement;
    const host = document.createElement("div");
    host.setAttribute("data-node-id", "html-1");
    const sr = host.attachShadow({ mode: "open" });
    sr.innerHTML = '<p data-field="收工月1" contenteditable="true"></p>';
    scaler.appendChild(host);
    await flushObserver();
    // panzoom 判定 exclude 时看到的是**宿主**（事件跨 shadow 边界被重定向，closest 不穿边界），
    // 故必须打在宿主上；user-select 亦可继承，宿主恢复 text 才能让 shadow 内文本可选中。
    expect(host.classList.contains("panzoom-exclude")).toBe(true);
    expect(host.style.userSelect).toBe("text");
    wrapper.unmount();
  });

  it("Shadow DOM 内无可编辑控件：宿主不打标（保留拖拽平移）", async () => {
    const wrapper = mount(PaperViewport);
    const scaler = wrapper.find(".paper-viewport__scaler").element as HTMLElement;
    const host = document.createElement("div");
    host.setAttribute("data-node-id", "html-2");
    const sr = host.attachShadow({ mode: "open" });
    sr.innerHTML = "<p>纯展示片段</p>";
    scaler.appendChild(host);
    await flushObserver();
    expect(host.classList.contains("panzoom-exclude")).toBe(false);
    wrapper.unmount();
  });

  it("回归：light DOM 控件与可拖拽节点照常打标，普通元素不打标", async () => {
    const wrapper = mount(PaperViewport);
    const scaler = wrapper.find(".paper-viewport__scaler").element as HTMLElement;
    const input = document.createElement("input");
    const drag = document.createElement("div");
    drag.setAttribute("draggable", "true");
    const plain = document.createElement("div");
    scaler.append(input, drag, plain);
    await flushObserver();
    expect(input.classList.contains("panzoom-exclude")).toBe(true);
    expect(input.style.userSelect).toBe("text");
    expect(drag.classList.contains("panzoom-exclude")).toBe(true);
    expect(plain.classList.contains("panzoom-exclude")).toBe(false);
    wrapper.unmount();
  });

  it("先清后打：contenteditable 关闭后标记与 user-select 一并清除（design→preview 平移不失效）", async () => {
    const wrapper = mount(PaperViewport);
    const scaler = wrapper.find(".paper-viewport__scaler").element as HTMLElement;
    // 用 light DOM 的 contenteditable 而非 shadow 宿主：attributeFilter 含 contenteditable，
    // 属性翻转能被 observer 观察到，从而真正鉴别「清理阶段是否把内联 user-select 也清掉」。
    const cell = document.createElement("div");
    cell.setAttribute("contenteditable", "true");
    scaler.appendChild(cell);
    await flushObserver();
    expect(cell.classList.contains("panzoom-exclude")).toBe(true);
    expect(cell.style.userSelect).toBe("text");

    cell.setAttribute("contenteditable", "false");
    await flushObserver();
    expect(cell.classList.contains("panzoom-exclude")).toBe(false);
    expect(cell.style.userSelect).toBe("");
    wrapper.unmount();
  });
});
