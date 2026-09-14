import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { printForm } from "../print-form";

/**
 * 打印触发（2026-09-11 改用 vue-print-next 实现的**局部打印**）。
 *
 * 本文件锁四件事——都是「换库后必须成立」的契约，任一破了就直接打出错票：
 *
 * ① **只把纸张交给打印插件，且不传 `paperSize` / `orientation` / `customSize`**：
 *    那三个参数一旦传了，vue-print-next 会自己再写一条 `@page`，且排在 head 里所有
 *    `<style>` 之后，直接盖掉 `page-size-style.ts` 跟随 `schema.paper` 注入的尺寸
 *    （A3 会被打回 A4）。
 * ② **HTML 模块的 Shadow DOM 内容在送印时被临时提升到 light DOM**：插件取内容走
 *    `cloneNode(true)` + `innerHTML` 序列化，而 `cloneNode` 不克隆 shadow tree。
 * ③ **`input` / `textarea` 的实时值在送印前固化进 attribute**：`cloneNode` 只带 attribute、
 *    不带当前键入值；插件自带的 `formDataHandler` 同步的是克隆副本自身，等于没同步。
 * ④ **打印根缺失 / 根内无纸张时静默返回 `false`**，不抛错、且不误打同页其他实例的纸张。
 *
 * jsdom 没有真实打印栈，故把 `vue-print-next` 整个替身掉：只断言交给它的参数，以及
 * 「送印瞬间」（替身构造函数执行时）主 DOM 的状态——那一刻正是插件做序列化的时刻。
 */
const { ctorSpy } = vi.hoisted(() => ({ ctorSpy: vi.fn() }));

vi.mock("vue-print-next", () => ({
  VuePrintNext: class {
    constructor(options: unknown) {
      ctorSpy(options);
    }
  },
}));

/** 送印瞬间的现场快照（在替身构造函数里采样）。 */
interface Snapshot {
  /** light DOM 里能看到几份 HTML 模块内容（提升成功则为 1）。 */
  lightBlockCount: number;
  /** 送印时 input 的 `value` attribute（已固化则等于实时值）。 */
  inputValueAttr: string | null;
}

let snapshot: Snapshot | null = null;

beforeEach(() => {
  ctorSpy.mockReset();
  snapshot = null;
  // 插件构造函数同步完成 iframe 创建 + document.write（内容此刻已序列化），
  // 所以「构造中」观测到的主 DOM 就是送印现场。
  ctorSpy.mockImplementation(() => {
    const host = document.querySelector<HTMLElement>(".layout-html");
    snapshot = {
      lightBlockCount: host ? host.querySelectorAll(".tbl").length : -1,
      inputValueAttr: host?.querySelector("input")?.getAttribute("value") ?? null,
    };
  });
});

afterEach(() => {
  // 先恢复被 stub 的全局（SSR 用例把 `document` 替成了 undefined），再清 DOM。
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** 造一份最小现场：画布 > 纸张 > HTML 模块（内容在 Shadow DOM 里，含一个已键入的 input）。 */
function buildDom(): {
  scope: HTMLElement;
  paper: HTMLElement;
  host: HTMLElement;
  shadow: ShadowRoot;
} {
  const scope = document.createElement("div");
  scope.className = "grid-form-canvas";
  const paper = document.createElement("main");
  paper.className = "grid-form-paper";
  const host = document.createElement("div");
  host.className = "layout-html";
  const shadow = host.attachShadow({ mode: "open" });

  const userStyle = document.createElement("style");
  userStyle.textContent = ".tbl { width: 100%; }";
  const block = document.createElement("div");
  block.className = "tbl";
  const input = document.createElement("input");
  input.setAttribute("data-bind", "单位");
  input.value = "运输队"; // property，不是 attribute —— cloneNode 带不走
  block.appendChild(input);
  shadow.append(userStyle, block);

  paper.appendChild(host);
  scope.appendChild(paper);
  document.body.appendChild(scope);
  return { scope, paper, host, shadow };
}

function lastOptions(): Record<string, unknown> {
  const call = ctorSpy.mock.calls.at(-1);
  return (call?.[0] ?? {}) as Record<string, unknown>;
}

describe("printForm（vue-print-next 局部打印）", () => {
  it("把本次纸张圈定在实例作用域内交给插件，且不传纸张尺寸参数", () => {
    const { scope, paper } = buildDom();

    expect(printForm({ root: scope })).toBe(true);
    expect(ctorSpy).toHaveBeenCalledTimes(1);

    // 必须用选择器（插件不接受元素数组），且不能是裸 `.grid-form-paper`（会串同页其他实例）。
    expect(lastOptions().el).toMatch(/^\[data-v2-print-scope="\d+"\]$/);
    // 契约①：纸张尺寸的唯一真源是 page-size-style.ts，传这三个参数会把 @page 盖掉。
    expect(lastOptions().paperSize).toBeUndefined();
    expect(lastOptions().orientation).toBeUndefined();
    expect(lastOptions().customSize).toBeUndefined();
    // 打完清掉临时作用域属性，不留痕。
    expect(paper.hasAttribute("data-v2-print-scope")).toBe(false);
  });

  it("送印时把 HTML 模块的 shadow 内容提升到 light DOM，打印后移回 shadow", () => {
    const { scope, host, shadow } = buildDom();

    printForm({ root: scope });

    expect(snapshot?.lightBlockCount).toBe(1); // 送印瞬间：序列化拿得到
    expect(host.querySelectorAll(".tbl").length).toBe(0); // 打完：light DOM 已清空
    expect(shadow.querySelector(".tbl")).not.toBeNull(); // 回到 shadow 里
  });

  it("送印时把 input 的实时值固化进 value attribute，打印后还原（原本无该属性）", () => {
    const { scope, host, shadow } = buildDom();

    printForm({ root: scope });

    expect(snapshot?.inputValueAttr).toBe("运输队"); // 送印瞬间已固化
    // 打完还原：input 已移回 shadow，且 `value` attribute 被摘掉（它原本就没有）。
    expect(host.querySelector("input")).toBeNull();
    expect(shadow.querySelector("input")?.getAttribute("value")).toBeNull();
  });

  it("HTML 模块的用户 CSS 留在 shadow 里，另经 extraHead 注入打印文档", () => {
    const { scope, shadow } = buildDom();

    printForm({ root: scope });

    expect(String(lastOptions().extraHead)).toContain(".tbl { width: 100%; }");
    // 用户 CSS 不跟着搬进 light DOM（否则会在主文档全局生效）。
    expect(shadow.querySelector("style")).not.toBeNull();
  });

  it("连续两次打印都能正常提升与还原（还原幂等、不残留）", () => {
    const { scope, host, shadow } = buildDom();

    printForm({ root: scope });
    const first = snapshot?.lightBlockCount;
    printForm({ root: scope });

    expect(first).toBe(1);
    expect(snapshot?.lightBlockCount).toBe(1);
    expect(ctorSpy).toHaveBeenCalledTimes(2);
    expect(host.querySelectorAll(".tbl").length).toBe(0);
    expect(shadow.querySelector(".tbl")).not.toBeNull();
  });

  it("显式传 null 视为「无根」：返回 false、不回退全局兜底、不触发打印", () => {
    buildDom();

    expect(printForm({ root: null })).toBe(false);
    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it("根内没有纸张时返回 false 且不触发打印", () => {
    const empty = document.createElement("div");
    document.body.appendChild(empty);

    expect(printForm({ root: empty })).toBe(false);
    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it("无参调用时用全局兜底选择器找画布", () => {
    buildDom();

    expect(printForm()).toBe(true);
    expect(ctorSpy).toHaveBeenCalledTimes(1);
  });

  it("插件构造抛错时静默返回 false（不把异常抛给宿主），且现场已还原", () => {
    const { scope, paper, host, shadow } = buildDom();
    ctorSpy.mockImplementation(() => {
      throw new Error("iframe unavailable");
    });

    expect(() => printForm({ root: scope })).not.toThrow();
    expect(printForm({ root: scope })).toBe(false);
    // 异常路径也必须还原现场：临时作用域属性与提升出去的节点都不能残留。
    expect(paper.hasAttribute("data-v2-print-scope")).toBe(false);
    expect(host.querySelectorAll(".tbl").length).toBe(0);
    expect(shadow.querySelector(".tbl")).not.toBeNull();
  });

  it("SSR（无 document）时安全 no-op 并返回 false", () => {
    vi.stubGlobal("document", undefined);
    expect(() => printForm()).not.toThrow();
    expect(printForm()).toBe(false);
  });
});
