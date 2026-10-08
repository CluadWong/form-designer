# 嵌套 Grid Schema V2 渲染引擎设计

> 本文定义唯一正式 Schema V2 的索引、校验、递归渲染、尺寸、溢出和打印契约。
>
> 本文为渲染引擎契约（spec）；实现状态见 [README.md](../README.md)。
> 文档总索引见 [README.md](./README.md)。

## 1. 引擎职责

V2 引擎负责：

- 校验嵌套 Schema 的结构和尺寸。
- 建立设计器需要的运行时节点索引。
- 递归渲染 Page、Grid、P、Table、HTML 和 Image。
- 按 mm 和基础行高计算固定版式。
- 检测格子、组件和纸张溢出。
- 让设计态、填写态和打印态共享 DOM 结构。

引擎不负责流程数据持久化、权限决策和设计器拖拽策略。

## 2. 输入和输出

```ts
interface RenderInput {
  schema: FormSchemaV2
  mode: 'designer' | 'preview' | 'print'
  data?: Record<string, unknown>
  rules?: RulesMap
}

interface RenderResult {
  pages: RenderedPage[]
  issues: SchemaIssue[]
  nodeIndex: EditorNodeIndex
}

interface SchemaIssue {
  level: 'error' | 'warning'
  code: string
  nodeId?: string
  path?: Array<string | number>
  message: string
}
```

存在结构 error 时设计器仍可显示错误面板，但预览和打印应被阻止，避免输出不确定版式。

## 3. 运行时索引

嵌套 Schema 是唯一渲染输入。索引由遍历函数派生：

```ts
interface EditorNodeRef {
  node: SchemaNode
  parent: SchemaNode | null
  path: Array<string | number>
  ownerCell?: GridCell | TableCellTemplate
}

function buildNodeIndex(schema: FormSchemaV2): Map<string, EditorNodeRef>
```

内部索引遍历范围包括：

- Page、Grid 和 P/Table/HTML/Image 等实际组件
- GridRow、GridCell、TableCellTemplate 仅作为内部布局记录参与路径解析
- 所有 children 后代

索引要求：

- ID 唯一。
- path 可以直接定位到原 Schema 节点。
- parent 是实际拥有该记录或组件的 Page/Grid/Row/Cell/Table。
- 对外的选择链只暴露 Page、Grid 和实际组件，不暴露 Row/Cell/Template。
- Schema 结构变化后索引必须更新，禁止保存旧对象引用。

## 4. Schema 校验

### 4.1 结构错误

- DUPLICATE_ID：任意节点 ID 重复。
- EMPTY_PAGE：Page 没有内容。
- INVALID_CHILD_TYPE：节点出现在不允许的 children 中。
- INVALID_ROW：GridRow 没有 Cell 或 height 非法。
- INVALID_CELL_WIDTH：宽度不是正数、fr 或 auto。
- INVALID_COLSPAN：colspan 超出当前行可用列。
- INVALID_TABLE_COLUMN：列 key 重复或宽度非法。
- INVALID_TABLE_TEMPLATE：rowTemplate 缺少列或引用未知 columnKey。
- INVALID_DIMENSION：基础行高、行高、边距或图片尺寸非法。
- INVALID_P_MODE：static 缺 text，field 缺 field，或属性组合冲突。

### 4.2 警告

- DUPLICATE_FIELD：字段名重复。
- EMPTY_FIELD：field P 未配置 field。
- UNUSED_PROPERTY：当前 mode 下存在无效属性。
- CONTENT_OVERFLOW：内容超过固定节点尺寸。
- PAPER_OVERFLOW：Page 内容超过可用纸张。
- IMAGE_LOAD_FAILED：图片资源加载失败。

### 4.3 校验时机

- 加载 Schema 后。
- 每次结构操作后。
- 保存前。
- 打开预览前。
- 打印前。

属性输入时可以 debounce 校验；结构操作必须同步校验并返回明确失败原因。

## 5. 递归渲染

```ts
function renderNode(node: FormNode, context: RenderContext): VNode {
  switch (node.type) {
    case 'grid': return renderGrid(node, context)
    case 'p': return renderP(node, context)
    case 'table': return renderTable(node, context)
    case 'html': return renderHtml(node, context)
    case 'image': return renderImage(node, context)
  }
}
```

Page Renderer 遍历 page.children；Grid Renderer 遍历 rows/cells；Cell Renderer 遍历 children。

设计态为所有节点添加 `data-node-id` 和必要的辅助包装。预览/打印可以隐藏辅助样式，但不能生成不同业务层级。

## 6. Grid 渲染

每个 GridRow 使用 CSS Grid：

```ts
const tracks = row.cells.map(cell => toCssTrack(cell.width ?? '1fr'))

rowStyle = {
  display: 'grid',
  gridTemplateColumns: tracks.join(' '),
  minHeight: `${row.height * baseRowHeight}mm`
}
```

如果存在 colspan，Renderer 根据逻辑 cell 顺序生成 `grid-column: span N`，并在校验阶段确保总占用列数合法。

Cell：

```ts
cellStyle = {
  padding: `${cell.padding ?? 0}mm`,
  alignItems: toAlignItems(cell.verticalAlign),
  justifyContent: toJustifyContent(cell.align),
  overflow: 'hidden',
  boxSizing: 'border-box'
}
```

Cell.children 按数组顺序渲染。多个子节点默认纵向流；需要横向排列时使用子 Grid，不增加隐式 flex 规则。

注：渲染层已支持 mm/fr/auto 列宽（`track()` 已实现 number→`${n}mm`、`fr`、`auto` 转换）；设计器侧列宽编辑尚未暴露给用户（见根 README.md）。

## 7. 固定尺寸

### 7.1 纸张

| 纸张 | 竖向 | 横向 |
|---|---|---|
| A4 | 210×297mm | 297×210mm |
| A3 | 297×420mm | 420×297mm |

```text
contentWidth  = paperWidth  - margin.left - margin.right
contentHeight = paperHeight - margin.top  - margin.bottom
```

### 7.2 Grid 与 Table

```text
GridRowHeight     = baseRowHeight × row.height
TableHeaderHeight = baseRowHeight × table.headerHeight
TableDataHeight   = baseRowHeight × table.rowHeight
EmptyTableHeight  = headerHeight + minRows × dataHeight
```

行高必须输出 CSS `min-height`，并统一 `box-sizing: border-box`。当 `minRows` 增加时，Table 内容允许撑开父 GridRow；禁止用 flex-grow 把纸张剩余高度分配给 Table 行。

### 7.3 字体和边框

- 字号和行高写入 Schema 或设计系统默认值。
- letter-spacing 固定为 0。
- 边框宽度纳入 border-box。
- Web 字体未加载完成前不进行最终溢出测量。
- 打印态不得改变字号、行高、padding 和边框宽度。

## 8. 边框算法

Grid 根据 border 配置决定外框和内部线：

- all：Grid 外框 + Row/Cell 内部边界。
- outer：仅外框。
- inner：仅内部边界。
- none：无边框。

同一条边只由一个层级负责。建议：

- 根表单 Grid 使用 all。
- 负责人等混排行使用 none，由父 Grid 的行边界包围。
- 工作任务子 Grid 使用 inner，外框由父 Cell 承担。
- Table 绘制内部表头和行列线，外边界由所属 Cell 或 Table 自己按配置负责，二者不能重复。

浏览器验收必须检查 1px 边框是否出现 2px 重叠。

## 9. P 渲染

容器**必须是 `<div class="layout-p">`，不能是 `<p>`**（2026-09-11）：`innerBorder` 会在容器内
插入 `<div class="layout-p__line">`，而 `<p>` 的内容模型只允许 phrasing content，HTML 解析器
遇到 `<div>` 会强制闭合 `<p>`——局部打印正是走「序列化 → 重新解析」，结构会被拆坏。详见 §19 末条。
schema 层的节点类型名仍沿用历史命名 `"p"`，与 DOM 标签无关。

### static

```html
<div class="layout-p" data-node-id="label-unit">单位</div>
```

### field

设计态：

```html
<div class="layout-p" data-node-id="field-unit" data-field="单位"></div>
```

填写态：

```html
<div class="layout-p" contenteditable data-node-id="field-unit" data-field="单位"></div>
```

输入后更新外部 data。固定页面默认不因输入自动改变行高；内容超出时标记溢出。

#### 图片值 / 多人签名（`valueType: "image"`，2026-09-30 支持多张）

`data[field]` 为图片地址（单值字符串，或**数组**表多张）。渲染分两种形态，
**按张数择一，不做合并**——目的是让「单张 / 空态」的 DOM 与改动前**逐字节一致**：

| 张数 | DOM |
|---|---|
| 1 | `<img class="layout-p__sign" src=…>`（与改动前完全相同的裸 `<img>`） |
| ≥2 | 一层包裹 `<span class="layout-p__signs">` 内 `v-for` 出 N 个 `img.layout-p__sign` |
| 0 | 不渲染图片，容器靠 `min-height` 占住 `imageHeight` |

**为什么要按张数分叉，而不是统一用 `<template v-for>`**：`<template v-if>` / `v-for` 会各自
引入 2 个注释锚点（`<!--v-if-->`），单值场景的子节点数从 `1` 变 `3`，直接打爆
`YunlvSecondTicketFull.test.ts` 的结构基线。分叉后代价收敛为「N ≥ 2 时多 1 个 `<span>`」，
单张 / 空态零新增节点。包裹层用 `.layout-p__signs` 而非复用 `.layout-p__signbox`，
避免改动既有单图布局（`.layout-p__signbox` 保持原样）。

包裹层样式要点（`GridSchemaNode.vue`）：`display:flex; flex:1 1 auto; flex-wrap:wrap;
align-items:flex-end; align-content:flex-end; min-width:0`——`flex:1 1 auto` + `min-width:0`
是**换行真正生效的前提**：缺了它，flex 子项按 `max-content` 撑开，只会整体溢出而不折行。
内层 `img` 置 `flex: 0 0 auto`（不参与伸缩，宽度只由自身比例定）。

高度估算（`src/engine-v2/pagination.ts` 的 `case "p"`，与渲染层同源）：
`rows = max(1, 实际张数)`，`height = max(baseRowHeight, rows × 图高 + (rows−1) × 间距)`。
即**每张独占一行**的保守上界——换行位置依赖图宽、设计期不可知，故只保证「不低估」。
`gap` / `imageHeight` 的默认值（`0.5em` / `1.6em`）与渲染层共用
`derivation.ts` 的 `SIGN_IMAGE_GAP_EM` / `SIGN_IMAGE_LINE_HEIGHT_EM` 单一真源。
张数取值与渲染层同一兜底（`data` 无该键 / 为 `null` 时回落节点 `default`，再按 `maxCount` 截断），
由 `resolveSignImageUrlsV2` 统一实现，避免「带默认值的签名栏」出现渲染 / 分页两套口径。

> **已知边界**：容器是 `border-box` 且带 1px 下划线边框，估高**未含这 1px**（约 0.26mm）。
> 这是改动前既有口径（单图亦然），不是本次引入；Grid 内的行由渲染层 `measureRow`
> 实测真实高度二次校正，不依赖此处估算，本分支只覆盖 Grid 外的裸 `p` 节点。

### 额外属性（params）

任何节点（`SchemaNodeBaseV2`）都可带 `params?: Record<string, string>`——设计器里的「额外属性」键值对，
渲染时**原样插到该节点根元素的 HTML 属性**上（页面节点即纸张 `<main>`）：

```html
<div class="layout-p" data-node-id="field-plan-start" data-field="计划工作时间_开始" action="datePicker" date-validate="after:计划工作时间_1"></div>
```

- 内核**不解释任何键**——`action="datePicker"`、`date-validate="..."` 的语义完全归宿主；宿主在填写态自行扫描属性、接管交互（如点击、跨字段校验）。这是「内核只做表单设计、不碰业务」的落点。
- 渲染前统一过黑名单（`src/utils/node-params.ts`）：丢弃 `on*`（事件）、`data-*`（内核寻址）、保留名（`class`/`style`/`id`/`field`/`src`/`contenteditable`…），以及不匹配 `/^[a-z][a-z0-9_-]*$/` 的名字（含大写驼峰，如 `innerHTML`）；空串值不写属性。**这层过滤是必需的**——直接 `v-bind` 原始对象会把 `on*` 键绑成事件监听器，等于开一条脚本注入通道。

**点击触发权归属（2026-09-30 起调整）**：内核**不再**为字段绑定点击、不再 emit `field-activate`（历史上以 1 bit 持有、后于 2026-09-30 移除）。宿主基于字段标签上的 `data-field` + `params` 属性自行决定是否点击、如何响应（如识别 `action="signature"` 时弹签名框）。`params` 是宿主识别交互的唯一线索——这是「内核零业务、宿主全权委托」契约的延伸。

旧数据的 `action` / `actionParams` 在读入时迁移为 `params`（`src/types/schema-v2-serialization.ts` 的 `migrateLegacyFieldActivation`），输入中可能残留的 `interactive` 一并丢弃，导出只写新形态（`params`）。迁移**顺带把作废的旧词表翻成宿主词表**，存量模板无需宿主改代码即可直接消费：

| 旧 `action` | 迁移后 `params.action` | 说明 |
|---|---|---|
| `date` | `datePicker` | 日期/时间选择器 |
| `upload` | `uploadImg` | 图片上传 |
| `signature` | `uploadImg` | 签名扫件复用图片上传通道（宿主无独立签名分支） |
| `text` / 未配置 | （不写） | 旧内核在 `text` 下本就不触发，故不写 `params.action` |
| 其它 | 原样保留 | 不猜宿主词表，交给宿主自行处理 |

键名同样对齐宿主：旧 `actionParams.format` → `params["date-format"]`（宿主 `useFcDesigner.resolveDateFormat` 读的就是标签属性 `date-format`）；未登记的键原样搬入。已是新格式的 `params` 优先，不会被旧值覆盖。

> 这层词表翻译**只在读入旧数据时发生一次**，是给存量模板的过渡带；运行期内核仍不持有控件类型词表。

## 10. Table 渲染

渲染顺序：

1. 根据 columns 生成表头。
2. 计算数据行数量。
3. 对每行克隆 rowTemplate，输出语义化 `tbody > tr > td`。
4. 根据 columnKey 渲染每个 TableCellTemplate.children；新建 Table 默认每个模板包含一个 Field P。
5. 用户删除默认 P 后，模板 children 可以为空或替换为 Grid、HTML 等其他组件。
6. 为 rowTemplate 内 field 提供当前行上下文。

数据行数量：

```ts
// 动态行数由 data 推导，不是 schema 属性（见 src/types/schema-v2-table-rows.ts）
const rowCount = resolveTableRowCount(table, data) // = Math.max(minRows, data 中实际出现的最大行号)
```

重复行字段不能简单生成相同 DOM ID。VNode/DOM 标识应组合 template node ID 和 row key；模板 Schema ID 保持不变。

## 11. HTML 安全与隔离

HTML 组件定位：仅用于复杂小模块，由开发人员配置一段 HTML + CSS，**不涉及 JS**。

**渲染与隔离流程**：

1. 渲染时 `host.attachShadow({ mode: 'open' })`，将 `<style>${css}</style>${html}` 一次性写入 shadow root。CSS 仅作用本块、不污染表单样式（不采用选择器前缀化方案）。
2. 写入前用 **DOMPurify** 做引擎级固定清洗：`FORBID_TAGS` 含 `script/iframe/object/embed`，`FORBID_ATTR` 含全部 `on*`，并剥离 `href/src/xlink:href` 中的 `javascript:` 与 `data:text/html`；v1 禁 `@import`。**清洗始终执行，无 per-node 信任开关。**
3. 字段绑定两条约定（P9.2d 方案 A）：`{{field}}` 在挂载时替换为绑定元素——设计态（`data == null`）为占位 `<span data-bind="field">`（设计器靠它选中片段），非设计态**一律 `<input data-bind="field">`**（不可写时加 `readonly`，**值仍进 DOM**）；作者直接写的原生 `<p contenteditable data-field="field">` 由 `applyFieldState` 按同一闸门设可编辑性与回填。填值/回填均原位更新（in-place），不重建节点；输入中（该元素是 shadow 内 `activeElement`）跳过回填，避免把光标顶走。
4. **可编辑性只有一道闸门**：`readonly` 为真 ⇒ 全字段降级为「只读回显」（语义等价全字段 READ：值进 DOM、可采集，但改不动），**不是**设计态；设计态由 `data == null` 单独承载（可就地输入看交互、不回写 schema，与 P 字段 `canFill || isDesign` 同口径）。`readonly` 参与 HtmlBlock 的重建依赖——漏掉它会出现「只读切到填写态后仍然打不了字」（输入事件没绑上）。
5. 放入限制 overflow 的 Cell 容器，由 §12 做溢出检测。
6. **打印时提升 Shadow DOM**：局部打印取内容靠克隆 + 序列化，而克隆**不带走 shadow tree**（DOM 规范行为），
   故送印前把 shadow 里的非 `<style>` 子节点临时移到 host 上、打完移回，并把控件实时值固化进 attribute。
   详见 §19 与 `print-form.ts` 头部注释。

HTML 内部 DOM 不参与普通节点索引；其内字段值**只在失焦时经 `field-change` 交还宿主一次**（不逐键回写，
见 §21.1），并可按 §20 的两条路径采集。

**Image**：`src` 同时接收 URL 与 base64（`data:image/...;base64,...`）；field 模式填值时 `imgEl.src = data[field] ?? src`，URL/base64 原样透传；保留 onerror 占位（见 §4.2 `IMAGE_LOAD_FAILED`）。

## 12. 溢出检测

固定节点渲染稳定后测量：

```ts
const horizontalOverflow = element.scrollWidth > element.clientWidth + tolerance
const verticalOverflow = element.scrollHeight > element.clientHeight + tolerance
```

容差建议 1px，避免小数像素舍入误报。

检测层级：

- P 内容溢出。
- Image 超出 Cell。
- HTML 超出 Cell。
- Table 高度与所属行不匹配。
- GridRow 子内容超过最小高度后的实际扩展。
- Page 根内容超出 contentHeight。

设计态显示节点定位警告；预览可继续查看；打印前由业务决定是否阻止。

## 13. 页面模式

### fixed

- Page 对应真实纸张。
- 不运行自动块分页。
- 多页由 pages[] 显式定义。
- PAPER_OVERFLOW 不自动移动节点。
- 适用于工作票、证书和审批单。

### flow

- 后续用于动态报表。
- 根级 Grid 作为不可拆分块。
- Table（动态行数由 data 推导）可按完整行切分并重复表头。
- flow 不属于前五行设计器闭环的前置条件。

## 14. 设计器结构操作

操作嵌套 Schema 的函数必须集中实现：

```ts
insertRow(schema, gridId, at, row)
removeRow(schema, rowId)
moveRow(schema, rowId, targetIndex)
splitCell(schema, cellId, tracks)
mergeCells(schema, rowId, cellIds)
insertNode(schema, targetCellId, at, node)
moveNode(schema, nodeId, targetCellId, at)
removeNode(schema, nodeId)
wrapCellChildrenWithGrid(schema, cellId, config)
updateNode(schema, nodeId, patch)
```

每个函数返回新 Schema、更新后的节点索引和结构 patch。禁止组件内部直接寻找路径并修改原对象。

## 15. 撤销与重做

历史记录保存结构化 patch 或 Schema 快照：

- 属性输入按 debounce 合并为一次历史记录。
- 拖拽、拆分、合并和删除各是一条原子记录。
- 复制和删除必须包含完整子树。
- 撤销后重建节点索引并重新校验。

原型阶段可先使用不可变 Schema 快照，确认性能问题后再切换 patch。

## 16. 测试基线

### 结构

- 所有节点 ID 唯一。
- ID 索引能定位 node、parent 和 path。
- 移动节点后原位置删除、目标顺序正确。
- 删除/复制容器正确处理完整子树。
- 保存再加载的 Schema 深度等价。

### 尺寸

- baseRowHeight=8 时普通行精确为 8mm。
- 工作任务外层行精确为 40mm。
- 表头和 4 行数据各为 8mm。
- 内容过长或 Table 增加 `minRows` 时允许撑高所属 GridRow，并报告对应节点的尺寸变化。
- 嵌套 Grid 不产生双边框。

### UI 闭环

- 从空白页通过 UI 构建前五行。
- 保存、加载后节点仍可编辑。
- 填入数据后字段正确。
- A4 打印截图结构正确。

## 17. 旧代码清理

`src/engine/paginate.ts`、`FormRenderer` 与 `FormSchema.body[]` 等迁移前遗留实现已在 P0 阶段移除。**2026-09-02 十八续：旧 v1 引擎目录 `src/engine/`（DOM 测量版，含其 `__tests__`）已整体删除**，此前为绕开其旧 Schema 类型而加的 `tsconfig.json` / `vitest.config.ts` `exclude` 也已撤销——分页实现自此只有一套：`src/engine-v2/pagination.ts`（确定性、DOM 无关）。剩余清理工作（旧类型残留等）归入 [README.md](../README.md) P12。清理目标仍是避免出现两套 Schema、分页和设计器状态。

## 18. 节点地址契约（C2 / A5 分层重构）

渲染内核与「设计表面层」之间的唯一可接受边界是**稳定的节点地址**。内核只负责暴露地址，表面层（拖拽源/落点、选中高亮、节点命中）据此反查，**不**反向依赖内核内部状态。

### 输出属性（由 renderer-v2 输出）

| 属性 | 挂在哪些节点 | 用途 |
|---|---|---|
| `data-node-id` | page / grid / cell / p / text / table / html / image | 节点唯一 id，设计态选中与拖拽源命中（`closest("[data-node-id]")`）。row **不**挂（行是 Grid 内部布局，不可独立选中）。 |
| `data-layout-id` | Grid 的 row / cell、Table 单元格模板 | 拖拽落点判定——`closest("[data-layout-id]")` 命中目标格 / 行。 |

### 消费方约定

- 选择器常量与辅助函数集中在 `src/engine-v2/node-address.ts`（`NODE_ID_ATTR` / `LAYOUT_ID_ATTR` / `nodeIdSelector` / `layoutIdSelector`），消费侧应引用它们，避免多处硬编码属性名字符串而静默失效。
- 地址属性是**契约而非实现细节**：改名须同步内核输出与表面层消费两侧，并回归 FormDesigner 拖拽/选中测试。
- 选中高亮（`.is-design-selected`）由表面层 `designer/CanvasSurface.vue` 在渲染 DOM 上直接加/去类实现（A5），内核不再持有 `selectedNodeId`、不再输出 `.layout-node--selected`。

## 19. 打印实现契约（2026-09-11 改为**局部打印**）

**触发**：`printForm({ root })`（`src/components/renderer-v2/print-form.ts`），实现 = `vue-print-next`。
无参调用自动取页面里第一个 `.grid-form-canvas`；组件侧 `FormRenderer.print()` 与设计器工具栏「打印」
各自传**自己的**渲染根，多实例互不干扰。

**只打纸张**：交给插件的是本次实例的 `.grid-form-paper`（用实例级 `data-v2-print-scope` 圈定，
避免裸选择器把同页多个渲染实例串起来）。纸张上的 `width/height: Nmm` 是内联样式，随序列化保留；
内核 `@media print` 的 `break-after: page` 决定每张纸出一页。**宿主页面其余部分不进打印流**，
不再依赖 `@media print` 去逐条隐藏菜单 / 工具栏 / 其他区域。

**`@page` 唯一真源仍是 `page-size-style.ts`**：**禁止**给插件传 `paperSize` / `orientation` / `customSize`。
它拿到任一个就会自己再写一条 `@page`，且排在 head 里所有 `<style>` 之后（后写胜出），
直接盖掉跟随 `schema.paper` 注入的尺寸（A3 会被打回 A4）。

**纸张高度留安全余量 + 打印文档 `body` 边距归零（2026-09-17，修「打印多出空白尾页」）**：
- 分页态纸张 `height` 取「整纸高 − 0.5mm」（`PRINT_PAPER_HEIGHT_EPSILON_MM`，`GridFormRenderer.paperStyle`）。
  `@page { size: Wmm Hmm; margin: 0 }` 的页面内容区恰为整纸高，而 `297mm` 换算成 px 非整数（1122.52），
  纸张 `height == 页高` 时会因取整溢出一缕到下一页 → 空白尾页（新建空白页也复现；实测把 `height` 调至
  略小于 297mm 即消失）。余量大于任何取整误差、又远小于页底边距，只吃掉页底一点白边，
  **不影响正文、不改分页页数**；设计态 `min-height` 分支不加余量（保持与整纸高一致便于对位）。
- `page-size-style.ts` 注入的打印样式除 `@page {...; margin: 0}` 外，另加
  `@media print { html, body { margin: 0 !important; padding: 0 !important } }`。插件会把主文档所有 `<style>`
  复制进打印 iframe，但 iframe 的 `html/body` 仍带 UA 默认 `margin`（约 8px），会把纸张整体下推，底部溢出
  同样产生空白尾页、并横向裁掉约 3mm。两条叠加可稳妥消除空白尾页（A3 / A4 通用）。

**Shadow DOM 与控件值**：见 §11 第 6 条——HTML 模块的 shadow 内容与 `input` / `textarea` 实时值
都在送印前临时固化，打完还原。P 字段不受影响（contenteditable，值本就在文本节点里）。

**`@media print` 定位降级为兜底**：各组（工具栏 / 侧栏 / 状态栏 / 帮助面板 / 画布 / 纸张 / 视口）
的 `@media print` 规则保留——主路径已由 iframe 隔离承担，但这些样式仍会被一并复制进打印文档，
保留不影响结果，且是插件行为变化时的缓冲。

**字段容器必须能容纳块级子元素（不得用 `<p>`）**：局部打印是**序列化成 HTML 字符串**再
`document.write` 进 iframe，浏览器会**重新解析**这段 HTML。字段容器因此**不得用 `<p>`**——
`<p>` 的 HTML 内容模型只允许 phrasing content，而 `innerBorder` 的逐行渲染插入的是
`<div class="layout-p__line">`，解析器遇 `<div>` 会强制闭合 `<p>`，把逐行 div 与后标签推出容器，
表现为「屏幕一行、打印时前后标签各占一行」。这是 2026-09-11 的实际故障。
推论：任何「主文档靠 DOM API 侥幸成立、序列化后会变」的结构都不可接受——导出 HTML / SSR /
复制粘贴走的是同一条路。守卫：`renderer-v2/__tests__/FieldContainerHtmlRoundTrip.test.ts`。

## 20. HTML 模块的字段与取值契约（2026-09-23）

HTML 模块把字段名写在片段里（`data-field="x"` 或 `{{x}}`），既不是 P 节点、也不参与表格派生 ——
**三处口径必须同源**，任一处漏掉都会静默丢字段（页面能填，但权限 / 必填 / 保存里找不到它）：

| 环节 | 实现 | 口径 |
|---|---|---|
| 渲染 | `HtmlBlock.vue` | `{{field}}` → `<input data-bind>`（设计态为占位 span）；原生 `data-field` → 就地设 `contenteditable` 与回填 |
| 字段清单 | `collectSchemaFields`（`engine-v2/derivation.ts`） | 收片段内 `data-field` / `{{field}}`，记为 `kind: "html-field"`（提取器 `collectHtmlFields`） |
| 取值 | `collectFieldValues`（`renderer-v2/collectFieldValues.ts`） | 穿透 `shadowRoot` 采集 `[data-bind]`（input 值）/ `[data-field]`（文本） |

- HTML 内字段名由作者写死，**不参与**表格的 `列key_行号` 派生（即便该 HTML 节点位于表格模板内，多行渲染也不改名）。
- 字段名正则两侧必须一致：`/\{\{\s*([\p{L}\p{N}_.$-]+)\s*\}\}/gu` —— 中文等 CJK 字段名靠 `\p{L}` + `u` 标志，`[\w]` 不含中文。
- `collectSchemaFields` 结果按 key 同名去重（保留首次）：同一 P 字段被复制、表格模板内多个 P 共用一列、
  HTML 片段在表格多行重复渲染都会产生重名，字段清单是集合而非出现次数列表。
- **两条取数路径**（宿主按需选）：`FormRenderer.getFormData()` 返回响应式数据（只含被改动过的键，适合「只存用户填了什么」）；
  `collectFieldValues(root)` 遍历渲染 DOM（含全部绑定键，未填为空串，适合「导出完整表单」）。
- **只读回显不留空白**：`readonly` 态下值照常写进 DOM（`<input readonly>` / 文本节点），故查阅模式能看到值、
  也能被采集（保存 → 查阅 → 复制成新单不丢值）；用户改不动。
- **权限切换必须撤销脱敏标记**（2026-09-24）：原生 `data-field` 元素的 `data-masked` 是 `applyFieldState`
  **事后**写上的、不在 markup 串里，故 `HIDDEN → EDIT/READ` 时片段走「未重建」分支。若只设不撤，
  `collectFieldValues` 会继续把该字段当脱敏处理（**不读 DOM**）⇒ 票面值显示正常、保存/采集却是空的。
  故非 HIDDEN 分支必须先 `removeAttribute("data-masked")`。`{{field}}` 形式不受此影响
  （HIDDEN 与非 HIDDEN 的 markup 不同 ⇒ 必然重建）。
- 守卫：`HtmlBlockField.test.ts`（只读回显 / readonly 切换 / 焦点保护 / 注入幂等 / 取值口径）、
  `HtmlBlockPermissionSwitch.test.ts`（权限 HIDDEN↔EDIT/READ 切换后标记撤销与可采集）、
  `engine-v2/__tests__/html-fields.test.ts`（清单枚举）、
  `HtmlComplexExport.test.ts`（设计器真实导出 JSON 的端到端：清单 → 输入 → 取数 → 只读回显）。

## 21. HTML 模块的输入回写口径与「注入幂等」（2026-09-23）

### 21.1 逐键不回写，失焦回写一次（与 P 字段同口径）

| | P 字段（`GridSchemaNode`） | HTML 模块（`HtmlBlock`） |
|---|---|---|
| 输入过程中 | 不回写 | **不回写** |
| 离开字段 | `@blur` → `onFillBlur` → `field-change` | `focusout` → `onShadowFocusOut` → `field-change` |
| 保存时全量取值 | `collectFieldValues(root)` | `collectFieldValues(root)` |

- **为什么不能逐键回写**：使用方（`FormRenderer` / 宿主）每键重建响应式 `data` ⇒
  `GridFormRenderer.renderedPages`（依赖 `data`）每键重算分页 + 整树重渲染。大表单每键一次全量重排，
  且是「输入掉焦点」的放大器。`HtmlBlock` 自 2026-09-23 起从「逐键 emit」改为「失焦 emit 一次」。
- 取值出口不受影响：**保存口径走 `collectFieldValues`**（DOM 即真相源，未失焦也能取到实时值）；
  失焦事件只服务 `v-model:data` / 草稿自动保存这类增量消费。
- 监听用 **`focusout`（冒泡）而不是 `blur`（不冒泡）**：监听挂在 `shadowRoot` 上做**事件委托**，
  子树重建后无需重挂（旧实现每次 `inject()` 都 `querySelectorAll` 逐个 `addEventListener`，
  重建即失效、且重复注入会重复挂）。
- 可写判定在**事件时**做（`resolveWritableTarget`）：只认 `<input data-bind>` 非 readonly 与
  `[data-field][contenteditable="true"]` 两类；设计态（`data == null`）经 `canFill()` 闸门挡掉。

### 21.2 注入必须幂等（「敲 1 个字符就掉焦点」的根因）

`inject()` 会 `shadowRoot.innerHTML = buildMarkup()`；**重建会把正在输入的 `<p contenteditable>`
整体换掉，焦点随元素一起消失**（表现：敲第一个字符后光标没了、后续按键全丢）。
真实 Chromium 实测（`preview.html?schema=sign-table`，36 格原生 `data-field`）：

| 逐键对聚焦元素做的动作 | 结果 |
|---|---|
| 重复写同值 `contenteditable` 属性 | 焦点保持 |
| 重复写同值 `textContent` | 焦点保持 |
| **重写 `shadowRoot.innerHTML`** | **焦点丢失 + 元素脱链 + 后续按键全丢** |

而 `inject()` 是 `[node.html, node.css, fieldPermissions, readonly]` 的 watch 回调 ——
**这些 prop 的对象身份在真实浏览器里会因分页重算而每次输入都变一次**（`renderedPages` 依赖 `data`，
分页产出的是新节点对象），且 getter 返回**新数组**、`Object.is` 恒不相等 ⇒ 回调每次都跑。
**故此处的把关点必须放在回调内部，而不是 watch 的触发条件**：

1. **注入前比较标记串（唯一防线）**：`const markup = buildMarkup(); if (markup !== lastMarkup) { ...重写... }`
   —— 重建由「结构真的变了」把关，与 prop 身份完全解耦；未重建分支仍必须执行 `syncData()`，
   否则 `readonly` 切换不会同步（原生 `[data-field]` 的 `contenteditable` 不在标记串里）。
2. **不要为此把 watch 改成数组 sources**（`watch([() => node.html, …], inject)` 会逐项比较、真变了才跑）：
   `fieldPermissions` 可能是**同一个对象被原地改**（键值变化、引用不变），逐项比较会漏掉 ⇒ 权限不生效。
   回调「每次都跑」是**有意保留**的 —— 真正开销在 `syncData()` 的 DOM 遍历，而**输入期间 `data` 不变化**
   （不逐键 emit）⇒ 输入时这个 watch 根本不触发，代价为零。

- 守卫：`HtmlBlockField.test.ts` 「注入幂等（掉焦点防线）」两条（等值新 node 不重建 / `html` 真变仍重建）
  + `HtmlComplexExport.test.ts` 端到端一条（失焦回写触发 data 变化后单元格元素身份不变）。
- 反向验证 6/6：无条件重建 / 比较恒等 / 逐键回写 / 监听用不冒泡的 `blur` / 可写判定不查
  `contenteditable` / 去掉设计态闸门 —— 逐个破坏都变红。

## 22. HTML 模块内字段「点不进 / 打不了字」：视口层 panzoom 排除必须穿透 Shadow DOM（2026-09-24）

**症状**：设计器预览态（及宿主消费页）里，HTML 模块内的字段**鼠标点不进去、键盘打不出字**，
而同一张纸上的 P 字段正常可输入。

**机制**（三层叠加，缺一不可）：

1. 画布平移由 `PaperViewport` 的 `@panzoom/panzoom` 接管；panzoom 用 `excludeClass`（默认 `panzoom-exclude`）
   决定哪些元素上的指针手势**不**触发平移 —— 判定实现是 `event.target.closest('.panzoom-exclude')`。
2. HTML 模块内的控件长在 **shadow root** 里。事件跨 shadow 边界时 `event.target` 被**重定向为宿主元素**，
   且 `closest` 同样止步于边界 ⇒ **给 shadow 内的元素打标毫无作用，必须把宿主打标**。
3. 打标遍历 `scaler.querySelectorAll(EXCLUDE_SELECTOR)` **也不穿 shadow 边界** ⇒ shadow 内的控件
   从一开始就没被看见。

**为什么只在预览/填写态暴露**：设计态 `CanvasSurface` 给所有节点设 `draggable="true"`，
HTML 宿主本身命中 `[draggable='true']` ⇒ 顺带被打上标；切到预览态 `draggable` 被移除，
宿主失去这唯一的命中来源 ⇒ panzoom 吞掉 HTML 模块内的 `mousedown` ⇒ 点不进、打不了字。

**修复**（`PaperViewport.tagExclusions`）：

- `collectExcludeTargets(root)` = 常规选择器命中项 **+ 含可编辑控件的 Shadow 宿主**（遍历所有元素查
  `el.shadowRoot?.querySelector(EDITABLE_SELECTOR)` 决定是否收宿主）。全仓 `attachShadow` 只有 `HtmlBlock`
  一处 ⇒ 该扫描不会误伤其他节点（非 shadow 元素 `el.shadowRoot` 为 `null`，直接跳过）。
  代价是每次重打标多一次全树 `querySelectorAll("*")`；触发源是 `MutationObserver`（`childList`/`subtree`
  与 `draggable`/`contenteditable` 属性），纯文本输入不触发。若要更省可只扫 `.layout-html`
  （`collectFieldValues` 已是这个口径），代价是失去「不依赖类名」的鲁棒性 —— 当前未改。
- `user-select` 恢复同样作用于宿主：该属性**可继承**，shadow 内控件的继承源正是宿主，
  在宿主上写 `text` 即可让 shadow 内文本可选（也给宿主写了才生效）。
- 选择器收成一份共用口径 `EDITABLE_SELECTOR = input, textarea, select, [contenteditable]:not([contenteditable="false"])`
  —— 属性选择器匹配的是「属性**存在**」，`contenteditable="false"` 同样命中，加 `:not` 属**口径收紧**。
  ⚠️ 但它**不是本 bug 的成因**、当前影响面为零：FD 的 light DOM 里不存在 `contenteditable="false"`
  （P 字段只产生 `"true"` / `undefined`；唯一产生 `"false"` 的 `HtmlBlock.applyFieldState` 在 shadow 内，
  本就不被 light 选择器覆盖）。留着它只为防「将来 light DOM 出现关闭态时 reconcile 永远命中」。
- 清理阶段同时重置内联 `user-select`（原实现只摘类，残留 `style.user-select: text`）。
  内联 `user-select` 的写入点全仓只有本组件 ⇒ 重置不会覆盖别处设置；CSS 表里的 `user-select: none` 不受影响。

**已知边界**：HTML 模块内控件的**增减**（schema 改 html、控件由可编辑变只读）发生在 shadow 内，
对 PaperViewport 的 MutationObserver（观察 light DOM）**不可见** ⇒ 宿主上的标记要等下一次重打标
（`draggable` / `contenteditable` 属性变化或节点增删）才收敛。仅影响该模块区域的平移手感，
不影响字段可编辑性（`HtmlBlock` 每次 `inject()` 都会重落 `contenteditable`）。

**守卫**：`PaperViewport.test.ts` 四条 —— 穿透打标（宿主有 `panzoom-exclude` 且 `user-select: text`）、
纯展示 Shadow 不打标（保留平移）、light DOM 控件/可拖拽节点照常打标、`contenteditable` 关闭后
标记与内联 `user-select` 一并清除。反向验证 5/5（不穿透 / 宿主不恢复 user-select / 清理不清类 /
清理不清内联样式 / 选择器口径退化为 `[contenteditable]`）。

**影响面（2026-09-24 审计）**：本轮改动**对非 HTML 节点零影响** —— 无 shadow 时 `collectExcludeTargets`
与直接 `querySelectorAll(EXCLUDE_SELECTOR)` 等价（唯一差异是 `[contenteditable="false"]` 不再命中，
而 light DOM 里没有这类元素）；内联 `user-select` 清理不覆盖别处；`attachShadow` 全仓唯一。
对**消费方**有两处口径变化需知：① `collectSchemaFields` 现在也枚举 HTML 片段内字段（宿主权限表 / 校验
`rule` 的键集会随之变大，复杂表 +36）；② HTML 内字段的 `field-change` 由逐键改**失焦一次**（已与 P 字段一致）。

## 23. 缩放视口（PaperViewport）：公共导出与「宿主工具栏接管」契约（2026-10-08）

### 背景

`PaperViewport` 原本只是 `FormRenderer` 的内部实现（`options.zoom` 时包一层），带自己的工具栏。
实际消费方（工单详情页）**自己有工具栏**：旧设计器（FC）那套票面用的是页顶 `extra-actions__zoom-group`
（TDesign 按钮 + 百分比文案）+ 自研缩放（CSS `zoom` 属性 / `transform: scale()` 回退 + 外层滚动条 +
指针拖动），而 FD 票面走的是 `PaperViewport` 自带工具栏 —— **同一张票在两种表单下缩放行为完全不同**，
且宿主工具栏对 FD 是隐藏的（`v-if` 带 `!formIsFd`，因为那时 FD 没有「宿主侧缩放落点」）。

本次把两条路径收敛到**同一个视口**：`PaperViewport` 提为公共导出，宿主工具栏成为唯一 UI，
FC 侧的自研缩放整体删除、改用同一个视口。

### 新增 API

**`PaperViewport`（`@cluadwong/form-designer/renderer` 导出）**

| Prop / 方法 | 语义 |
| --- | --- |
| `hideBar` | 隐藏内置工具栏（宿主已有自己的工具栏时置真；否则页面上会叠两套 UI、两处百分比各说各话） |
| `fitPadding` | 「适应宽度」时**左右各留出**的空白（px，默认 `0` = 贴边）。参与比例解算：`s = (视口宽 − 2×fitPadding) / 内容宽`；左右间隔由水平居中自然给出，顶部间隔另有 `TOP_GAP = 18px`（与比例无关） |
| `fitContentSelector` | 「适应宽度」量**哪个元素**（缩放层内选择器，缺省第一个子元素）。见下「为什么需要它」 |
| `alignOnMount` | 非 `fitOnMount` 模式下挂载时解算一次落点对齐（见下「为什么必须有」） |
| `zoomTo(scale)` | **绝对**比例缩放；受 `minScale/maxScale` 钳制；与当前比例几乎相同则幂等返回 |
| `relayout()` | 显式重排落点（换 schema / 换纸张后调用）。`fitOnMount` 时等价 `fitWidth()`，否则只 `alignContent` |

**`FormRenderer.options` 新增**：`hideZoomBar`、`initialScale`、`minScale`、`maxScale`、`alignOnMount`、`fitPadding`；
`defineExpose` 新增 `zoomIn / zoomOut / zoomTo / resetZoom / fitWidth / getScale`，
并新增 `scale-change` 事件（视口比例上行）。

**挂载即上报一次初始比例**：`scale-change` 的语义是「视口当前比例」，因此**挂载时也发一次**
（`emit("scale-change", initial.scale)`）。不发的后果只在「宿主自带工具栏、`hideBar` 隐藏内置栏」时
暴露 —— 挂载期的两次缩放写入（构造器 `zoom(startScale)`、兜底的 `fitWidth()`）比例相同，
`panzoomchange` 不会被转发，宿主的百分比会一直停在它自己的占位数字上（如写死的 110%），
而视口实际已是按容器算出的比例。

### 为什么需要 `fitContentSelector`：适应宽度量到「包装层」就退化成不缩放

本内核的 DOM 是 `缩放层 > .grid-form-canvas > .grid-form-paper` —— **纸外面还包了一层画布**，
而画布是铺满视口的（宽 = 100%）。`measureFit` 缺省取缩放层的第一个子元素，于是量到的是**画布**：
它的 `scrollWidth` 恒等于视口宽 ⇒ 比例恒等于 1。宽容器里 A4 纸只有自然宽 794px、两侧各空 53px，
**并不铺满**；若同时给了 `fitPadding`，纸反而被**缩小**（留白被放大成 `padding × 视口宽 / 纸宽`）。

无头 Chromium 实测（容器 900×800、A4 纸 793.69px、`fitPadding: 24`，`FormRenderer {bare, zoom,
fitOnMount}`）：

| 量谁 | scale | 纸宽 | 左右留白 | 顶部 |
| --- | --- | --- | --- | --- |
| 画布（缺省） | 0.9467 | 751.36px | 74.32 / 74.32 | 18.0 |
| 纸（`fitContentSelector: ".grid-form-paper"`） | 1.0730 | 851.66px | 24.17 / 24.17 | 18.0 |
| 纸 + `fitPadding: 0` | 1.1335 | 899.65px | 0.18 / 0.18 | 18.0 |

（0.17px 的残差来自 `scrollWidth` 是**整数**取整值，而纸的实际宽是 mm 换算来的小数 793.69 —— 亚像素级，可忽略。）

**默认不改**：既有消费页（审批 / 新建 / 表单管理 / 设计预览）用的仍是内核原生的
「缩到能放下」（不做放大），传选择器会变成「铺满（含放大）」，属另一个形态，由消费方显式声明。
工单详情页的 FD 票面即显式传 `".grid-form-paper"`（宿主 `FdFormRenderer`）。

> `alignPanFor` 与 `measureFit` 必须用**同一份**内容解析（`resolveFitContent()`）：比例按纸算、
> 平移按画布算就会偏。二者都只吃布局值（`scrollWidth` / `offsetLeft`，不受 transform 影响），
> 故「纸比画布窄、画布铺满缩放层」时既有水平居中公式的解不变（实测：换内容后 `x` 与「画布」口径一致，只有比例变）。

### 三条硬契约

1. **视口是比例的唯一真源，百分比只是它的整数投影。**
   宿主工具栏的 `110%` 只是显示；用户滚一次滚轮，视口比例就从 1.1 变 1.23，宿主必须靠 `scale-change`
   跟着刷新，**且不得反向下发** —— 回写会把连续小数立刻四舍五入成整数百分比，缩放一跳一跳的。
   命令方向（按钮 → 视口）走 +10% 的**加法**步进（宿主原有语义），而不是视口自带的 ×1.2 乘法步进。

2. **`zoomTo` / `zoomIn` / `zoomOut` 不动平移，只有 `fitWidth` / `reset` / `relayout` 会重排落点。**
   围绕视口中心缩放才能保留用户的浏览位置；3× 下微调 ±10% 时被拉回原点会很难用。

3. **`initialScale` 只在挂载时被读取**（改它不会重新缩放），所以宿主切换百分比必须调 `zoomTo`。
   这样避免「宿主状态 → 视口 → 视口回读 → 宿主状态」的回环。

### `alignOnMount` 为什么必须有

panzoom 的 `transform-origin` 是**缩放元素自身中心**，而 `.paper-viewport__scaler` 的布局盒是
「视口宽 × 内容高」⇒ 任何 `s ≠ 1` 都会让内容整体偏移 `size/2·(1−s)`（放大时顶出左上角、缩小时右下留白）。
「适应宽度」靠 `measureFit()` 顺带对齐了；**固定百分比**模式（宿主工具栏按 110% 下发）没有这一步，
不对齐就得让用户自己把纸张拖回来。

对齐解算仍复用 `paper-viewport-align.ts`（水平居中、垂直顶部留 `TOP_GAP=18px`）；
但**默认关闭** —— 设计态必须保持「不写起始平移」的既有契约（缩放恒为 1，本就没有偏移），
故由消费页显式声明。`FormRenderer` 侧默认开（消费页固定比例浏览时必须对齐），`PaperViewport` 侧默认关。

> 注意区分 `fitOnMount`（**重算比例** + 对齐）与 `alignOnMount`（**只对齐**）：`fitOnMount` 为真时后者不参与
> （挂载与 `relayout` 都走 fit 分支）。此前的宿主形态是「固定百分比 + 只对齐」，2026-10-08 改为
> 「初始化即按表单宽度铺满」（见下节）。

### 宿主的初始化形态：以表单宽度铺满 + 左右留白（2026-10-08）

工单详情页（`soar-web-v3-td`）的票面要求：**初始化时以表单宽度为准铺满显示区域，左右上方各留一点空间**
（原形态是写死 `110%` + 只对齐，宽容器下纸张偏小、窄容器下溢出）。

故宿主工具栏模式（`FdFormRenderer` / `TicketA4Preview` 收到 `zoomPercent` 时）的视口配置为：

| 配置 | 值 | 说明 |
| --- | --- | --- |
| `fitOnMount` | `true` | 挂载即按容器宽反算比例；容器/内容尺寸变化且用户未手动干预时自动重算（窗口缩放、侧栏开合、分页校正改变内容高） |
| `fitPadding` | `24` | 左右各留 24px；顶部间隔恒为 `TOP_GAP = 18px` |
| `fitContentSelector` | `".grid-form-paper"` | 按**纸**的自然宽解算（缺省会量到铺满视口的画布 ⇒ 比例恒 1、铺不满，见上节实测） |
| `hideZoomBar` | `true` | 宿主顶栏已有缩放组，避免两套 UI / 两个百分比 |
| `minScale` / `maxScale` | `0.5` / `2` | 与宿主工具栏的 50%~200% 对齐，否则滚轮能跑出工具栏表达不出的区间 |
| `initialScale` | `zoomPercent / 100` | 仅作**测量不可用时**的回退（`fitOnMount` 在量得到尺寸时恒覆盖它） |

配套语义变化：宿主工具栏的「重置」= **回到初始视图**（即再适应一次宽度），不再是「写死回到 110%」——
初始既然自适应，重置回到固定百分比就会与首屏不一致。用户一旦手动缩放/平移（`zoomTo` / 滚轮 / 双击捏合），
自动重算即停止（`userAdjusted`），直到下一次 `fitWidth` / `relayout`。

### 打印安全

`@media print` 下 `.paper-viewport__scaler { transform: none !important }`，且局部打印只序列化
`.print-container` 子树（视口的 transform 在祖先上），故缩放不进打印流。FC 侧替换后 `.print-container`
仍是 form-create 的元素，`getPrintSourceElement()` 口径不变。

### 测试守卫

- `PaperViewport.test.ts`：`hideBar` 渲染/不渲染、`zoomTo` 钳制 + 幂等 + 不动平移、`alignOnMount`
  起始值（含 `alignOnMount` 缺省仍为 0 的对照）、`relayout` 不改比例、**组件 ref 路径**
  （父组件模板 ref 调 `zoomTo/getScale` —— `@vue/test-utils` 的 `vm` 代理只透出 `<script setup>`
  顶层绑定，`defineExpose` 的对象字面量成员在 `vm` 上取不到，只有真实 ref 才等价于宿主运行期）、
  **`fitPadding`**（比例按 `(视口宽 − 2×留白) / 内容宽` 解算、缩放后内容宽 = 视口宽 − 2×留白、
  负留白归一为 0、顶部间隔不受影响）、**挂载即上报初始比例**。
- `FormRenderer.test.ts`：`hideZoomBar` / `initialScale` / `minScale·maxScale` / `fitPadding` 透传、
  `scale-change` 转发（含挂载那次上报）、固定比例模式换 schema 只重排落点不改比例、
  未开启 `zoom` 时缩放方法安全降级。
- 宿主侧（`soar-web-v3-td`）：`formZoom.contract.test.ts` 锁「两条票面路径共用同一视口」的形状，
  含负向锁（自研缩放的标志符号不得回归、缩放组不得再按表单类型隐藏）。

## 24. 放大即糊：缩放层严禁合成层提示（`will-change: transform`）（2026-10-08）

**症状**：纸张视口放大后表单发虚（300% 下尤其明显）。

**根因**：`.paper-viewport__scaler` 上曾有 `will-change: transform`。它把 scaler 提升为**独立合成层**，
Chrome 按**提升那一刻**的比例（「适应宽度」常是 0.3~0.5×）一次性栅格化图层，之后 `transform: scale()`
只做**位图放大**。比例越小越明显：移动端 / 侧栏「适应宽度」到 0.4×，再放到 300% 等于把位图放大约 7 倍。

**实测**（无头 Chromium + CDP 真实时序，A4 先「适应宽度」到 0.499× 再放大到 3.000×，
取页面文字带做 Laplacian 方差对焦度量；两组几何完全一致，唯一变量是 `will-change`）：

| 变体 | `will-change` | 实际 transform | lapVar（越大越锐） | gradMean | midFrac（越小越锐） |
| --- | --- | --- | --- | --- | --- |
| 修复前 | `transform` | `matrix(3,0,0,3,−633,1213)` | **158.43** | 3.398 | 0.5253 |
| 修复后 | `auto` | `matrix(3,0,0,3,−633,1213)` | **920.05** | 4.055 | 0.5084 |

**锐度 ×5.81**，中间调像素同时减少 ⇒ 从「位图放大」变成「按 3× 真实重排重栅格化」。

**结论**：`.paper-viewport__scaler` 严禁任何合成层提示（含 `translateZ(0)` / `backface-visibility`
等同类写法），理由与实测数字写在该 CSS 规则上方，防止日后被当成性能优化加回来。

**取舍**：去掉提示后平移由重绘承担，重表单在超大比例下拖动可能略不如前。若日后确需兼得，只能在
**仅平移**（比例不变 ⇒ 栅格比例本就正确）期间临时加提示，且必须在缩放前移除 —— 不可常驻。

**踩坑**：`will-change: none` 是**非法值**（Chrome 只识别 `auto`），用它做「内联覆盖 CSS」的 A/B 探针
会静默失效（computed 仍是 `transform`），从而得出「不是它的问题」的错结论。做这类对照实验时
必须先用最小页面验证覆盖是否真的生效。
