# form-designer

> 固定布局表单设计器：可视化编排版式 → 导出 Schema JSON → 由渲染组件消费并填充 / 打印。

技术栈 Vue 3.5 + TypeScript + Vite + Vitest，无后端依赖，可整体嵌入任意 Vue 3 应用。

## 它解决什么

纸质作业票、工作票、登记表这类表单的共同点是**版式固定、要精确打印**。传统表单引擎按流式布局渲染，对不齐格子、打不出边框。
本项目的 Schema V2 用「页面 → 格子(Grid) → 行 → 单元格 → 组件」的固定坐标模型描述版式，渲染结果与打印结果同源同口径。

## 特性

- **设计器**：左侧组件栏拖拽到画布、结构树层级选择、右侧属性面板、撤销/重做、自动分页预览、一键打印
- **节点类型**：Page / Grid（格子）/ Row / Cell / P（字段）/ Text（固定文本）/ Table / HTML / Image
- **渲染内核**：设计、预览、填写、打印共用同一渲染路径（由 `RenderPathIsomorphism` 测试锁死逐字符一致）
- **自动分页**：`src/engine-v2/pagination.ts` 纯函数分页，DOM 无关、确定性，按 Grid 行边界与 Table 数据行切分
- **字段级权限与校验**：`fieldPermissions`（READ/EDIT/HIDDEN）与 `rules`（必填）与数据同轨注入，不进 Schema
- **纸张与打印**：A4/A3 尺寸驱动方向，`@page` 由渲染内核运行时注入
- **完整类型声明**：Schema V2 类型、渲染期领域逻辑（分页 / 派生）随包导出

## 安装

```bash
npm install @cluadwong/form-designer
```

- `vue` 是 peerDependency（`^3.5.0`），需自行安装；同页挂多个实例时务必 `resolve.dedupe: ['vue']`（见「注意事项」）。
- 三个运行时依赖会随包自动装上：`@panzoom/panzoom`（纸张视口缩放）、`dompurify`（HTML 模块净化）、
  `vue-print-next`（局部打印）。它们在构建时已 external，不会打进包产物，但**必须随包安装** ——
  若你有依赖裁剪策略，别把它们剔除。
- 包内提供两个按需入口：`@cluadwong/form-designer/renderer`（渲染 / 填写 / 打印）与
  `@cluadwong/form-designer/designer`（编排模板），详见「用法」。

## 快速开始

消费端（渲染 / 填写 / 打印）只需 `renderer` 入口，最小示例：

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { FormRenderer, printForm } from '@cluadwong/form-designer/renderer'
import type { FormSchemaV2, FormDataV2 } from '@cluadwong/form-designer/renderer'
// 样式按入口分离，引入 renderer 对应的样式
import '@cluadwong/form-designer/renderer/style.css'

// 设计器导出的 Schema JSON（服务端存储后下发）
const schema = ref<FormSchemaV2>(/* ... */)
const data = ref<FormDataV2>({})
const formRef = ref<InstanceType<typeof FormRenderer> | null>(null)
</script>

<template>
  <FormRenderer ref="formRef" :schema="schema" v-model:data="data" />
  <button @click="formRef?.print()">打印</button>
</template>
```

### 打印

打印是**局部打印**：用 `vue-print-next` 把纸张元素（`.grid-form-paper`）序列化进一个同源 iframe 再调起
浏览器打印。页面的菜单 / 头部 / 其他区域**天然不进打印流**，不再依赖 `@media print` 逐条隐藏
（那种做法页面结构一变就漏）。

两个触发入口，任选：

| 方式 | 用法 | 说明 |
|---|---|---|
| 组件方法（推荐） | `formRef.value.print()` | 自动把**本实例**的纸张作为打印根，同页多个表单实例互不干扰 |
| 纯函数 | `printForm({ root })` | `root` 取渲染容器；不传时自动取页面里第一个 `.grid-form-canvas` |

纸张尺寸跟着 Schema 的 `paper` 走（A4 竖向 / A3 横向），`@page` 规则由渲染内核在挂载期注入。
**不要自己再写 `@page`** —— 打印插件被刻意告知不设置纸张尺寸，它一旦拿到尺寸参数就会覆盖内核注入的那条。

> **HTML 模块**（`type: "html"`，内容用 Shadow DOM 隔离）在送印前会被临时"提升"到普通 DOM：
> 插件靠 `cloneNode` + 序列化取内容，而 `cloneNode` 拿不到 shadow tree，不处理会打出空白。
> 整个过程对外透明，打印结束自动还原（含表单控件的实时输入值）。

需要在应用内编排模板时，改用 `designer` 入口：

```ts
import { FormDesigner, buildBlankSchema } from '@cluadwong/form-designer/designer'
import '@cluadwong/form-designer/designer/style.css'
```

## 用法

两个按需入口，按消费场景选择：

| 入口 | 内容 | 谁用 |
|---|---|---|
| `@cluadwong/form-designer/renderer` | `FormRenderer` / `GridFormRenderer` / `printForm` / `collectFieldValues` / Schema 类型 | 消费端：渲染、填写、打印 |
| `@cluadwong/form-designer/designer` | `FormDesigner` / `FormDesignerExposed` / `defaultDesignerUIConfig` / `buildBlankSchema` / `collectFormData` / `serializeSchemaJson` | 需要在应用内编排模板、并取 Schema JSON 与表单数据时 |

数据流：

```
设计器编排 → 导出 Schema JSON →（外部服务存储）→ 消费页引用 FormRenderer + schema + data → 渲染 / 填写 / 打印
```

Schema 只描述版式，不携带数据；数据（含字段权限、校验规则）在渲染时通过 props 注入。

## 导出 Schema 配置与表单数据

表单「新建 / 编辑」页通常需要从设计器取出两样东西存库：**Schema JSON**（版式）与
**表单数据** `{ 字段名: 值 }`，如 `{"单位":"运输队","编号":"A-001"}`。表单数据的取值口径与
渲染期**完全同源**（同一个 `collectFieldValues`），表单没有配置任何字段时就是 `{}`。

**① 组件 ref（页面里调用）** —— 给 `<FormDesigner>` 挂 `ref`，调用 `FormDesignerExposed`：

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { FormDesigner } from '@cluadwong/form-designer/designer'
import type { FormDesignerExposed } from '@cluadwong/form-designer/designer'
import '@cluadwong/form-designer/designer/style.css'

const designerRef = ref<FormDesignerExposed | null>(null)

// 保存
function buildPayload() {
  const schema = designerRef.value!.getSchema()          // FormSchemaV2 对象
  const data = designerRef.value!.getFormData()          // { 单位: "...", ... }，无字段则 {}
  return { schema: JSON.stringify(schema), value: data }
}

// 回填既有表单（接受对象或 JSON 文本）
function openExisting(text: string) {
  designerRef.value!.setSchema(text)
}
</script>

<template>
  <FormDesigner ref="designerRef" />
</template>
```

| API | 说明 |
|---|---|
| `getSchema()` | 当前 schema 的**深拷贝**（外部改动不回灌设计器）；需 JSON 文本时自行 `JSON.stringify` |
| `getFormData(opts?)` | 表单的**字段与值** `{ 字段名: 值 }`；无字段时为 `{}`；需 JSON 文本时自行 `JSON.stringify` |
| `setSchema(next)` | 载入 schema（对象或 JSON 文本），重置历史与选中 |
| `exportSchemaFile()` / `exportFillDataFile()` | 触发浏览器下载两个 JSON 文件（与工具栏按钮同一实现） |
| `print()` / `resetBlank()` | **局部打印**（只打纸张，不含页面其他区域）/ 重置为空白模板 |

工具栏可见性由 `uiConfig` 控制，**默认显示全部模块**，按需关闭：

```vue
<FormDesigner :ui-config="{ showFillDataModule: false, locale: 'en' }" />
```

**② 纯函数（服务端 / 脚本里也能算）** —— `@cluadwong/form-designer/designer` 同时导出：

```ts
import { collectFormData, serializeFormDataJson, serializeSchemaJson } from '@cluadwong/form-designer/designer'

const schemaJson = serializeSchemaJson(schema)   // 美化 JSON 文本
const data = collectFormData(canvasEl)           // { 单位: "...", ... }（无字段 → {}）
const json = serializeFormDataJson(data)         // 美化 JSON 文本
```

**表单数据的口径**（唯一真源 `collectFieldValues`，与消费页渲染采集同一实现）：

- 值取自渲染 DOM 的 `[data-field]`，因此含设计态 / 预览态就地输入的内容；没有任何字段元素时为 `{}`；
- 默认按**外发口径脱敏**（HIDDEN 字段出 `***`）；需要真实值传 `{ maskHidden: false, baseData }` 回源；
- 只读操作，不修改 schema、不落库。

**工具栏按钮**：模板组的**导出文件**、填充数据组的**导出数据**与上面两个 API 是同一实现，
点击时会把对应 JSON 一并 `console.log` 到控制台，联调时可直接从控制台抄走配置与数据。
「导出数据」「保存数据」**不限预览态**（设计态即可用）。

## 注意事项

- **vue 唯一实例**：`vue` 是 peerDependency，消费方必须 `resolve.dedupe: ['vue']`，否则会打进第二份 Vue，响应式 / provide-inject / 组件解析全断。
- **样式别引错**：样式按入口分离（`renderer/style.css` / `designer/style.css`），只用渲染端就不要引 designer 样式，避免污染全局。
- **Schema 不含数据**：字段权限、校验规则与数据同轨在渲染时注入，不进 Schema，存储态 schema 可放心复用。
- **tsconfig 的模块解析方式影响子路径类型**：`@cluadwong/form-designer/designer` 与 `@cluadwong/form-designer/renderer` 的运行时由 `exports`
  解析，但 **`tsconfig` 若为 `moduleResolution: "node"`（node10，老项目常见）会忽略 `exports`** ——
  此时靠 `package.json` 的 `typesVersions` 回落到 `dist/*.d.ts`。两者都已配好；新项目用
  `bundler` / `node16` 走 `exports`。**别删 `typesVersions`**，否则老项目 TypeScript 会报
  `Cannot find module '@cluadwong/form-designer/designer'`（Vite 运行时仍正常，只有类型报错，很容易被误判）。
- `FormRenderer` 的 `options` 支持 `bare / zoom / fitOnMount / readonly` 等渲染形态，详见 [docs/engine.md](./docs/engine.md)。

## 架构与目录

```
src/
├── types/                # Schema V2 类型定义、序列化、校验、结构操作
├── engine-v2/            # 渲染期领域逻辑：分页引擎、派生计算、节点地址
├── components/
│   ├── renderer-v2/      # 渲染内核：GridFormRenderer / FormRenderer / GridSchemaNode / HtmlBlock / PaperViewport
│   └── designer/         # 设计器：FormDesigner 编排层 + CanvasSurface 表面层 + composables + inspectors
├── preview/              # 预览/填写演示页
├── dev/                  # 示例数据与测试夹具（被测试与演示页引用）
├── utils/ styles/ samples/ test-utils/
docs/                     # 设计契约文档（索引见 docs/README.md）
```

**分层约定**：渲染内核不认识"选中/拖拽/落点"，这些交互设计态相关的内容一律在表面层 `CanvasSurface.vue` 完成；
设计器与消费页都通过 `FormRenderer` 渲染，内核保持可独立消费。

## 本地开发

```bash
npm install
npm run dev        # 启动本地设计器（默认 http://localhost:5173）
npm test           # vitest run
npm run build      # vue-tsc --noEmit && vite build
```

构建库产物（`dist/`，供发布与联调用）：

```bash
npm run build:lib   # vite build --config vite.lib.config.ts --emptyOutDir（会清 dist）
npm run build:types # 生成 .d.ts（必须排在 build:lib 之后）
npm run dev:lib     # build:types + vite build --watch（不清 dist）
npm run pack:check  # build:lib + build:types + npm pack --dry-run
```

演示页：`preview.html`（最简消费页演示：schema → 渲染，验证渲染内核可脱离设计器独立运行）。

改 `vite.lib.config.ts` 前先看文件顶部注释，四条硬约束：

- `vue` 与三个运行时依赖必须保持 external，否则会打出第二份 Vue。
- **`emptyOutDir: false` 是刻意的**：`.d.ts` 与 JS 写在同一个 `dist`，而 watch 模式每轮重构建都会清目录；
  一次性清理由 `build:lib` 显式传 `--emptyOutDir` 承担。别把配置改回 `true`，一行 CLI 挡不住重构建。
- 样式归属由构建期守卫兜底：`RENDERER_REQUIRED` / `DESIGNER_REQUIRED` 清单里的选择器必须分别出现在
  `renderer-core.css` 与合并后的 `designer-ui.css`，缺任何一个都直接构建失败。
- 改了构建配置后，正在跑的 watch 进程必须重启（Vite 只在进程启动时读一次配置）。

**`npm link` 只链目录，不会让 `src/` 直接生效**：`exports` 全部指向 `dist/`，改完源码要重新构建
（用 `npm run dev:lib` 持续重出）。**别只重建一半**：SFC 的 `<style scoped>` 会编译成 `.v2-xxx[data-v-哈希]`，
JS 与 CSS 若不是同一次构建的产物，哈希对不上，scoped 样式会整片静默失效。

### 验证基线

- `npx vitest run`：**403 passed（49 文件）**
- `npx vue-tsc --noEmit`：无错误

## 文档

| 文档 | 内容 |
|---|---|
| [docs/README.md](./docs/README.md) | 文档索引 |
| [docs/design.md](./docs/design.md) | Schema 结构与节点模型设计契约 |
| [docs/design-biz.md](./docs/design-biz.md) | 业务与交互设计 |
| [docs/engine.md](./docs/engine.md) | 渲染引擎契约（索引/校验/渲染/尺寸/边框/打印） |
| [docs/user-guide.md](./docs/user-guide.md) | 用户操作指南（与应用内「帮助」同源） |

## License

[MIT](./LICENSE)
