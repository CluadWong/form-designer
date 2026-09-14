# @aikkk/ticket-designer

> 固定布局表单设计器：可视化编排版式 → 导出 Schema JSON → 由渲染组件消费并填充/打印。

[![npm version](https://img.shields.io/npm/v/@aikkk/ticket-designer)](https://www.npmjs.com/package/@aikkk/ticket-designer)
[![license](https://img.shields.io/npm/l/@aikkk/ticket-designer)](./LICENSE)

技术栈 Vue 3.5 + TypeScript + Vite + Vitest，无后端依赖。

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
npm i @aikkk/ticket-designer
# 或
pnpm add @aikkk/ticket-designer
```

`vue` 是 peerDependency（`^3.5.0`），宿主需自备；同仓多实例时务必 `resolve.dedupe: ['vue']`（见下方注意事项）。

## 快速开始

消费端（渲染 / 填写 / 打印）只需 `renderer` 入口，最小示例：

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { FormRenderer, printForm } from '@aikkk/ticket-designer/renderer'
import type { FormSchemaV2, FormDataV2 } from '@aikkk/ticket-designer/renderer'
// 样式按入口分离，引入 renderer 对应的样式
import '@aikkk/ticket-designer/renderer/style.css'

// 设计器导出的 Schema JSON（服务端存储后下发）
const schema = ref<FormSchemaV2>(/* ... */)
const data = ref<FormDataV2>({})
</script>

<template>
  <FormRenderer :schema="schema" v-model:data="data" />
  <button @click="printForm()">打印</button>
</template>
```

需要在宿主内编排模板时，改用 `designer` 入口：

```ts
import { FormDesigner, buildBlankSchema } from '@aikkk/ticket-designer/designer'
import '@aikkk/ticket-designer/designer/style.css'
```

## 用法

两个按需入口，按消费场景选择：

| 入口 | 内容 | 谁用 |
|---|---|---|
| `@aikkk/ticket-designer/renderer` | `FormRenderer` / `GridFormRenderer` / `printForm` / `collectFieldValues` / Schema 类型 | 消费端：渲染、填写、打印 |
| `@aikkk/ticket-designer/designer` | `FormDesigner` / `defaultDesignerUIConfig` / `buildBlankSchema` | 需要在宿主内编排模板时 |

数据流：

```
设计器编排 → 导出 Schema JSON →（外部服务存储）→ 消费页引用 FormRenderer + schema + data → 渲染 / 填写 / 打印
```

Schema 只描述版式，不携带数据；数据（含字段权限、校验规则）在渲染时通过 props 注入。

## 注意事项

- **vue 唯一实例**：`vue` 是 peerDependency，宿主必须 `resolve.dedupe: ['vue']`，否则会打进第二份 Vue，响应式 / provide-inject / 组件解析全断。
- **样式别引错**：样式按入口分离（`renderer/style.css` / `designer/style.css`），只引 renderer 的宿主不要引 designer 样式，避免污染全局。
- **Schema 不含数据**：字段权限、校验规则与数据同轨在渲染时注入，不进 Schema，存储态 schema 可放心复用。
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

## 文档

| 文档 | 内容 |
|---|---|
| [docs/README.md](./docs/README.md) | 文档索引 |
| [docs/design.md](./docs/design.md) | Schema 结构与节点模型设计契约 |
| [docs/design-biz.md](./docs/design-biz.md) | 业务与交互设计 |
| [docs/engine.md](./docs/engine.md) | 渲染引擎契约（索引/校验/渲染/尺寸/边框/打印） |
| [docs/user-guide.md](./docs/user-guide.md) | 用户操作指南（与应用内「帮助」同源） |

## 本地开发

```bash
npm install
npm run dev        # 启动设计器（默认 http://localhost:5173）
npm test           # vitest run
npm run build      # vue-tsc --noEmit && vite build
npm run preview    # 预览构建产物
```

演示页：`preview.html`（最简消费页演示：schema → 渲染，验证渲染内核可脱离设计器独立运行）。

### 验证基线

- `npx vitest run`：**365 passed（46 文件）**
- `npx vue-tsc --noEmit`：无错误

### 分支

- `release`：对外发布分支，发布到公共 npmjs（`@aikkk/ticket-designer`），只保留源码、测试与对外文档。一键发布脚本 `npm run release` 在此分支运行。
- `main`：GitHub 默认分支，**已设分支保护（Require a pull request before merging），禁止直推**。`release` 发布后由脚本自动开 PR(`release → main`) 并请求自动合并；无 `gh` CLI 时打印手动建 PR 链接。
- `dev`：内部开发分支（源码同样托管在 GitHub）。`npm run promote` 后再执行 `npm run release` 完成发版。

## License

[MIT](./LICENSE)
