export { default as GridFormRenderer } from "./GridFormRenderer.vue";
export { default as GridSchemaNode } from "./GridSchemaNode.vue";
export { collectFieldValues } from "./collectFieldValues";
export type { CollectFieldValuesOptions } from "./collectFieldValues";
export {
  setPageSizeStyle,
  registerPageSizeStyle,
  currentPageSizeStyle,
} from "./page-size-style";
/**
 * D2：打印触发入口（呈现 + 触发同归渲染内核，宿主不再各自 `window.print()`）。
 * 实现 = vue-print-next 局部打印：只把纸张序列化进同源 iframe，宿主页面其余部分不进打印流。
 * `printForm()` 无参调用会自动找全局第一个内核画布；多实例场景请显式传 `{ root }`。
 */
export { printForm, PRINT_PAPER_SELECTOR, PRINT_ROOT_SELECTOR } from "./print-form";
export type { PrintFormOptions } from "./print-form";
