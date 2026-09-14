# 发布为 npm 包 · 消费端接入指南

本组件库以**公共 npm 包**形式交付，发布到 **npmjs.com**（包名 `@aikkk/ticket-designer`）。源码托管在 GitHub（[CluadWong/TicketDesigner](https://github.com/CluadWong/TicketDesigner)），`release` 分支为对外发布分支。

> 本指南只覆盖公共 npmjs 发布（`@aikkk/ticket-designer`），由 `release` 分支经 `npm run release` 完成；`dev` 为内部开发分支，不参与 npm 发布。

## 一、包结构（两个入口，按需引用）

| 入口 | 内容 | 谁用 |
|---|---|---|
| `@aikkk/ticket-designer/renderer` | `FormRenderer` / `GridFormRenderer` / `printForm` / `collectFieldValues` / Schema 类型 | **消费端**：渲染、填写、打印 |
| `@aikkk/ticket-designer/designer` | `FormDesigner` / `defaultDesignerUIConfig` / `buildBlankSchema` | 需要在宿主内编排模板时 |
| `@aikkk/ticket-designer` | 上面两个的合集 | 不推荐生产使用（会把设计器一起打进产物） |

样式按入口分离，**别引错**：

```
@aikkk/ticket-designer/renderer/style.css   → 渲染样式（.grid-form-paper / .layout-* / .paper-viewport）
@aikkk/ticket-designer/designer/style.css   → 渲染样式 + 设计器样式（.v2-* 面板类），**自足，不要再额外引 renderer 的**
@aikkk/ticket-designer/style.css            → 全量（根入口用，= renderer + designer）
```

只做渲染/填写的页面**只引 renderer 的样式**，否则设计器的非 scoped 样式会洒进宿主全局。

> **为什么 designer 的样式里含渲染样式**（2026-09-10 修复）：
> 渲染内核的 scoped CSS 只跟随 `renderer-core` chunk 输出一次，若 `designer-ui.css` 不含它，
> 只引 `designer/style.css` 的宿主会丢掉 `.grid-form-paper`（纸张没白底/阴影，只有选中节点时才被
> `.is-design-selected` 高亮出轮廓）、`.layout-grid__row/cell`（版式塌掉）、`.paper-viewport`。
> 现在 `build:lib` 末尾由 `mergeDesignerCss()` 插件把 `renderer-core.css` **前置拼接**进
> `designer-ui.css`（renderer 在前，保证设计器覆盖生效），三档样式各自自足。

## 二、本地构建与校验（发布前必跑）

```bash
npm run build:lib          # 产出 dist/（JS + CSS）
npm run build:types        # 产出 dist/*.d.ts
npm run pack:check         # 上面两步 + npm pack --dry-run，发布前必跑
```

产物：`dist/{index,renderer,designer}.js` + `dist/chunks/{renderer-core,designer-ui}.js` + `dist/{renderer-core,designer-ui,ticket-designer}.css` + 类型声明。

> `build:types` 末尾会自动跑 `scripts/fix-dts-alias.mjs`：把 `vue-tsc` 产物里残存的 `@/` 路径别名改写成相对路径。发布包**不能带 `@/`**（消费端没有这个别名，一 import 就报 `Cannot find module '@/types'`）。

## 三、发布到 npmjs.com

发布命令必须在**你本机**（已 `npm login` 到 npmjs，账号需拥有 `@aikkk` scope）执行。本 agent 沙箱无法代发。

```bash
npm ci                                      # 或 npm install
npm run build:lib && npm run build:types    # 产出 dist/
npm run pack:check                          # 先校验产物（npm pack --dry-run）
npm publish                                 # 发布（package.json 已配 publishConfig.access=public）
```

> 每个版本号只能发一次，重发会 409。改 bug 请升版本号（`npm version patch`）。
> 若本机残留 `.npmrc` 把 `@aikkk` scope 指向了其他私有 registry，发布前务必删除它（或加 `registry=https://registry.npmjs.org/` 覆盖），否则会发错地方。

## 四、消费端接入

### 1. 安装

```bash
npm i @aikkk/ticket-designer
```

### 2. `vite.config.ts` —— 必须加 dedupe

```ts
export default defineConfig({
  resolve: {
    // 关键：保证整个应用只有一份 Vue，否则响应式 / provide-inject / 组件解析全断
    dedupe: ['vue'],
  },
})
```

### 3. 用法

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { FormRenderer, type FormSchemaV2 } from '@aikkk/ticket-designer/renderer'
import '@aikkk/ticket-designer/renderer/style.css'

const schema = ref<FormSchemaV2>(/* 设计器导出的 JSON */)
const data = ref<Record<string, string>>({})
const rendererRef = ref<InstanceType<typeof FormRenderer> | null>(null)

async function submit() {
  const ok = await rendererRef.value?.validate()   // 必填校验
  if (!ok) return
  console.log(rendererRef.value?.getFormData())    // 采集填写结果
}
</script>

<template>
  <FormRenderer
    ref="rendererRef"
    v-model:data="data"
    :schema="schema"
    :options="{ readonly: false, fieldPermissions, rules }"
    @action="onAction"
  />
</template>
```

`FormRenderer` 暴露：`print()` / `getFormData()` / `validate()`。
`fieldPermissions`（READ/EDIT/HIDDEN）与 `rules`（必填）与数据同轨注入，不进 Schema。

## 五、三个必须注意的坑

1. **Vue 单例**：`vue` 是 peerDependency，绝不能被打进包。消费端务必配 `resolve.dedupe: ['vue']`，两个 Vue 副本会导致响应式失效、组件解析失败。
2. **全局 CSS**：渲染侧的 `HtmlBlock` 样式是非 scoped 的，类名带 `layout-` 前缀；设计器侧是 `v2-` 前缀。上线前在宿主里检查是否有同名类冲突。
3. **版本演进**：锁 `^0.1.0` 时注意 `0.x` 的 `^` 只锁 minor，破坏性变更必须升 minor（0.x 约定）。

## 六、开发期联调（不发版就能试）

```bash
# 本仓库
npm run build:lib && npm link

# 消费端项目
npm link @aikkk/ticket-designer
```

改一次要重新 `npm run build:lib`。联调完记得 `npm unlink`。
