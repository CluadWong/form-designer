/**
 * 设计器对外交付 API：把「当前表单」转成宿主可直接消费的 JSON 契约。
 *
 * 两个取值入口（宿主经 `FormDesigner` 的 ref 调用，或用同名纯函数）：
 * 1. **schema 配置** —— 整份 `FormSchemaV2`（版式描述），与工具栏「导出文件」同口径；
 * 2. **表单数据** —— `{ 字段名: 值 }`（如 `{"单位":"运输队"}`）。取值口径与渲染期
 *    **完全同源**：直接复用 `collectFieldValues`（遍历渲染 DOM 的 `[data-field]`），
 *    不另写一套 schema 遍历。表单没有任何字段时结果就是 `{}`。
 *
 * 工具栏「导出文件」/「导出数据」两个动作也调用同一组 API（见 `useSchemaDocument` /
 * `useFillData`），并在控制台打印对应 JSON，便于联调时直接抄走数据。
 *
 * 除 `collectFormData` / `downloadJsonFile` 外均为纯函数，可脱离组件单测。
 */
import { collectFieldValues, type CollectFieldValuesOptions } from "@/components/renderer-v2";
import type { FormDataV2, FormSchemaV2 } from "@/types";
import { parseFormSchemaV2, serializeFormSchemaV2 } from "@/types";

/** 默认 JSON 缩进空格数（导出物是给人看 / 进版本库的，默认美化）。 */
export const JSON_INDENT = 2;

/** 导出文件名前缀（沿用 `ticket-designer-*` 命名惯例，与 `useSchemaDocument` / `useFillData` 一致）。 */
export const SCHEMA_EXPORT_PREFIX = "ticket-schema-v2";
export const FILL_DATA_EXPORT_PREFIX = "ticket-fill-data";

/**
 * 采集渲染根容器内的**字段与值**，构成 `{ 字段名: 值 }`。
 *
 * 薄转发 `collectFieldValues`（渲染内核的 DOM 遍历采集器）：两者是同一个实现，
 * 保证「设计器导出的数据」与「消费页采集的数据」口径不会漂移。
 *
 * @param root 渲染根容器（设计器的 `.v2-canvas`），为 `null` 时返回 `{}`。
 * @param options 脱敏口径等透传给 `collectFieldValues`。
 */
export function collectFormData(
  root: ParentNode | null | undefined,
  options: CollectFieldValuesOptions = {},
): FormDataV2 {
  if (!root) return {};
  return collectFieldValues(root, options);
}

/** 序列化整份 schema（`pretty` 控制缩进，默认缩进）。 */
export function serializeSchemaJson(schema: FormSchemaV2, pretty = true): string {
  return serializeFormSchemaV2(schema, pretty);
}

/** 序列化表单数据 JSON（`pretty` 控制缩进，默认缩进）。 */
export function serializeFormDataJson(data: FormDataV2, pretty = true): string {
  return pretty ? JSON.stringify(data, null, JSON_INDENT) : JSON.stringify(data);
}

/** 生成带时间戳的导出文件名，避免连续导出互相覆盖。 */
export function exportFileName(prefix: string, stamp: number = Date.now()): string {
  return `${prefix}-${stamp}.json`;
}

/**
 * 触发浏览器下载一个 JSON 文件（唯一的副作用点）。
 * 非浏览器环境（Node / SSR）静默返回，调用方不必自己判断 `document`。
 */
export function downloadJsonFile(fileName: string, jsonText: string): void {
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return;
  }
  const blob = new Blob([jsonText], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * `FormDesigner` 经 `defineExpose` 对宿主开放的程序化 API。
 *
 * 宿主典型用法（**宿主侧代码**，本仓库不改宿主）：
 * ```ts
 * const designerRef = ref<InstanceType<typeof FormDesigner> | null>(null);
 * // 保存：schema 配置 + 表单数据一起拿走
 * const schema = designerRef.value!.getSchema();        // FormSchemaV2
 * const data = designerRef.value!.getFormData();        // { 单位: "", 编号: "", ... }
 * // 回填：
 * designerRef.value!.setSchema(version.schema);
 * ```
 */
export interface FormDesignerExposed {
  /** 当前 schema 的深拷贝（改它不会污染设计器内部状态）。需要 JSON 文本时宿主自行 `JSON.stringify`。 */
  getSchema: () => FormSchemaV2;
  /**
   * 当前表单的**字段与值**（`{ 字段名: 值 }`）。值来自渲染 DOM 遍历（`collectFieldValues`），
   * 因此含用户在设计态 / 预览态就地输入的内容；表单没有配置字段时返回 `{}`。
   * 需要 JSON 文本时宿主自行 `JSON.stringify`。
   */
  getFormData: (options?: CollectFieldValuesOptions) => FormDataV2;
  /** 载入一份 schema（对象或 JSON 文本），并清空历史与选中。 */
  setSchema: (next: FormSchemaV2 | string) => void;
  /** 下载 schema JSON 文件（与工具栏「导出文件」同一实现）。 */
  exportSchemaFile: () => void;
  /** 下载表单数据 JSON 文件（与工具栏「导出数据」同一实现）。 */
  exportFillDataFile: () => void;
  /** 触发打印（与工具栏「打印」同一实现）。 */
  print: () => void;
  /** 重置为空白模板（一个空 page + 一个根 Grid）。 */
  resetBlank: () => void;
}

/**
 * `setSchema` 的入参归一化：字符串按严格解析（`parseFormSchemaV2`，非法直接抛错），
 * 对象走一次深拷贝——宿主传入的引用后续被它自己改，也不该影响设计器。
 */
export function normalizeIncomingSchema(next: FormSchemaV2 | string): FormSchemaV2 {
  if (typeof next === "string") return parseFormSchemaV2(next);
  return JSON.parse(JSON.stringify(next)) as FormSchemaV2;
}
