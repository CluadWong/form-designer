# 库构建与产物契约（vite.lib.config.ts）

> 面向**改动 `vite.lib.config.ts`、调整 `exports`、或排查宿主引入异常**的人。
> 应用构建（`vite.config.ts` → `dist-app`）不在此文范围。

## 一、三个入口

| 入口 | 源文件 | 定位 |
|---|---|---|
| `.` | `src/index.ts` | 聚合入口，同时导出渲染端与设计端。**只做聚合**，生产环境建议按需引子入口 |
| `./renderer` | `src/renderer.ts` | 渲染 / 填写 / 打印。消费端（ERP 等）只引这个 |
| `./designer` | `src/designer.ts` | 设计器 UI。会带上全部设计器样式，消费端不要引 |

入口文件一律用**相对路径** import，不用 `@/` 别名 —— 否则生成的 `.d.ts` 会保留别名，消费方 TS 解析不了。

## 二、产物清单与 exports 契约

```
dist/index.js               入口 facade       dist/chunks/renderer-core.js   渲染内核实体
dist/renderer.js            入口 facade       dist/chunks/designer-ui.js     设计器实体
dist/designer.js            入口 facade
dist/renderer-core.css      内核样式          dist/*.d.ts                    类型（build:types 产出）
dist/designer-ui.css        设计器样式（已内联内核样式）
<全量 CSS>                  根入口 `.` 用，由 mergeDesignerCss 生成
```

**chunk 名 `renderer-core` / `designer-ui` 是 `exports` 契约的一部分，不是内部命名。** 它们直接决定 CSS 文件名：

| `exports` 键 | 目标 |
|---|---|
| `./renderer/style.css` | `dist/renderer-core.css` |
| `./designer/style.css` | `dist/designer-ui.css` |
| `./style.css` | 全量 CSS |

**改 chunk 名 = 改包对外契约 = 破坏所有已引用该样式的宿主。** 宿主已经按这些路径写进代码了，没有回旋空间。

## 三、三条硬约束

1. **`vue` 必须 external**。否则宿主会打进第二份 Vue，响应式 / provide-inject / 组件解析全断。
   `@panzoom/panzoom`、`dompurify`、`vue-print-next` 一并 external，由 `dependencies` 声明、宿主自行安装。
   注意 `vue-print-next` 是**渲染内核的运行时依赖**（`print-form.ts` 顶层 import），不是设计器专属 ——
   宿主只引 `renderer` 也必须装它。
2. **只出 ESM**。宿主是 Vite，不需要 UMD / CJS。
3. **`@/` 别名必须与主配置一致**，否则 lib 构建解析失败。

## 四、CSS 三档归属

`manualChunks` 把渲染内核模块归 `renderer-core` chunk、设计器模块归 `designer-ui` chunk，而 **CSS 只跟随模块所在 chunk 输出一次** —— 于是内核 scoped 样式（`.grid-form-paper`、`.layout-grid__row`、`.paper-viewport` 等）只会落在 `renderer-core.css`。宿主只引 `designer/style.css` 时纸张没白底、版式塌。

修法：`mergeDesignerCss` 插件在 `closeBundle` 把 `renderer-core.css` **前置拼接**到 `designer-ui.css`（内核在前、设计器在后，保证设计器对内核的覆盖仍生效），并额外产出全量 CSS。三档各自自足：

- `renderer/style.css` → 纯内核，最小；
- `designer/style.css` → 内核 + 设计器 UI，自足；
- `style.css` → 全量。

拼接用 `INLINE_HEAD` / `INLINE_END` 哨兵界定已内联段 —— **幂等合并的关键**：`dev:lib`（`vite build --watch`）下 Vite 对内容未变的 CSS 会跳过写盘，磁盘上仍是上一轮合并结果，不剥旧段就会随每次重建膨胀。

## 五、chunk 依赖必须单向（2026-09-16 修）

**唯一允许的方向：`designer-ui` → `renderer-core`**（设计器用渲染内核）。反向那条边不存在才正常。

### 症状
`build:lib` 报：

```
Circular chunk: designer-ui -> renderer-core -> designer-ui
```

**构建照样成功、产物照样能跑**，但这个环会让 ESM 求值顺序出现 TDZ —— 宿主侧表现为「一 import 设计器就报 `Cannot access 'X' before initialization`」，症状离病因极远。

### 成因
`manualChunks` 的兜底规则 `id.includes("/src/") → "renderer-core"` 会把**库入口文件自身**也卷进去。`src/designer.ts` 不匹配 `/src/components/designer/`，于是落进 `renderer-core` chunk，而它 import 的正是 `FormDesigner.vue` 等设计器模块。产物里能看到证据 —— `chunks/renderer-core.js` 顶部一行：

```js
import "./designer-ui.js";
```

（`export *` 经 tree-shake 后只剩纯副作用导入，很容易被当成无害代码忽略。）

### 改法
入口自身不参与手动分组，交回 Rollup 默认分块：

```ts
manualChunks(id) {
  const mod = id.replace(/\\/g, "/");
  if (mod.includes("node_modules")) return;
  if (/\/src\/(index|designer)\.ts$/.test(mod)) return;
  if (mod.includes("/src/components/designer/")) return "designer-ui";
  if (mod.includes("/src/")) return "renderer-core";
}
```

- 只排除 `index.ts`（聚合两端）与 `designer.ts`（引设计器目录）这两个**会造成环的入口**；
- **`renderer.ts` 留在兜底里不要动** —— 它只依赖内核，无环，挪走反而让 CSS 归属漂移；
- `id` 归一化反斜杠（Windows 下 Rollup 的 id 可能带 `\`）。

### 不要这么改（实测更糟）
把 `designer.ts` 归到 `"designer-ui"`：**含入口模块的 chunk 会改用入口名** —— `chunks/designer-ui.js` 直接消失、CSS 漂成 `dist/designer.css`，同时打爆 `exports` 契约与 `mergeDesignerCss` 的断言。

### 守卫
`assertChunkDirection()` 插件在 `generateBundle` 检查 `chunks/renderer-core.js` 的 `imports` 是否含 `chunks/designer-ui.js`，命中即 `this.error` **中止构建**。Rollup 对环只打 warning，靠 warning 挡不住回归，必须硬失败。

## 六、怎么定位 chunk 环（可复用）

临时叠一个诊断插件（用完删掉，不要进仓库）：

```ts
function diagChunks(): Plugin {
  return {
    name: "diag-chunks", apply: "build",
    generateBundle(_options, bundle) {
      const owner = new Map<string, string>();
      for (const [name, item] of Object.entries(bundle)) {
        if (item.type !== "chunk") continue;
        for (const id of item.moduleIds) owner.set(id, name);
      }
      for (const id of this.getModuleIds()) {
        const from = owner.get(id); if (!from) continue;
        const info = this.getModuleInfo(id); if (!info) continue;
        for (const dep of info.importedIds) {
          const to = owner.get(dep);
          if (to && to !== from) this.warn(`EDGE ${from} -> ${to} :: ${id} -> ${dep}`);
        }
      }
    },
  };
}
```

先用各 chunk 的 `moduleIds` 建 `id → chunk` 映射，再遍历模块的 `importedIds` 打所有跨 chunk 边。2026-09-16 那次 34 条边里 4 条反向边**全部来自同一个模块**，一次定位。

## 七、改动自查清单

- [ ] chunk 名没动（`renderer-core` / `designer-ui`），CSS 文件名没漂
- [ ] `build:lib` 无 `Circular chunk` 警告，且 `assertChunkDirection` 未报错
- [ ] `dist/renderer-core.css` 含 `.grid-form-paper` / `.layout-grid__row` / `.paper-viewport`
- [ ] `dist/designer-ui.css` 除上述外还含 `.v2-designer` / `.v2-designer__body` / `.v2-canvas` / `.v2-toolbar`（缺则 mergeDesignerCss 会直接失败）
- [ ] 入口文件仍用相对路径 import（未引入 `@/` 别名）
- [ ] `vue` 仍在 `external`
