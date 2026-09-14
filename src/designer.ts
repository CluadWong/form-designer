/**
 * 设计器入口（模板编排端入口）
 *
 * 需要让用户在宿主系统内编排模板时才引用：`import { FormDesigner } from "@cluadwong/form-designer/designer"`。
 * 会带上设计器全部 UI 与非 scoped 全局样式（styles/designer-ui.css），消费端不要引。
 *
 * 注意：入口文件一律用相对路径 import，理由见 renderer.ts 顶部注释。
 */

export { default as FormDesigner } from "./components/designer/FormDesigner.vue";

// 设计器 UI 配置：宿主按需显隐模块组 / 切换语言
export {
  defaultDesignerUIConfig,
  resolveDesignerUIConfig,
} from "./components/designer/config";
export type { DesignerUIConfig } from "./components/designer/config";

// 空白模板构造（宿主「新建模板」时可复用）
export { buildBlankSchema } from "./components/designer/composables/useSchemaDocument";

// 交付 API：取 Schema 配置 JSON / 表单字段与值 JSON
// （也可经 FormDesigner 实例的 ref 调用，见 FormDesignerExposed / README「宿主集成」）
export {
  collectFormData,
  downloadJsonFile,
  exportFileName,
  FILL_DATA_EXPORT_PREFIX,
  JSON_INDENT,
  normalizeIncomingSchema,
  SCHEMA_EXPORT_PREFIX,
  serializeFormDataJson,
  serializeSchemaJson,
} from "./components/designer/export-api";
export type { FormDesignerExposed } from "./components/designer/export-api";

// 样例条目类型（宿主注入 samples 时用）
export type { SampleEntry } from "./samples/types";
