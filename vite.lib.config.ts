import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import fs from "node:fs";
import path from "node:path";

/**
 * 组件库构建配置（发布 npm 包用）
 *
 * 与 `vite.config.ts`（应用多页构建，输出到 dist-app）分离，互不干扰。
 * 产物：`dist/{index,renderer,designer}.js` + `dist/ticket-designer.css`
 *
 * 三条硬约束（改前先看 publish-npm.md）：
 *   1. `vue` 必须 external —— 否则宿主会打进第二份 Vue，响应式 / provide-inject / 组件解析全断。
 *      `@panzoom/panzoom`、`dompurify`、`vue-print-next` 走 npm 正常安装即可（渲染内核在用，
 *      非设计器专属）；一并 external，宿主自行安装由 `dependencies` 声明的那几份。
 *      ⚠️ `vue-print-next` 是渲染内核的**运行时依赖**（`print-form.ts` 顶层 import），
 *      不是设计器专属——`@cluadwong/form-designer/renderer` 入口也会引到它，宿主只装 renderer 也必须装它。
 *   2. 只出 ESM —— 宿主是 Vite，不需要 UMD / CJS。
 *   3. `@/` 别名必须与主配置一致，否则 lib 构建解析失败。
 */
/**
 * CSS 归属修正插件（2026-09-10 修）：**渲染内核样式必须随 designer 入口一起给出**。
 *
 * 背景：`manualChunks` 把 `src/components/renderer-v2/**` 整体归到 `renderer-core` chunk，
 * 而 CSS 只跟随模块所在 chunk 输出一次 —— 于是 `.grid-form-paper` / `.layout-grid__row` /
 * `.paper-viewport` 等渲染内核 scoped 样式全部只落在 `renderer-core.css`。
 * 后果：宿主只引 `@cluadwong/form-designer/designer/style.css` 时纸张没有白底与阴影、
 * 网格版式塌掉（选中节点时因 `.is-design-selected` 在 designer-ui.css 里才看得到纸）。
 *
 * 修法：构建后把 `renderer-core.css` 内容 **前置拼接** 到 `designer-ui.css`
 * （renderer 在前、designer 在后，保证设计器对渲染内核的覆盖仍然生效，例如
 * `.v2-canvas-surface--preview .grid-form-canvas{padding:24px}`），
 * 并额外产出全量 `ticket-designer.css` 供根入口 `.` 使用。
 *
 * 这样三档样式各自自足，互不污染：
 *   - `renderer/style.css`  → renderer-core.css（纯渲染内核，最小）
 *   - `designer/style.css`  → designer-ui.css（渲染内核 + 设计器 UI，自足）
 *   - `style.css`           → ticket-designer.css（全量，根入口含两端）
 */

/**
 * 样式归属回归守卫（2026-09-11 扩充为两组）。
 *
 * 为什么需要：`.v2-designer` 这类**设计器骨架样式**写在 `FormDesigner.vue` 的 `<style scoped>` 里，
 * 编译后是 `.v2-designer[data-v-0316d7cd]{display:grid;…}` —— **minify 后整个文件一行、选择器与 `{`
 * 之间没有空格**。于是 `grep "\.v2-designer {"` 必然零命中，极易被误判成「样式没打包进产物」。
 * 与其靠人工核对，不如让构建期硬断言：缺了就直接失败。
 *
 * 两组分别覆盖三种宿主引用方式：
 *   - RENDERER_REQUIRED：宿主只引 `@cluadwong/form-designer/renderer` → `renderer-core.css` 必须自足，否则纸没白底/版式塌。
 *   - DESIGNER_REQUIRED：宿主引 `@cluadwong/form-designer/designer` → 合并后 `designer-ui.css` 必须同时含内核与设计器骨架。
 *
 * 注意：`.v2-toolbar` 来自唯一的**非 scoped 全局表** `src/components/designer/styles/designer-ui.css`
 * （由 `FormDesigner.vue` import）；其余三条来自该 SFC 的 scoped 块。任一侧被挪走都会被这里拦住。
 */
const RENDERER_REQUIRED = [".grid-form-paper", ".layout-grid__row", ".paper-viewport"];
const DESIGNER_REQUIRED = [
  ".v2-designer",
  ".v2-designer__body",
  ".v2-canvas",
  ".v2-toolbar",
];

/** 内联段开头（与历史产物保持同一句文本，便于识别旧产物）。 */
const INLINE_HEAD =
  "/* 以下内容内联自 renderer-core.css：设计器复用渲染内核呈现纸张与版式，必须一并加载 */\n";
/** 内联段结束哨兵：`stripInlinedCore` 靠它界定「已内联过一次」的范围。 */
const INLINE_END = "\n/* ===== 内联自 renderer-core.css 结束 ===== */\n";

/**
 * 剥掉上一轮已内联进 `designer-ui.css` 的渲染内核段（**幂等合并的关键**）。
 *
 * 为什么必须剥：`vite build --watch`（`dev:lib`）下 Vite 用带内容 hash 缓存的写盘逻辑，
 * **本轮 CSS 与上一轮字节相同时会跳过写入** —— 此时磁盘上的 `designer-ui.css` 仍是
 * 上一轮 `closeBundle` 合并后的结果（内核 + 设计器）。若无条件再拼一次，内核样式会被
 * 重复内联，文件随每次「CSS 未变的重建」膨胀。
 *
 * 未合并过的纯产物不含哨兵，原样返回。
 */
function stripInlinedCore(css: string): string {
  const start = css.indexOf(INLINE_HEAD);
  if (start === -1) return css;
  const end = css.indexOf(INLINE_END, start);
  if (end === -1) return css;
  return css.slice(0, start) + css.slice(end + INLINE_END.length);
}

function mergeDesignerCss(): Plugin {
  return {
    name: "merge-designer-css",
    apply: "build",
    closeBundle() {
      const distDir = fileURLToPath(new URL("./dist", import.meta.url));
      const core = path.join(distDir, "renderer-core.css");
      const ui = path.join(distDir, "designer-ui.css");
      if (!fs.existsSync(core) || !fs.existsSync(ui)) return;

      const coreCss = fs.readFileSync(core, "utf8");
      const uiCss = stripInlinedCore(fs.readFileSync(ui, "utf8"));
      const merged = INLINE_HEAD + coreCss + INLINE_END + uiCss;

      fs.writeFileSync(ui, merged, "utf8");
      fs.writeFileSync(path.join(distDir, "ticket-designer.css"), merged, "utf8");

      // ① 渲染内核入口必须自足：宿主只引 `@cluadwong/form-designer/renderer/style.css` 时纸张与版式要有样式。
      const coreMissing = RENDERER_REQUIRED.filter((sel) => !coreCss.includes(sel));
      if (coreMissing.length) {
        this.error(
          `renderer-core.css 缺少渲染内核样式（${coreMissing.join("、")}）：` +
            `renderer 入口不自足，宿主只引 @cluadwong/form-designer/renderer 会丢纸张与版式样式。`,
        );
      }

      // ② 设计器入口必须自足：渲染内核 + 设计器骨架（含各 SFC 的 scoped 样式）都要在 designer-ui.css 里。
      const uiMissing = [...RENDERER_REQUIRED, ...DESIGNER_REQUIRED].filter(
        (sel) => !merged.includes(sel),
      );
      if (uiMissing.length) {
        this.error(
          `designer-ui.css 缺少样式（${uiMissing.join("、")}）：` +
            `CSS 归属已漂移（见 mergeDesignerCss 顶部说明），宿主只引 designer/style.css 会丢纸张 / 版式 / 设计器骨架样式。`,
        );
      }
    },
  };
}

/**
 * chunk 依赖单向守卫（2026-09-16 加）。
 *
 * 为什么需要：`manualChunks` 的兜底规则会把**库入口文件本身**也卷进分组。`src/designer.ts`
 * 一旦落进 `renderer-core`，就产生反向边 `renderer-core → designer-ui`，与正向的
 * `designer-ui → renderer-core` 成环。Rollup 对此**只打一条 warning**（`Circular chunk:
 * designer-ui -> renderer-core -> designer-ui`），构建照样成功、产物照样能跑，但环会让 ESM
 * 的求值顺序出现 TDZ —— 宿主侧表现为「一 import 设计器就报 Cannot access 'X' before
 * initialization」，症状离病因极远，历史上只能靠宿主 `fdRuntime.ts` 惰性引用绕过。
 * 所以这条不能只留 warning，必须在构建期硬失败。
 * 完整契约（入口 / exports / CSS 三档归属 / 环的排查方法）见 `docs/lib-build.md`。
 */
function assertChunkDirection(): Plugin {
  return {
    name: "assert-chunk-direction",
    apply: "build",
    generateBundle(_options, bundle) {
      const core = bundle["chunks/renderer-core.js"];
      if (!core || core.type !== "chunk") return;
      if (core.imports.includes("chunks/designer-ui.js")) {
        this.error(
          "chunk 依赖成环：renderer-core 反向 import designer-ui —— 设计器入口文件被 " +
            "manualChunks 误分到了 renderer-core（见本文件 manualChunks 注释）。" +
            "该环会导致宿主 ESM 求值 TDZ，构建已中止。",
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [vue(), mergeDesignerCss(), assertChunkDirection()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    // 默认**不清理** dist —— 这里是刻意的，别随手改回 true：
    //   `build:types` 把 .d.ts 也写进同一个 dist，而 watch 模式下 Vite 会在**每次**
    //   BUNDLE_START 调 `prepareOutDir`（gate 是 `emptyOutDir !== false`）。
    //   配置写 true 会让 `dev:lib` 每轮重构建都清掉 .d.ts，宿主（link 状态）整场开发
    //   都拿不到类型声明。一行 CLI `--emptyOutDir false` **挡不住重构建**，已实测。
    //   一次性构建要清理陈旧产物时，由 `build:lib` 脚本显式传 `--emptyOutDir`。
    emptyOutDir: false,
    sourcemap: false, // 发布包不带 sourcemap（体积减半）；需排查时临时改 true 本地构建
    // 按入口拆分 CSS：否则三个入口的样式会合并成一个文件，
    // 只引 renderer 的宿主会被迫加载设计器样式（.v2-toolbar 等），污染全局。
    cssCodeSplit: true,
    lib: {
      entry: {
        index: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
        renderer: fileURLToPath(new URL("./src/renderer.ts", import.meta.url)),
        designer: fileURLToPath(new URL("./src/designer.ts", import.meta.url)),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: ["vue", "@panzoom/panzoom", "dompurify", "vue-print-next"],
      output: {
        // [name] 跟随入口/chunk：renderer-core.css / designer-ui.css 各归各的
        assetFileNames: "[name].[ext]",
        chunkFileNames: "chunks/[name].js",
        // 固定 chunk 归属，让 CSS 文件名稳定且语义正确（chunk 名是 exports 契约的一部分，别改）：
        //   ./renderer/style.css → renderer-core.css、./designer/style.css → designer-ui.css
        // 不指定的话，renderer 的样式会跟着共享 chunk 被命名成 collectFieldValues.css
        // 分配规则必须保证 chunk 依赖**单向**：designer-ui → renderer-core（设计器用渲染内核），
        // 反向那条边不允许存在。
        // 曾经的坑（2026-09-16 修）：兜底规则 `id.includes("/src/")` 会把**库入口文件本身**
        // 也算进去 —— `src/designer.ts` 因此被塞进 renderer-core，而它 import 的正是
        // FormDesigner.vue 等设计器模块，于是 renderer-core 反向 import designer-ui
        // （产物里表现为 `chunks/renderer-core.js` 顶部的 `import "./designer-ui.js"`），
        // 与正向依赖成环，Rollup 报：
        //   `Circular chunk: designer-ui -> renderer-core -> designer-ui`
        // 该环即宿主侧 TDZ 的根因（此前靠宿主 fdRuntime 惰性引用绕过），在这里治本。
        // 因此**制造环的入口必须排除在兜底之外**（`return;` 交回 Rollup 默认分块，进各自入口
        // chunk）——只有 `index.ts`（聚合两端）和 `designer.ts`（引设计器目录）需要排除。
        // 注意别顺手把 `designer.ts` 改成归 "designer-ui"：含入口模块的 chunk 会改用入口名，
        // `chunks/designer-ui.js` 直接消失、CSS 漂成 `designer.css`，同时命中 exports 契约
        // （`./designer/style.css` → `dist/designer-ui.css`）与 mergeDesignerCss 的断言。
        // `renderer.ts` 只依赖内核，留在兜底里无环 —— 挪走它反而会让 CSS 归属漂移，别动。
        manualChunks(id) {
          // Windows 下 Rollup 的 id 可能带反斜杠，归一化后再做路径匹配
          const mod = id.replace(/\\/g, "/");
          if (mod.includes("node_modules")) return;
          if (/\/src\/(index|designer)\.ts$/.test(mod)) return;
          if (mod.includes("/src/components/designer/")) return "designer-ui";
          if (mod.includes("/src/")) return "renderer-core";
        },
      },
    },
  },
});
