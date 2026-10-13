/**
 * 物理页「渲染后是否留下可见内容」的判定（2026-10-10）。
 *
 * 要解决的问题：分页引擎**只按高度**切页，不知道「切出来的这一段打印出来是否显影」。
 * 于是会产出两种「看起来空白」的纸：
 *   ① 纸上只有无来源的图片列表 —— `.layout-image--blank` 在 `@media print` 下 `display:none`
 *      （既定语义：无来源占位不占版面，见 `ImageBlankPrint.test.ts`），纸面全白；
 *   ② 纸上只有空 Grid 行（行内无任何子节点、且 Grid 无边框）—— 没有文本、没有框线，全白。
 * 典型触发：页中间 / 末尾留了大片空行把格撑满，后续内容被挤到下一页，而那个「下一页」
 * 恰好只剩无来源图片 → 打印多出一张空白纸。
 *
 * 为什么判定放在**渲染层**而不是「打印前那一瞬」：
 * 宿主脚本可能在渲染完成后才填入数据 —— 此刻判为空的纸张，数据一到就该**自动回来**。
 * 因此本模块是**纯函数且依赖 `data`**，由 `GridFormRenderer` 放进 `computed` 里调用：
 * `data` 一变，判定自动翻转、纸张自动出现。**不删 schema 节点、不删 DOM 节点**，
 * 只是「这张纸这一帧不出」。
 *
 * 调用侧闸门（见 `GridFormRenderer.visiblePages`）——**只在非设计态隐藏**：
 * 设计态（`mode === "design"`）一律保留全部纸张，画布上每一页都要能点中、能编辑
 * （设计画布默认就开着分页，空白页也很可能是有结构、等着填内容的页）；
 * 设计器的打印窗口是唯一例外，由 `FormDesigner.printDocument` 显式切到 `hide`。
 * 本模块只管「判」，不管「该不该判」。
 *
 * 判定口径 —— **宁保守勿误删**。判不准一律算「有内容」，原因是误删会让用户丢内容，
 * 多留一张纸只是不好看：
 * - Grid：`border` 不是 `none` → 有内容（框线会打印，哪怕每格全空）；
 *   否则递归其 cell 子树，任一后代有内容即算有内容。
 * - 字段 P（`mode === "field"`）→ 有内容（标签 / 下划线 / 可填控件都在纸面上留痕）。
 * - Table → 有内容（表头必然打印）。
 * - Text / Html → 去空白后（Html 再去标签）非空才算有内容。
 * - Image → 与渲染层 / 分页引擎**同一真源**判定（`resolveImageItemsV2` + `hasImageSourceV2`）；
 *   无来源即打印不显影，与 `ImageBlankPrint.test.ts` 锁定的口径一致。
 * - 其它 / 未知节点类型 → 有内容（向前兼容：新增节点类型默认保留）。
 */

import { hasImageSourceV2, resolveImageItemsV2 } from "@/engine-v2/derivation";
import type { PhysicalPage } from "@/engine-v2/pagination";
import type { FormDataV2, FormNodeV2 } from "@/types";

/** Html 内容去掉标签与不换行空格后是否还有可见文字。 */
function htmlHasText(html: unknown): boolean {
  return String(html ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim().length > 0;
}

/**
 * 单个节点在该 `data` 下是否会渲染出可见内容。
 *
 * ⚠️ 只用于「整张纸是否该出」的判定，**不得**用于决定是否渲染某个节点本身
 * —— 那会让「当前无值、稍后有值」的组件被永久移除。
 */
export function nodeHasVisibleContent(
  node: FormNodeV2,
  data?: FormDataV2 | null,
): boolean {
  switch (node.type) {
    case "grid": {
      // 有框线（all / outer / inner）→ 纸面上一定有线条，算有内容。
      if (node.border && node.border !== "none") return true;
      return node.rows.some((row) =>
        row.cells.some((cell) =>
          cell.children.some((child) => nodeHasVisibleContent(child, data)),
        ),
      );
    }
    case "text":
      return String(node.text ?? "").trim().length > 0;
    case "html":
      return htmlHasText(node.html);
    case "image":
      // 与渲染层同源：无来源 → @media print 下整块隐藏。
      return hasImageSourceV2(resolveImageItemsV2(node, { data: data ?? null }));
    case "table":
      // 表头必打，且 Table 自带边框语义；保守按下界处理。
      return true;
    case "p":
      // 字段 P：即便当前无值，标签 / 下划线 / 输入框仍在纸面上留痕（可填控件）。
      return true;
    default:
      // 未知节点类型：向前兼容，默认保留（宁可多留一张纸，不可误删内容）。
      return true;
  }
}

/**
 * 该物理页（一张纸）渲染后是否留下可见内容。
 *
 * 无子节点的纸（分页引擎为空逻辑页产出的兜底空纸）一律判为空。
 */
export function pageHasVisibleContent(
  page: PhysicalPage,
  data?: FormDataV2 | null,
): boolean {
  return page.children.some((child) => nodeHasVisibleContent(child.node, data));
}
