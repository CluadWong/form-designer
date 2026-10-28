/**
 * 字段 P 的**生效行数**（2026-10-27）。
 *
 * 住在 types 层而不是 engine 层，理由与 `schema-v2-header` 相同：渲染、分页、Schema 校验
 * 三方要拿到同一答案，而校验层（`schema-v2-validation`）不能反向依赖 `engine-v2/derivation`
 * （会形成 types ⇄ engine 循环）。`engine-v2/derivation` 原样再导出本符号，历史引用无需改动。
 *
 * 本模块只依赖 `./schema-v2` 的类型，无运行时依赖、无副作用。
 */

import type { FieldPNodeV2 } from "./schema-v2";

/**
 * `default` 文本的换行数（≥1）。空 / 未设 → 1 行；`"\n"` → 2 行。
 *
 * 这是「历史行数来源」：升级前字段有几行完全由默认内容里的换行决定
 * （逐行 `<div>` 的张数、分页行盒高度都按它算）。保留为独立函数，供旧引用与
 * `resolvePFieldRowsV2` 的下限兜底共用。
 */
export function resolveDefaultLineCountV2(defaultValue?: string): number {
  const raw = typeof defaultValue === "string" ? defaultValue : "";
  return Math.max(1, raw.split("\n").length);
}

/**
 * 字段 P 的**生效行数**：初始 / 最小行数，不是固定高度。
 *
 * 取值 = `max(1, floor(rows), default 的换行数)`：
 * - `rows` 是设计期显式配置的初始行数（面板「初始行数」）：空值就占 N 行，
 *   输入内容超出后继续长高（所在 Grid 行只有 `min-height`，内容会把行撑开）；
 * - `default` 的换行数作**下限**兜底 —— 默认内容本身有 3 行时不能只显示 1 行；
 *   同时保住历史行为：只有 `default`、没有 `rows` 的老 schema，结果与升级前逐值相同。
 *
 * 消费方必须共用本函数，否则「屏上 N 行 / 分页按 1 行算」会高度错配：
 * - 渲染层 `GridSchemaNode`：`min-height: calc(N * 1.6em)` 与逐行 `<div>` 的张数；
 * - 分页 `pagination.atomicNodeHeightMm`：Grid 外裸 p 的行盒高度；
 * - 校验 `schema-v2-validation.minNodeHeightMm`：内容超高判定。
 */
export function resolvePFieldRowsV2(
  node: Pick<FieldPNodeV2, "rows" | "default">,
): number {
  const configured = node.rows;
  const byRows =
    typeof configured === "number" &&
    Number.isFinite(configured) &&
    configured > 0
      ? Math.floor(configured)
      : 1;
  return Math.max(byRows, resolveDefaultLineCountV2(node.default));
}
