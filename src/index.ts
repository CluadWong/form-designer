/**
 * 总入口（同时包含渲染端与设计端）
 *
 * 只做聚合，方便一次性拿到全部能力；**生产环境建议按需引用子入口**
 * （`@cluadwong/form-designer/renderer` 或 `/designer`），避免把用不到的部分打进产物。
 */

export * from "./renderer";
export * from "./designer";
