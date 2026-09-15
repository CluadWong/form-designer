/**
 * 节点「额外属性」（`SchemaNodeBaseV2.params`）→ 可安全渲染的 HTML 属性表。
 *
 * 设计口径（2026-09-15 用户拍板）：
 * - 内核只把 `params` 的键值**原样透传**成节点根标签的 HTML 属性，**不解释任何键**；
 *   属性的语义（弹什么控件、怎么校验）全部归宿主。
 * - 但「原样透传」不等于「无脑 `v-bind`」：Vue 会把对象里 `on*` 形式的键**绑定成事件监听器**，
 *   任意键还可能覆盖内核自身写入的属性（`data-node-id` / `class` / `style` …），
 *   故**必须**先过本文件的黑名单过滤，否则是一条脚本注入通道。
 *
 * 过滤规则（命中即丢弃该键，静默忽略、不抛错）：
 * 1. 属性名须匹配 `/^[a-z][a-z0-9_-]*$/`——小写字母开头，仅小写字母 / 数字 / `-` / `_`。
 *    该规则天然挡掉 `innerHTML` / `textContent` / `objectFit` 等**大写驼峰**的名字
 *    （它们在 Vue 里会被当作 DOM property 设置而非属性）。
 * 2. 不得以 `on` 开头（事件绑定通道）。
 * 3. 不得以 `data-` 开头（内核节点寻址命名空间：`data-node-id` / `data-layout-id` / `data-field`）。
 * 4. 不得命中 `RESERVED_ATTRS`（内核自身写入的属性）。
 * 5. 值必须是非空字符串：`undefined` / 非字符串 / 空串一律不写属性。
 *
 * 注意本模块**只做过滤**，不做业务校验——宿主要写什么键、什么值，内核不管。
 */
import type { NodeParamsV2 } from "@/types";

/**
 * 内核保留属性名：由渲染内核自身写入节点根元素，`params` 一律不得覆盖——
 * 覆盖会破坏节点寻址（选中 / 拖拽）、字段采集或内联版式。
 */
const RESERVED_ATTRS: ReadonlySet<string> = new Set([
  "id",
  "class",
  "style",
  "slot",
  "key",
  "ref",
  "is",
  // 字段寻址与字段采集
  "field",
  // image 标签自带属性
  "src",
  "alt",
  "width",
  "height",
  // 可编辑性 / 拖拽 / 可见性均由内核闸门控制
  "contenteditable",
  "draggable",
  "hidden",
]);

/** 合法的额外属性名（小写、可含 `-` / `_`、不以数字开头）。 */
const PARAM_NAME_RE = /^[a-z][a-z0-9_-]*$/;

/**
 * 该键是否会作为 HTML 属性落到节点根标签上。
 * 设计器用它给出即时反馈（非法键在面板里标红并提示），渲染内核用它过滤。
 */
export function isParamNameAllowed(name: string): boolean {
  if (typeof name !== "string" || !PARAM_NAME_RE.test(name)) return false;
  if (name.startsWith("on")) return false;
  if (name.startsWith("data-")) return false;
  return !RESERVED_ATTRS.has(name);
}

/**
 * `params` → 可安全 `v-bind` 的属性表。每次调用返回**新对象**（可直接用于模板），
 * 过滤后的空对象等价于「不写任何属性」。
 *
 * 顺序保持 `params` 的插入顺序（`Object.entries` 语义），便于快照/测试稳定断言。
 */
export function resolveNodeParamAttrs(
  params?: NodeParamsV2 | null,
): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (!params) return attrs;
  for (const [name, value] of Object.entries(params)) {
    if (typeof value !== "string" || value === "") continue;
    if (!isParamNameAllowed(name)) continue;
    attrs[name] = value;
  }
  return attrs;
}
