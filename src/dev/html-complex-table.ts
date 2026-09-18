/**
 * P9.2d HTML 模块权限边界 —— 复杂签名时间表演示片段。
 *
 * 还原用户截图里的「工作票收工/开工签名时间表」：双层 colspan 表头
 * （收工时间 / 开工时间 各跨 4 列：月·日·时·分，中间夹工作负责人·工作许可人），
 * 多行数据区。这种结构用 Grid/Table 节点极难表达（colspan/rowspan 双层表头 +
 * 混合时间/文本字段），用 HTML 模块最自然。
 *
 * 支持两种绑定约定（同一 HtmlBlock 统一处理）：
 *  - 方案 A-1 `{{字段名}}` 占位：引擎生成 `<input data-bind>`，字段名由引擎托管；
 *  - 方案 A-2 原生 `<p contenteditable data-field="字段名">`：作者直接控 markup，
 *    引擎仅按权限设可编辑性/脱敏、按 data 回填，[data-field] 即通用采集钩子。
 *
 * 本文件是演示夹具（非交付样例），供 preview 页与测试复用。
 */
import type {
  FieldPermissionV2,
  FormDataV2,
  FormSchemaV2,
  GridNodeV2,
  HtmlNodeV2,
} from "@/types";

const SIGN_TABLE_CSS = `
.sign-table { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; }
.sign-table th, .sign-table td { border: 1px solid #333; text-align: center; padding: 2px 4px; }
.sign-table td { height: 22px; }
.sign-table input { width: 100%; height: 100%; border: none; text-align: center; font: inherit;
  background: transparent; outline: none; box-sizing: border-box; }
.sign-table input[readonly] { color: #475569; }
`;

/** 原生 [data-field] 变体专用 CSS：让 `<td>` 内的 `<p contenteditable data-field>` 视觉上等同 input。 */
const SIGN_TABLE_NATIVE_CSS = `
.sign-table-natural { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; }
.sign-table-natural th, .sign-table-natural td { border: 1px solid #333; text-align: center; padding: 2px 4px; }
.sign-table-natural th:first-child, .sign-table-natural td:first-child { border-left: none; }
.sign-table-natural th:last-child, .sign-table-natural td:last-child { border-right: none; }
.sign-table-natural tr:first-child th, .sign-table-natural tr:first-child td { border-top: none; }
.sign-table-natural tr:last-child th, .sign-table-natural tr:last-child td { border-bottom: none; }
.sign-table-natural thead tr:nth-child(2) th { border-bottom: 1px solid #333; }
.sign-table-natural td { height: 22px; vertical-align: middle; }
.sign-table-natural td > p[data-field] { width: 100%; height: 100%; margin: 0; border: none;
  text-align: center; font: inherit; outline: none; box-sizing: border-box; }
.sign-table-natural td > p[data-field][contenteditable="true"] { cursor: text; }
.sign-table-natural td > p[data-field][data-masked] { color: #475569; }
`;

/** 一行数据：收工月日时分 + 负责人 + 许可人 + 开工月日时分 + 负责人 + 许可人。 */
function rowCells(suffix: string): string {
  return `<tr>
    <td>{{收工月${suffix}}}</td><td>{{收工日${suffix}}}</td><td>{{收工时${suffix}}}</td><td>{{收工分${suffix}}}</td>
    <td>{{收工负责人${suffix}}}</td><td>{{收工许可人${suffix}}}</td>
    <td>{{开工月${suffix}}}</td><td>{{开工日${suffix}}}</td><td>{{开工时${suffix}}}</td><td>{{开工分${suffix}}}</td>
    <td>{{开工负责人${suffix}}}</td><td>{{开工许可人${suffix}}}</td>
  </tr>`;
}

const SIGN_TABLE_HTML = `
<table class="sign-table">
  <thead>
    <tr>
      <th colspan="4">收工时间</th>
      <th rowspan="2">工作负责人</th>
      <th rowspan="2">工作许可人</th>
      <th colspan="4">开工时间</th>
      <th rowspan="2">工作负责人</th>
      <th rowspan="2">工作许可人</th>
    </tr>
    <tr>
      <th>月</th><th>日</th><th>时</th><th>分</th>
      <th>月</th><th>日</th><th>时</th><th>分</th>
    </tr>
  </thead>
  <tbody>
    ${rowCells("1")}
    ${rowCells("2")}
    ${rowCells("3")}
  </tbody>
</table>
`;

/** 原生 [data-field] 变体一行：作者直接写 `<p contenteditable data-field>`，引擎后置可编辑性/脱敏/回填。 */
function nativeRowCells(suffix: string): string {
  return `<tr>
    <td><p contenteditable data-field="收工月${suffix}"></p></td>
    <td><p contenteditable data-field="收工日${suffix}"></p></td>
    <td><p contenteditable data-field="收工时${suffix}"></p></td>
    <td><p contenteditable data-field="收工分${suffix}"></p></td>
    <td><p contenteditable data-field="收工负责人${suffix}"></p></td>
    <td><p contenteditable data-field="收工许可人${suffix}"></p></td>
    <td><p contenteditable data-field="开工月${suffix}"></p></td>
    <td><p contenteditable data-field="开工日${suffix}"></p></td>
    <td><p contenteditable data-field="开工时${suffix}"></p></td>
    <td><p contenteditable data-field="开工分${suffix}"></p></td>
    <td><p contenteditable data-field="开工负责人${suffix}"></p></td>
    <td><p contenteditable data-field="开工许可人${suffix}"></p></td>
  </tr>`;
}

const SIGN_TABLE_NATIVE_HTML = `
<table class="sign-table-natural">
  <thead>
    <tr>
      <th colspan="4">收工时间</th>
      <th rowspan="2">工作负责人</th>
      <th rowspan="2">工作许可人</th>
      <th colspan="4">开工时间</th>
      <th rowspan="2">工作负责人</th>
      <th rowspan="2">工作许可人</th>
    </tr>
    <tr>
      <th>月</th><th>日</th><th>时</th><th>分</th>
      <th>月</th><th>日</th><th>时</th><th>分</th>
    </tr>
  </thead>
  <tbody>
    ${nativeRowCells("1")}
    ${nativeRowCells("2")}
    ${nativeRowCells("3")}
  </tbody>
</table>
`;

const htmlNode: HtmlNodeV2 = {
  id: "sign-table-html",
  type: "html",
  html: SIGN_TABLE_HTML,
  css: SIGN_TABLE_CSS,
};

/** 演示 schema：单页单格装一个 HTML 模块（复杂表）。 */
export function makeHtmlComplexTableSchema(): FormSchemaV2 {
  const grid: GridNodeV2 = {
    id: "sign-table-grid",
    type: "grid",
    border: "none",
    rows: [
      {
        id: "sign-table-row",
        type: "grid-row",
        height: 8,
        cells: [
          {
            id: "sign-table-cell",
            type: "grid-cell",
            width: "1fr",
            children: [htmlNode],
          },
        ],
      },
    ],
  };
  return {
    version: 2,
    paper: { size: "A4" },
    baseRowHeight: 8,
    pages: [
      {
        id: "sign-table-page",
        type: "page",
        mode: "fixed",
        margin: { top: 10, right: 10, bottom: 10, left: 10 },
        children: [grid],
      },
    ],
  };
}

/** 原生 [data-field] 变体演示 schema：结构与上方一致，绑定改用 `<p contenteditable data-field>`。 */
export function makeNativeHtmlComplexTableSchema(): FormSchemaV2 {
  const nativeNode: HtmlNodeV2 = {
    id: "sign-table-html-native",
    type: "html",
    html: SIGN_TABLE_NATIVE_HTML,
    css: SIGN_TABLE_NATIVE_CSS,
  };
  const grid: GridNodeV2 = {
    id: "sign-table-grid-native",
    type: "grid",
    border: "none",
    rows: [
      {
        id: "sign-table-row-native",
        type: "grid-row",
        height: 8,
        cells: [
          {
            id: "sign-table-cell-native",
            type: "grid-cell",
            width: "1fr",
            children: [nativeNode],
          },
        ],
      },
    ],
  };
  return {
    version: 2,
    paper: { size: "A4" },
    baseRowHeight: 8,
    pages: [
      {
        id: "sign-table-page-native",
        type: "page",
        mode: "fixed",
        margin: { top: 10, right: 10, bottom: 10, left: 10 },
        children: [grid],
      },
    ],
  };
}

/** 演示数据：填若干值（其余留空演示占位）。 */
export const htmlComplexTableData: FormDataV2 = {
  收工月1: "09",
  收工日1: "08",
  收工负责人1: "张三",
  开工月1: "09",
  开工日1: "07",
  开工负责人1: "李四",
  收工月2: "09",
  收工日2: "09",
};

/** 演示权限：收工许可人1 脱敏(HIDDEN)、开工负责人1 只读(READ)，其余 EDIT。 */
export const htmlComplexTablePermissions: Record<string, FieldPermissionV2> = {
  收工许可人1: "HIDDEN",
  开工负责人1: "READ",
};
