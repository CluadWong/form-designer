import type { InjectionKey } from "vue";

/**
 * 「打开操作指南并定位到某一节」的注入键（2026-10-28）。
 *
 * 链路：`FormDesigner` 提供 `openHelp(section?)` → 深层 inspector 里的 `HelpLink` 注入后调用。
 * 走 provide/inject 而不是逐层 props，是因为 `HelpLink` 挂在 InspectorPanel 的孙组件里，
 * 中间层（InspectorPanel / 各 inspector）不该为「帮助面板」这件事承担透传责任。
 *
 * 缺省的注入值为 `null`：InspectorPanel 等组件被单独挂载（单测、宿主自绘面板）时，
 * `HelpLink` 直接不渲染，避免出现一个点了没反应的 `?`。
 */
export type HelpOpenFn = (section?: string) => void;

export const HELP_OPEN_KEY: InjectionKey<HelpOpenFn> = Symbol("v2-help-open");
