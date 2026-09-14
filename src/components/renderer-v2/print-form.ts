/**
 * 打印触发（2026-09-11 改用 vue-print-next 实现：局部打印）。
 *
 * 背景：`@page` 纸张注入（`page-size-style.ts`）与 `@media print` 呈现样式都在渲染内核，
 * 但「触发打印」此前只有设计器工具栏裸调 `window.print()`——消费页（`<FormRenderer>`）
 * 想打印必须自己再写一遍，于是**触发与呈现分处两层**，宿主各自重复实现（D2）。
 *
 * 更根本的问题是：`window.print()` 只能打印**整个宿主页面**，靠 `@media print` 把设计器
 * 之外的菜单 / 头部 / 其他业务区域逐条隐藏——宿主页面结构一变就漏，长期打不干净。
 *
 * 现方案 = **局部打印**：只把纸张元素（`.grid-form-paper`）序列化进一个同源 iframe 再打印，
 * 宿主页面其余部分天然不进打印流，不再依赖任何全局隐藏规则。
 *
 * 契约（实现依据，改动前务必读完；三项都是 vue-print-next 的内部行为倒逼，不是风格选择）：
 *
 * 1. **打印根** —— `PrintFormOptions.root`，缺省取全局第一个 `.grid-form-canvas`。
 *    真正送印的是其中的每张 `.grid-form-paper`（物理页）。纸张上的 `width/height: Nmm`
 *    是内联样式（随序列化保留），配合内核 `@media print` 的 `break-after: page` 决定出纸分页。
 *
 * 2. **`@page` 唯一真源仍是 `page-size-style.ts`** —— **不要**给 vue-print-next 传
 *    `paperSize` / `orientation` / `customSize`。它一旦拿到这三个参数里的任意一个，就会
 *    自己再写一条 `@page`，且排在 head 里所有 `<style>` 之后（后写胜出），直接盖掉跟随
 *    `schema.paper` 的尺寸注入（A3 横向会被打回 A4）。尺寸只走 `page-size-style.ts` 一处。
 *
 * 3. **Shadow DOM 必须临时提升** —— vue-print-next 取内容走 `el.cloneNode(true)` +
 *    `innerHTML` 序列化，而 `cloneNode` **不克隆 shadow tree**（DOM 规范行为，不是它的 bug）。
 *    HTML 模块（`HtmlBlock.vue`）正是 Shadow DOM 隔离的，不处理就打印出一块空白。
 *    故打印前把各 `.layout-html` 的 shadow 子节点**临时移到 host 上**（真移动，不是克隆，
 *    屏幕上始终只有一份）、打完移回；模块的用户 CSS 留在 shadow 里，改经 `extraHead`
 *    注入打印文档（搬进 light DOM 会让它在主文档全局生效，比注入打印文档更脏）。
 *
 * 4. **表单控件实时值要自己固化** —— `cloneNode` 只带走 `value` attribute，不带走当前键入值；
 *    而 vue-print-next 自带的 `formDataHandler` 遍历的是**克隆副本自身**（取值再写回自己），
 *    等于没同步。故提升时把 `input` / `textarea` 的实时值写进 attribute，打完还原。
 *    内核 P 字段不受影响——它是 contenteditable，值本来就在文本节点里。
 *
 * 5. **宿主 DOM 必须能承受一次 HTML 往返** —— 插件取内容走 `outerHTML`，再 `document.write`
 *    进 iframe，浏览器会**重新解析**这段 HTML。任何「只有靠 DOM API 才成立」的结构都会在这里变形。
 *    2026-09-11 的实际故障：字段容器用了 `<p>`，而 `innerBorder` 的逐行渲染在其内部插入
 *    `<div class="layout-p__line">` —— `<p>` 的内容模型只允许 phrasing content，解析器遇 `<div>`
 *    会强制闭合 `<p>`，把逐行 div 与后标签推出容器，表现即「屏幕一行、打印时前后标签各占一行」。
 *    已把字段容器改为 `<div>`，并由 `FieldContainerHtmlRoundTrip.test.ts` 守卫。
 *    新增节点类型时先自问：它的 DOM 序列化成字符串、再解析回来，还长一样吗？
 *
 * 同步性：vue-print-next 的构造函数**同步**完成 iframe 创建 + `document.write`（内容此刻已
 * 序列化完毕），真正的 `print()` 在 iframe load 之后异步触发、与主 DOM 无关 ⇒ 本函数可以在
 * `finally` 里立即还原，宿主看不到中间态。`closeCallback` 处再兜一次（`restore` 幂等）。
 *
 * 安全：非浏览器环境（SSR / jsdom 缺 `iframe.contentDocument`）静默返回 `false`，不抛错。
 */
import { VuePrintNext } from "vue-print-next";

/** 物理页元素选择器（内核 `GridFormRenderer` 渲染产物，每张纸一个）。 */
export const PRINT_PAPER_SELECTOR = ".grid-form-paper";

/** 打印根兜底选择器（`options.root` 未传时用）。 */
export const PRINT_ROOT_SELECTOR = ".grid-form-canvas";

/** HTML 模块宿主元素选择器（`HtmlBlock.vue` 的根，内容在 Shadow DOM 里）。 */
export const HTML_BLOCK_SELECTOR = ".layout-html";

/**
 * 实例作用域属性：vue-print-next 的 `el` 只接受「字符串选择器」或「单个元素」，
 * 多张纸必须用选择器，但裸 `.grid-form-paper` 会把同页多个渲染实例（设计器 + 各消费页）
 * 一起选中。故给本次要打印的纸张打上实例级 token，用属性选择器精确圈定。
 */
const SCOPE_ATTR = "data-v2-print-scope";

/** token 自增序号：同页多实例并存时不重复。 */
let scopeSeq = 0;

export interface PrintFormOptions {
  /** 打印根（含 `.grid-form-paper` 的容器，通常即内核画布）。缺省取全局第一个画布。 */
  root?: HTMLElement | null;
  /** 打印文档标题（浏览器打印框里显示的文档名）。缺省沿用 `document.title`。 */
  title?: string;
}

/** 一次「提升」的现场记录，供还原。 */
interface LiftRecord {
  host: HTMLElement;
  /** 从 shadow 移到 host 的节点（按原顺序保存）。 */
  nodes: Node[];
  /** 被固化过 attribute 的控件与原值（`null` = 原本没有该属性）。 */
  controls: Array<{
    el: HTMLInputElement | HTMLTextAreaElement;
    attr: string;
    prev: string | null;
  }>;
}

/**
 * 把 `scope` 内各 HTML 模块的 shadow 内容临时提升到 light DOM，返回**幂等**的还原函数。
 *
 * 只移「非 `<style>`」子节点：用户 CSS 留在 shadow 里（屏幕渲染不受影响），打印文档另经
 * `extraHead` 注入同一份 CSS。移节点用真移动而非克隆，避免屏幕上同时出现两份内容。
 */
function liftForPrint(scope: HTMLElement): () => void {
  const records: LiftRecord[] = [];

  scope.querySelectorAll<HTMLElement>(HTML_BLOCK_SELECTOR).forEach((host) => {
    const shadow = host.shadowRoot;
    if (!shadow) return;

    const nodes: Node[] = [];
    Array.from(shadow.childNodes).forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === "STYLE") return;
      nodes.push(node);
    });
    if (!nodes.length) return;
    nodes.forEach((node) => host.appendChild(node));

    // 固化实时值：cloneNode 只带 attribute，不带 property。
    const controls: LiftRecord["controls"] = [];
    host
      .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")
      .forEach((el) => {
        const isToggle =
          el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio");
        const attr = isToggle ? "checked" : "value";
        controls.push({ el, attr, prev: el.getAttribute(attr) });
        if (isToggle) {
          if ((el as HTMLInputElement).checked) el.setAttribute("checked", "");
          else el.removeAttribute("checked");
        } else {
          el.setAttribute("value", el.value);
        }
      });

    records.push({ host, nodes, controls });
  });

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    records.forEach(({ host, nodes, controls }) => {
      controls.forEach(({ el, attr, prev }) => {
        if (prev === null) el.removeAttribute(attr);
        else el.setAttribute(attr, prev);
      });
      const shadow = host.shadowRoot;
      if (!shadow) return;
      // 按原顺序 append，顺序即还原（appendChild 会从当前位置摘走并放到末尾）。
      nodes.forEach((node) => shadow.appendChild(node));
    });
  };
}

/**
 * 收集各 HTML 模块 shadow 里的用户 CSS，供打印文档 `extraHead` 注入。
 *
 * 这些规则在 shadow 内是天然隔离的，注入打印文档后变为全局——可接受，因为打印文档里
 * 只有本表单；若命中冲突，后续可在注入前做前缀化（当前不做，避免过度设计）。
 */
function collectHtmlBlockCss(scope: HTMLElement): string {
  const parts: string[] = [];
  scope.querySelectorAll<HTMLElement>(HTML_BLOCK_SELECTOR).forEach((host) => {
    host.shadowRoot?.querySelectorAll("style").forEach((styleEl) => {
      const css = styleEl.textContent ?? "";
      if (css.trim()) parts.push(css);
    });
  });
  return parts.length ? `<style>${parts.join("\n")}</style>` : "";
}

/**
 * 触发打印当前渲染结果。
 *
 * @param options 见 {@link PrintFormOptions}。无参调用时自动找全局第一个内核画布。
 * @returns 是否真的触发了打印。找不到打印根 / 没有纸张 / 宿主不支持时返回 `false`（不抛错）。
 */
export function printForm(options: PrintFormOptions = {}): boolean {
  if (typeof document === "undefined") return false;

  // 显式传 `null`（如消费页拿不到自身 `$el`）视为「无根」，**不回退**全局兜底 —— 宁可
  // 不打印，也不要误打同页另一个实例的纸张。只有完全不传 `root` 时才走兜底选择器。
  const scope =
    options.root !== undefined
      ? options.root
      : document.querySelector<HTMLElement>(PRINT_ROOT_SELECTOR);
  if (!scope) return false;

  const papers = Array.from(scope.querySelectorAll<HTMLElement>(PRINT_PAPER_SELECTOR));
  if (!papers.length) return false;

  // 实例级圈定（选择器不能用元素数组，`el` 传数组会被当成无效类型）。
  const token = String(scopeSeq++);
  papers.forEach((paper) => paper.setAttribute(SCOPE_ATTR, token));

  const extraHead = collectHtmlBlockCss(scope);
  const restore = liftForPrint(scope);

  try {
    new VuePrintNext({
      el: `[${SCOPE_ATTR}="${token}"]`,
      popTitle: options.title ?? document.title,
      extraHead,
      // 刻意不传 paperSize / orientation / customSize —— 契约 2。
      closeCallback: restore,
    });
  } catch {
    return false;
  } finally {
    // 构造函数同步完成内容序列化，此处还原是安全的（见文件头「同步性」）。
    restore();
    papers.forEach((paper) => paper.removeAttribute(SCOPE_ATTR));
  }
  return true;
}
