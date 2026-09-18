import { vi } from "vitest";

/**
 * jsdom 测试环境用的 @panzoom/panzoom 替身（仅 Vitest 经 resolve.alias 注入，生产构建不受影响）。
 *
 * 真实包 `main` 指向 UMD `dist/panzoom.js`，其 `module.exports = { default: fn, defaultOptions }` 且无 `__esModule`，
 * 在 Vitest SSR/CJS 互操作下 `import Panzoom from "@panzoom/panzoom"` 会得到「命名空间对象」而非可调用函数
 * （运行期报错 `default is not a function`）。浏览器走 `module` 字段的 ESM 构建不受影响。
 *
 * 这里只实现 PaperViewport 实际调用的方法（getScale / zoom / pan / reset / zoomWithWheel / resetStyle / destroy），
 * 并用注册表暴露最近创建的实例与入参，供组件测试断言；方法用 vi.fn 保证可 spy。
 */
export interface PzStub {
  getScale: () => number;
  zoom: (scale: number, opts?: unknown) => void;
  pan: (x: number, y: number, opts?: unknown) => void;
  reset: (opts?: unknown) => void;
  zoomWithWheel: (event: unknown, opts?: unknown) => void;
  resetStyle: () => void;
  destroy: () => void;
}

const registry: PzStub[] = [];
const lastCalls: Array<{ el: unknown; opts: unknown }> = [];
const panCalls: Array<[number, number]> = [];

function createPz(el: unknown): PzStub {
  let scale = 1;
  let px = 0;
  let py = 0;
  /**
   * 派发与真实库同名的事件。**必须派发**，否则 PaperViewport 的「程序化写入 vs 用户干预」
   * 判定（`asProgrammatic` + `onPanEvent` / `onPanChange`）在单测里永远走不到，
   * 「构造器延后的 pan 把 userAdjusted 误置」这类回归就没有守卫。
   */
  const dispatch = (name: string): void => {
    const target = el as Element | null;
    if (target && typeof target.dispatchEvent === "function") {
      target.dispatchEvent(new CustomEvent(name, { detail: { x: px, y: py, scale, isSVG: false } }));
    }
  };
  const inst: PzStub = {
    getScale: vi.fn(() => scale),
    zoom: vi.fn((s: number) => {
      scale = s;
      dispatch("panzoomzoom");
      dispatch("panzoomchange");
    }),
    pan: vi.fn((x: number, y: number) => {
      px = x;
      py = y;
      panCalls.push([x, y]);
      dispatch("panzoompan");
      dispatch("panzoomchange");
    }),
    reset: vi.fn(() => {
      scale = 1;
      px = 0;
      py = 0;
      dispatch("panzoomreset");
      dispatch("panzoomchange");
    }),
    zoomWithWheel: vi.fn(),
    resetStyle: vi.fn(),
    destroy: vi.fn(),
  };
  registry.push(inst);
  return inst;
}

// 默认导出：与真实 @panzoom/panzoom 同形（Panzoom(elem, options) => PanzoomObject）。
export default function Panzoom(el: unknown, opts: unknown): PzStub {
  lastCalls.push({ el, opts });
  const inst = createPz(el);
  // **复刻真实库（4.6.2）的构造语义**——替身若在这里走样，相关回归就永远测不出来：
  //   function Panzoom(elem, options) {
  //     ...
  //     zoom(options.startScale, { animate: false, force: true });
  //     setTimeout(() => { pan(options.startX, options.startY, { animate: false, force: true }); });
  //   }
  // 即：起始缩放立即生效，而起始平移**被延后到一个 setTimeout**（默认 startX/startY = 0）。
  // 后果：调用方在 onMounted 里同步写好的平移量，会被这次延后写入覆盖（scale 保留、translate 归零），
  // 且该次写入发生在调用方的「程序化写入」标志窗口之外——首次进入 A3 横向时纸张整体偏移即源于此。
  // 故替身必须照做，否则 PaperViewport 的挂载对齐无单测可守。
  const options = (opts ?? {}) as { startScale?: number; startX?: number; startY?: number };
  inst.zoom(typeof options.startScale === "number" ? options.startScale : 1);
  const startX = typeof options.startX === "number" ? options.startX : 0;
  const startY = typeof options.startY === "number" ? options.startY : 0;
  setTimeout(() => {
    inst.pan(startX, startY, { animate: false, force: true });
  }, 0);
  return inst;
}

export function __getPz(): PzStub {
  return registry[registry.length - 1];
}

export function __getLastOptions(): unknown {
  return lastCalls[lastCalls.length - 1]?.opts;
}

/** 最近一次 `pan(x, y)` 的入参（用于断言对齐解算的落点）。 */
export function __getLastPan(): [number, number] | undefined {
  return panCalls[panCalls.length - 1];
}

export function __resetPzRegistry(): void {
  registry.length = 0;
  lastCalls.length = 0;
  panCalls.length = 0;
}
