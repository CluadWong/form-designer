/**
 * 渲染 / 填写 / 打印入口（消费端入口）
 *
 * ERP 等宿主系统只需引用这个入口：`import { FormRenderer } from "ticket-designer/renderer"`。
 * 设计器（FormDesigner）及其 UI 资源不在本入口内，不会被打进消费端产物。
 *
 * 典型用法：设计器导出 Schema JSON → 服务端存储 → 宿主用 FormRenderer 加载 schema + data 渲染 / 填写 / 打印。
 *
 * 注意：入口文件一律用相对路径 import，不用 `@/` 别名 —— 生成的 .d.ts 会保留别名，
 * 消费方 TS 无法解析。
 */

// ---- 渲染组件 ----
export { default as FormRenderer } from "./components/renderer-v2/FormRenderer.vue";
export { default as GridFormRenderer } from "./components/renderer-v2/GridFormRenderer.vue";
export { default as GridSchemaNode } from "./components/renderer-v2/GridSchemaNode.vue";
export type { FormRendererOptions } from "./components/renderer-v2/FormRenderer.vue";

// ---- 数据回写：DOM 遍历采集字段值 ----
export { collectFieldValues } from "./components/renderer-v2/collectFieldValues";

// ---- 打印：@page 注入 + 触发（D2：呈现与触发同归渲染内核）----
// 触发实现 = vue-print-next 局部打印（只打纸张，宿主页面其余部分不进打印流）。
export { printForm, PRINT_PAPER_SELECTOR, PRINT_ROOT_SELECTOR } from "./components/renderer-v2/print-form";
export type { PrintFormOptions } from "./components/renderer-v2/print-form";

// ---- 纸张尺寸样式：@page 由 schema.paper 运行时注入 ----
export {
  setPageSizeStyle,
  registerPageSizeStyle,
  currentPageSizeStyle,
} from "./components/renderer-v2/page-size-style";

// ---- Schema 类型与结构操作（宿主存储 / 校验 / 构造 schema 时需要）----
export * from "./types";

// ---- 渲染期领域逻辑（分页 / 派生，宿主做高度预估或服务端分页时可复用）----
export * from "./engine-v2";
