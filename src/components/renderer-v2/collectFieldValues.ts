import type { FormDataV2, ImageItemV2 } from "@/types";

export interface CollectFieldValuesOptions {
  /**
   * 脱敏字段（HIDDEN）的真实值来源（响应式数据侧，如 `previewFormData`）：
   * 本机「保存数据」时回源真实数据，保证 保存→读取 循环不丢值。
   */
  baseData?: FormDataV2 | null;
  /**
   * 脱敏导出口径（P9.2b，用户拍板）：为 `true` 时 HIDDEN 字段采集为 `***`
   * （**保持脱敏**，用于「导出数据」外发场景），优先于 `baseData` 回源。
   */
  maskHidden?: boolean;
}

/**
 * 通过遍历渲染 DOM 收集字段值（用户需求：预览 / 填写不必逐键回写，改用 DOM 遍历采集）。
 *
 * - 带 `data-field` 的普通文本字段（`<p>` / 复合字段的 `.layout-p__input`）取其文本；
 * - **图片列表**（`.layout-image__item[data-field]`）：同一字段的多个条目聚成
 *   `ImageItemV2[]`（`{ name, src, width, height }`），**字段值是数组**——这是与文本字段
 *   唯一的形态差异；条目盒上的 `data-*` 承载 name / 尺寸，避免从样式里反解数值；
 * - 带 `data-field` 的单张 `<img>`（旧版单图节点的 DOM）取其 `src` 字符串（兼容路径）；
 * - 多行（innerBorder 逐行 div）在浏览器中由 `innerText` 还原为带 `\n` 的文本，
 *   jsdom 等无 `innerText` 实现时回退 `textContent`（不含换行分隔）；
 * - **HIDDEN 脱敏字段**（`.layout-p--hidden`）：DOM 中显示的是假值 `***`，按调用方
 *   口径二选一——`maskHidden: true`（「导出数据」外发）→ 采集为 `***` 保持脱敏；
 *   否则从 `baseData` 回源真实数据（本机「保存数据」循环）；两者皆无 → 省略该字段
 *   （绝不把 DOM 假值当真值采集）。
 *
 * @param root 渲染根容器，如 `.grid-form-canvas` 或 `GridFormRenderer` 的挂载元素。
 */
/**
 * 从图片列表条目盒（`.layout-image__item`）还原一条图片值。
 *
 * name / 宽高放在条目盒的 `data-*` 上（渲染时写入模板配置或数据值），直接回读既避免
 * 从内联样式里反解 mm 数值，也保证「保存 → 读取」闭环无损。
 * 加载失败退回的占位图不是真值：带 `data-fallback` 时 src 记为空串。
 */
function readImageItem(el: HTMLElement): ImageItemV2 {
  const item: ImageItemV2 = {};
  const name = el.getAttribute("data-name");
  if (name) item.name = name;
  const img = el.querySelector("img");
  item.src = img?.getAttribute("data-fallback") === "true"
    ? ""
    : (img?.getAttribute("src") ?? "");
  const rawWidth = el.getAttribute("data-width");
  const rawHeight = el.getAttribute("data-height");
  const width = Number(rawWidth);
  const height = Number(rawHeight);
  if (rawWidth && Number.isFinite(width) && width > 0) item.width = width;
  if (rawHeight && Number.isFinite(height) && height > 0) item.height = height;
  return item;
}

export function collectFieldValues(
  root: ParentNode,
  options: CollectFieldValuesOptions = {},
): FormDataV2 {
  const { baseData, maskHidden } = options;
  const result: Record<string, unknown> = {};
  // root 自身即字段（如直接挂载 GridSchemaNode 时根就是 <p data-field>）也要纳入：
  // querySelectorAll 只匹配后代、不含根，故先单独检查根。
  const self = root instanceof Element && root.matches("[data-field]")
    ? [root as HTMLElement]
    : [];
  const nodes = [
    ...self,
    ...root.querySelectorAll<HTMLElement>("[data-field]"),
  ];
  for (const el of Array.from(nodes)) {
    const field = el.getAttribute("data-field");
    if (!field) continue;
    // 图片列表条目：同字段多条聚合为数组（DOM 顺序即 index 顺序）。
    if (el.classList.contains("layout-image__item")) {
      const items = (result[field] as ImageItemV2[] | undefined) ?? [];
      items.push(readImageItem(el));
      result[field] = items;
      continue;
    }
    // 列表容器本身也带 `data-field`（标识整块列表属于哪个字段），但不是字段值元素：
    // 不跳过会被当成文本字段采成 `""`，把刚聚合好的数组覆盖掉。
    if (el.classList.contains("layout-image")) continue;
    // 条目内部的 `<img>` / 名称文本已由条目统一采集，不重复处理。
    if (el.closest(".layout-image__item")) continue;
    // HIDDEN 脱敏字段：DOM 值是假值 ***，按调用口径回源真实值或保持脱敏导出
    if (el.closest(".layout-p--hidden")) {
      if (maskHidden) {
        result[field] = "***";
      } else {
        const real = baseData?.[field];
        if (real != null) result[field] = String(real);
      }
      continue;
    }
    if (el instanceof HTMLImageElement) {
      result[field] = el.getAttribute("src") ?? "";
      continue;
    }
    const text = el.innerText;
    result[field] = typeof text === "string" ? text : (el.textContent ?? "");
  }
  // HTML 模块（Shadow DOM 隔离）：穿透 shadowRoot 采集两类绑定值。
  // 1) {{field}} 占位（引擎生成 data-bind）：<input>（可写/只读回填）与 data-masked（HIDDEN 脱敏 ***）；
  //    设计态占位 <span data-bind>（无 data-masked、非 input）跳过，避免把空占位当值采回。
  // 2) 原生 [data-field]（作者控 markup，如 <p contenteditable data-field>）：HIDDEN 经 applyFieldState
  //    标 data-masked（DOM 文本为 ***），其余取文本；与 GridSchemaNode 的 [data-field] 主路径同口径。
  const htmlBlocks = [
    ...(root instanceof HTMLElement && root.matches(".layout-html")
      ? [root]
      : []),
    ...root.querySelectorAll<HTMLElement>(".layout-html"),
  ];
  for (const block of Array.from(htmlBlocks)) {
    const sRoot = block.shadowRoot;
    if (!sRoot) continue;
    // 1) {{field}} 占位 → data-bind
    sRoot.querySelectorAll<HTMLElement>("[data-bind]").forEach((el) => {
      const field = el.getAttribute("data-bind");
      if (!field) return;
      if (el.hasAttribute("data-masked")) {
        if (maskHidden) {
          result[field] = "***";
        } else {
          const real = baseData?.[field];
          if (real != null) result[field] = String(real);
        }
        return;
      }
      if (el instanceof HTMLInputElement) {
        result[field] = el.value;
        return;
      }
      // 设计态占位 span：跳过（见上）
    });
    // 2) 原生 [data-field]（作者直接写进 HTML 片段的绑定元素）
    sRoot.querySelectorAll<HTMLElement>("[data-field]").forEach((el) => {
      const field = el.getAttribute("data-field");
      if (!field) return;
      if (el.hasAttribute("data-masked")) {
        if (maskHidden) {
          result[field] = "***";
        } else {
          const real = baseData?.[field];
          if (real != null) result[field] = String(real);
        }
        return;
      }
      const text = el.innerText;
      result[field] = typeof text === "string" ? text : (el.textContent ?? "");
    });
  }
  return result as FormDataV2;
}
