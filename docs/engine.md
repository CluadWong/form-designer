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

## 25. 分页「空白纸」过滤：渲染期判定物理页是否留下可见内容（2026-10-10）

### 现象

表单打印时多出「看起来全白」的一页。

### 根因（两层叠加）

1. **分页引擎只按高度切页** —— `gridRowHeightMm` 取 `row.height × baseRowHeight`，**空行照样算**。
   实测报障 schema：一个 34 行 Grid，第 1 行有文本、后 **33 行全空** ⇒ 33 × 8 = 264mm，格高约
   272.5mm，几乎占满正文区（A4 − 上下边距 12×2 = 273mm）⇒ 尾部节点放不下，被切成**第 2 张纸**。
2. **被挤出去的那张纸恰好「打印不显影」** —— 它的唯一内容是**无来源图片列表**，而
   `.layout-image--blank` 在 `@media print` 下 `display:none`（既定语义，见 `ImageBlankPrint.test.ts`）
   ⇒ 纸面全白。

即：**分页引擎知道「有多高」，不知道「打印出来有没有东西」**，于是会为一张实际什么都不印的纸单独开页。

### 修法：渲染期过滤，且不删任何节点

- `src/components/renderer-v2/paper-visibility.ts` —— 纯函数 `pageHasVisibleContent(page, data)` /
  `nodeHasVisibleContent(node, data)`，判定「该节点 / 该纸在该 `data` 下是否留下可见内容」。
- `GridFormRenderer.vue` 新增 `visiblePages = computed(...)`，在 `displayedPages` 之后剔除判为空的纸；
  模板 `v-for` 改用它，页眉页脚的 `{total}` 取过滤后的长度。

**闸门（2026-10-10 二次调整）**：`GridFormRenderer` 的 prop `blankPageMode?: "auto" | "hide" | "keep"`
（缺省 `"auto"`，经 `CanvasSurface` 透传）：

| 取值 | 行为 |
| --- | --- |
| `"auto"`（缺省） | 按渲染模式自动：**非设计态隐藏、设计态保留** |
| `"hide"` | 强制隐藏（设计器打印窗口用） |
| `"keep"` | 强制保留 |

原先闸门是「`paginate === false` 才不过滤」，**这是错的** —— 设计画布**默认就是分页的**
（`FormDesigner` 的 `paginate` ref 默认 `true`，由 Inspector 开关控制），所以上一版会把空白页
在设计态也藏掉 ⇒ 那一页无法点中、无法编辑，且画布张数与状态栏「实际会打印几张纸」的计数对不上。
必须按 `mode` 判定。三态用字符串而非布尔，是因为布尔 prop 缺省时会被 Vue 强制转成 `false`
（`resolvePropValue`：`isAbsent && !hasDefault ⇒ value = false`），表达不了「缺省跟着 `mode` 走」。

四条硬约束：

1. **不删节点** —— 判定是 `computed` 且依赖 `props.data`。宿主脚本在渲染后填入数据时，原本为空的
   图片列表 / 字段变得有内容 ⇒ 判定自动翻转、**纸张自动回来**。「无内容」只表示「这一帧这张纸不出」，
   **绝不允许**据此移除 schema 节点或 DOM 节点（否则数据一到就丢了内容）。
2. **设计态不过滤**（`mode === "design"`）—— 设计器画布必须能看见、能点中并编辑每一页；
   空白页也可能带着 Grid 行列结构等着填内容。唯一例外是设计器的「打印」按钮：`printForm` 序列化的
   就是设计画布，故 `FormDesigner.printDocument()` 在打印窗口内把 prop 切到 `"hide"`
   （与它临时把 `paginate` 打开同一处、同一手法），序列化一结束立即还原。
3. **连续编辑视图不过滤**（`paginate === false`）—— 它本就是「整页不切分」的编辑版式。
4. **兜底** —— 若全部纸张都被判为空（全空表单），保留原列表，避免「一张纸都不剩」导致画布空白、
   打印按钮无反应。

过滤后按新顺序重编 `index`（`{page}` / `{total}` 取的就是它），否则删掉中间的纸会让页码出现空洞。

### 判定口径（**宁保守勿误删**）

判不准一律算「有内容」——误删会让用户丢内容，多留一张纸只是不好看。

| 节点 | 判为「有内容」的条件 |
| --- | --- |
| Grid | `border !== "none"`（框线会打印，哪怕每格全空）；否则递归 cell 子树，任一后代有内容即算 |
| 字段 P | 恒为有内容（标签 / 下划线 / 可填控件都在纸面留痕） |
| Table | 恒为有内容（表头必然打印） |
| Text | 去空白后非空 |
| Html | 去标签 + 去 `&nbsp;` 后非空 |
| Image | `resolveImageItemsV2` + `hasImageSourceV2` —— 与渲染层 / 分页引擎**同一真源**，无来源即判空 |
| 无子节点的纸 | 判空（分页引擎为空逻辑页产出的兜底空纸） |
| 其它 / 未知类型 | 恒为有内容（向前兼容：新增节点类型默认保留） |

### 为什么不放在另外两个位置

- **不在 `printForm()` 里做**：那是「送印前一瞬」的 DOM 后处理，只能改打印结果；而宿主数据是**渲染后**
  才填的，判定必须能随 `data` 自动翻转 —— 放在 `computed` 里才成立（也更早暴露在预览态）。
- **不在分页引擎里做**：引擎的职责是高度切分，把「可见性」塞进去会让 `paginatePage` 需要感知
  `@media print` 语义，且设计态（`paginate=false`）也依赖同一引擎。分页照旧切、渲染层负责出纸，
  职责不混。

`printForm()` **无需改动**：设计器打印窗口内已把 prop 切到 `"hide"`，纸张此刻不在 DOM 里，
`scope.querySelectorAll(PRINT_PAPER_SELECTOR)` 自然选不到它。

### 实测（2026-10-10）

报障文件 `src/dev/formdesigner-schema-v2-1791592480299.json`（1 个逻辑页）：

| 层级 | 结果 |
| --- | --- |
| `paginateSchema` 确定性分页 | **2 张纸** |
| 逐纸可见性 `pageHasVisibleContent` | `[true, false]` |
| `mode="design"`（设计画布，缺省 `"auto"`） | **2 张**（保留，可选中编辑） |
| `mode="preview"`（非设计态） | **1 张** |
| `mode="design"` + `blankPageMode="hide"`（打印窗口） | **1 张** |
| 非设计态下注入 `data: { shot: ["…"] }` | **2 张**（纸自动回来） |

### 测试守卫

`src/components/renderer-v2/__tests__/PaperVisibility.test.ts`（13 例）锁定：判定口径（空 Grid / 无来源图片
/ 有边框 Grid / 字段 P / Table / 文本）、`data` 驱动的翻转、非设计态 2 张出 1 张、**设计态保留 2 张**、
未传 `mode` 且无 `data` 的向后兼容口径、打印窗口 `"hide"` 生效、`"keep"` 反向开关、连续编辑视图不切分、
全空兜底。

**反向验证**：把 `visiblePages` 里的 `all.filter(pageHasVisibleContent)` 换成 `all`（停掉过滤）后，
该文件 **3 failed / 10 passed** ⇒ 用例确实咬住了这条逻辑，不是空跑。


## 26. 字段 P 回车不换行：无前后标签的字段（2026-10-13）

### 现象

设计器导出的模板（`formdesigner-schema-v2-1791857577958.json`）里两个字段 P：

| 字段 | 配置 | 回车 |
| --- | --- | --- |
| 第一行 | `mode:"field"`、`underline:true`，**无 prefix/suffix** | **不换行** ❌ |
| 第二行 | 同上 + `prefix:"1"` | 换行 ✓ |

> 注（2026-10-23）：`underline` 键已从 schema 移除，改为渲染层恒定行为（未开 `innerBorder`
> 即带下划线）。本节表格记录的是当时的导出模板，`underline:true` 现等价于「未开 `innerBorder`」，
> 结论不受影响。

### 根因：Chrome 回车「克隆内联元素」，不是插入 `<div>`

内核里那条为「无前后标签的字段」准备的规则写的是 `.layout-p :deep(div){flex:1 1 100%}` —— 它
**假设浏览器会在回车时插入 `<div>`**。实测（无头 Chromium 115 + CDP 真键盘）**并非如此**：

| 场景 | 可编辑宿主 | 宿主 computed display | 回车后插入 | 子元素 `top` |
| --- | --- | --- | --- | --- |
| 无 prefix/suffix | `.layout-p` 自身 | `flex` | **克隆 `<span class="layout-p__value">`** | 两元素 `top` 相同（同一行） |
| 有 prefix | `.layout-p__input` | `block`（flex item 块化） | 同上 | 两元素 `top` 相差一行高 |

Chrome 做的是**切分光标所在的内联上下文元素并复制其属性**，于是插进来的是
`<span class="layout-p__value">`，`div` 那条规则永远不命中；两个值元素作为 flex item
（`.layout-p__value{flex:1 1 auto}`）并排 ⇒ 挤在同一视觉行上各占一半宽度。
注意 `innerText` 里**已经有 `\n`**（取值口径没问题），坏的只是**渲染**。

有 prefix 的字段之所以正常：它的值元素在 `.layout-p__input` 内，被
`.layout-p__input > .layout-p__value{display:block;width:100%}` 兜住 ⇒ 天然堆叠。

### 修法

```css
.layout-p :deep(> .layout-p__value) { flex: 1 1 100%; width: 100%; min-width: 0; }
```

让**直接挂在 `.layout-p` 下**的值元素占满整行，连续多个自然折行。`:deep()` 是必须的
（运行时克隆的元素不带 scoped 属性）；**直接子级**限定也是必须的（否则会改掉复合字段
值元素的宽度语义）。原 `div` 规则保留：Firefox 等插入块元素、`innerBorder` 的逐行 `<div>`
仍会命中。

### 实测（2026-10-13，真组件集成探针 + 真键盘）

真 `GridFormRenderer` + 真模板 JSON，`mode="preview"`（字段可编辑）：

| 字段 | 修复前 | 修复后 |
| --- | --- | --- |
| 无 prefix（`.layout-p` 直接承载值） | 2 个值 span `top` 均 `74.06`，宿主高 `21.8` ⇒ **1 行** ❌ | `top` `70.34` / `91.14`，宿主高 `42.59` ⇒ **2 行** ✓ |
| 有 prefix（值在 `.layout-p__input` 内） | 2 行 | 2 行（**逐值一致，零回归**） |

零影响验证（同一构建 + 运行时覆盖样式做 A/B）：

- 单行值 / 空字段：截图 **md5 完全相同**（`3ec6540a…` / `2fa9b34e…`）⇒ 既有版式像素级不变；
- 弹性单元格（`.layout-grid__cell--flex`，`.layout-p` 收缩到内容宽）：`.layout-p` 宽 13 / 39px
  **前后一致** ⇒ `flex-basis:100%` 在收缩到内容宽的容器里按 `auto` 兜底，不把内容撑成满行。

**CDP 复现要点**（两个坑，否则会得到假结论）：回车必须带 `text:"\r"`（`rawKeyDown` 不触发插入）；
用 `"AB|CD"` 这类字符串描述输入序列时必须**显式写出空段**（`"AB||CD"` = AB → 回车 → CD），
否则 `split('|')` 根本没有空串、回车从未派发。

### 测试守卫

`src/components/renderer-v2/__tests__/FieldPLineBreak.test.ts`（5 例）。jsdom 没有编辑管线
（插不了、也量不出），故锁**成因侧**两条：

1. 编译后的 scoped 样式里确有 `.layout-p[data-v-…] > .layout-p__value{flex:1 1 100%}`，
   且**不**波及 `.layout-p__input` 内的值元素；复合字段那半条机制（`display:block;width:100%`）仍在；
2. 真渲染的 DOM 里，无前后标签字段的值元素确实是**可编辑宿主 `.layout-p` 的直接子级**
   （结构变了 ① 就永远匹配不到 —— 上一版 `:deep(div)` 失效正是这个原因）。

**反向验证**：把该规则的选择器改成不命中的形态后，该文件 **1 failed / 4 passed**，
且恰好红在 ① 上 ⇒ 不是空跑。

---

## 27. 签名图手势归属：签名图纳入视口平移排除（2026-10-13）

### 问题

签名图（字段 P 且 `valueType === "image"`）**不是可编辑控件** —— 它的 `contenteditable` 一律关闭
（`GridSchemaNode` 的图片分支），所以它既不在 `EDITABLE_SELECTOR` 里、也没有 `draggable="true"`，
于是**完全落在平移手势的接管范围内**。

宿主侧却把「按住签名图」当作正经手势的起点：PC 端悬停删除角标、移动端点击弹「重签 / 删除」菜单。
不排除的症状是「想按住这张签名图，画布却跟着平移了」。

### 改法

`PaperViewport.vue` 的排除选择器新增一段（单图与多人容器都覆盖）：

```ts
const SIGN_IMAGE_SELECTOR = ".layout-p__sign, .layout-p__signs";
const EXCLUDE_SELECTOR = `${EDITABLE_SELECTOR}, [draggable='true'], ${SIGN_IMAGE_SELECTOR}`;
```

为什么两个类都要：单图时 `<img>` 直接挂在字段根 `.layout-p` 或 `.layout-p__input` 下，两条分支的图
**都带 `.layout-p__sign`**；两人以上时图被包进 `.layout-p__signs`（`flex-wrap`、图间有 `gap`），
容器一并打标才不会「在两张图之间的空隙按下仍然平移」。

打标本身走的还是既有 `tagExclusions()`（先清后打 + MutationObserver 驱动），**没有新增机制**。

### 实测（真 `@panzoom/panzoom` 4.6.2 + 真实 `PointerEvent`，无头 Chromium 1071）

信号取 panzoom 自己的 `getPan()`：`pan()` 在 `setTransformWithEvent` **之前**同步更新内部 `x`/`y`，
而样式写入被包在 `requestAnimationFrame` 里（无头 `--dump-dom` 不保证跑得到，第一版探针就因此
得到「全都没平移」的假结论）。内部状态变了，样式必随之写 —— 故 `getPan()` 是可靠的同步判据。

| 场景 | `panzoom-exclude` | 拖拽 (60,40) 后的平移量 | 结论 |
|---|---|---|---|
| ① 普通图片（`.layout-image__img`） | 否 | `dx=60 dy=40` | **平移发生**（现状对照） |
| ② 签名图 `.layout-p__sign` | 是 | `dx=0 dy=0` | 未平移 |
| ③ `input`（既有口径） | 是 | `dx=0 dy=0` | 未平移 |
| ④ 签名图**摘掉排除类**（负向对照） | 否 | `dx=60 dy=40` | **平移发生** |
| ⑤ 签名图重新打标 | 是 | `dx=0 dy=0` | 未平移 |

①②④⑤ 两条负向对照都能复现「平移发生」，证明探针是活的、不是恒绿。

### 宿主删除角标**不能**靠内核打标（配套事实）

宿主的删除角标挂在「与 `<form-renderer>` 同级」的位置（`.fd-form-renderer > button`）——
它在 scaler 内、但在内核算布之外，而 `tagExclusions()` 是**先清空全部 `panzoom-exclude` 再按自己的
选择器重打**，所以宿主自加的排除类会被抹掉。角标必须自己挡手势（`@pointerdown.stop`）。
实测对照：

| 角标 | 拖拽后的平移量 |
|---|---|
| 带 `pointerdown` 的 `stopPropagation`（= Vue `@pointerdown.stop`） | `dx=0 dy=0`（未平移） |
| 不带（负向对照） | `dx=60 dy=40`（平移发生） |

### 测试守卫

`src/components/renderer-v2/__tests__/PaperViewport.test.ts` 新增 1 例：单图 / 多人容器 / 容器内的图
**都被打标**；普通图片 `.layout-image__img` **不打标**（负向：本次只收签名图，不吃掉别的图片的
平移手感）；且签名图不得被顺带写 `user-select: text`（它走「排除手势」这条路径，不是「可编辑」）。

**反向验证**：把 `SIGN_IMAGE_SELECTOR` 从 `EXCLUDE_SELECTOR` 里抽掉后该文件 **1 failed / 43 passed**，
且恰好红在「单图被打标」那条断言上 ⇒ 锁有效。

### 刻意不做

- **图片组（`.layout-image__img`）不排除**：本次只针对签名图（它的手势有宿主消费方）。图片组的图
  目前没有宿主手势，保持「拖到图上即平移」的既有手感；要收进来只是在 `SIGN_IMAGE_SELECTOR` 那一行加个类。
- **不给签名图设 `user-select: text`**：`<img>` 是替换元素，没有文本可选；把它塞进
  `EDITABLE_SELECTOR` 会顺带改变 `tagExclusions` 的清理与用户选择行为，与本改动无关。

---

## 28. 图片列表「删除单张」角标：内核渲染 + 事件回宿主（2026-10-14）

### 背景与口径

字段 P 的签名图此前走「宿主自摆绝对定位角标」（§27 落地内核手势排除的那套）。用户要求把入口
**收进内核**：图片自身右上角出一个删除按钮，点一下发事件，**删除业务仍由宿主做**。

本轮先拿**图片列表**（`image` 节点，`.layout-image` / `.layout-image__item`）当先行改造例子。

三条拍板口径：

1. **内核只渲染 + 发事件，绝不改 `data`**——图片列表的删除往往还要走宿主的鉴权 / 留痕 / 提交接口；
2. **入口条件 = 有 `field` + 非设计态 + 非只读 + 字段权限非 `READ`·`HIDDEN`**（内核已有
   `fieldPermissions` prop，不必再让宿主自己藏按钮）；
3. **悬停浮现**（不做常显）——票面要干净，与签名图形态 A 的手感统一。

### 实现

**渲染（`GridSchemaNode.vue`）**：每个 `.layout-image__item` 内追加一个
`<button class="layout-image__del" type="button">×</button>`：

- `.layout-image__item` 加 `position: relative`，角标 `position: absolute; top:0; right:0; 16×16`
  ⇒ **不参与布局**，条目盒的 `data-*` 与分页估高都不受影响；
- 显隐走 `visibility` + `opacity`（**不是 `display`**）：元素保留盒模型、几何可量、悬停不抖，
  隐藏态 `visibility:hidden` 不接收指针 ⇒ 点不到；
- `@media print { display: none !important }`：它是交互不是票面内容；
- **不带 `data-field`**：`collectFieldValues` 按 `[data-field]` 采集，角标不参与；
- `@click.stop`：宿主在根上的点击委托（`onFormClick` 一类）不该收到这次点击。

**入口条件（`imageDeletable`）**：`node.field` 存在（静态图节点只有模板 `images`，没有可删的
**数据**）+ `canFill`（非设计态 + 非只读）+ `fieldPermissions[field]` 不是 `READ`/`HIDDEN`。

**事件链**：`GridSchemaNode → GridFormRenderer → FormRenderer` 逐层转发
`image-remove`（与既有 `field-change` 同构），载荷 `ImageRemovePayloadV2`
（`src/types/schema-v2.ts`）：

```ts
{ nodeId, field, index, item }
```

- `index` = **值数组下标**：`resolveImageItemsV2` 只在**尾部**按 `maxCount` 截断 ⇒ 渲染下标与
  值数组下标前缀对齐，宿主直接 `splice(index, 1)` 即可；
- `item` 取**显式条目**（`applyDefaults: false`），即 `data[field][index]` 那一份本身，
  不掺节点级默认宽高——宿主拿它跟值数组逐条比对时不会因默认值错位。

**手势**：`.layout-image__del` 并进 `PaperViewport` 的 `EXCLUDE_SELECTOR`。与宿主角标的关键差别是
**这个按钮长在内核自己的渲染树里**，所以可以直接被 `tagExclusions` 打标；宿主的角标在树外，
会被「先清空全部 `panzoom-exclude` 再重打」抹掉（§27），只能自己 `pointerdown.stop`。
角标另外也带了 `@pointerdown.stop` / `@mousedown.prevent` 作为第二道。

### 实测（真组件 + 真 scoped CSS + CDP 真鼠标 + 真打印媒体）

无头 Chromium 1071，挂**真 `GridSchemaNode`**（`mode="preview"`, `readonly=false`, 2 张图），
CDP `Input.dispatchMouseEvent` 真移动鼠标、`Emulation.setEmulatedMedia` 切真打印媒体：

| 观测 | 结果 |
|---|---|
| 条目盒 `position` | `relative` |
| 角标 `gapRight` / `gapTop`（条目右边 / 上边 − 角标同侧） | **0 / 0**（正好贴右上角） |
| 角标尺寸 | 16×16 |
| 角标 `position` | `absolute` |
| 角标文本 | `×`；`data-field` 不存在 |
| 默认（未悬停）`visibility` | `hidden` |
| 鼠标移到第 0 张图中心 | 角标 0 → `visible`，角标 1 仍 `hidden`（只浮现被悬停那张） |
| 鼠标移开到空白（负向对照） | 角标 0 → 回到 `hidden`（证明是真 `:hover`，不是粘住） |
| `Emulation.setEmulatedMedia('print')` | 角标 `display: none`、尺寸 0×0（不印到纸上） |

截图（悬停第 0 张）肉眼复核：红色圆形 × 落在该图右上角，未悬停的图没有角标。

### 测试守卫

- `__tests__/ImageDelete.test.ts`（新增 13 例）：入口条件 5 例（预览/只读/设计态/权限 4 态/静态图）、
  载荷 3 例（含「点哪个删哪个」「内核不改 data」）、不污染采集 / 不冒泡 2 例、
  样式契约 3 例（绝对定位 + 条目为定位容器 / 悬停用 `visibility` / `@media print` 隐藏）。
- `__tests__/PaperViewport.test.ts`：+1 例（45 例）——角标打上 `panzoom-exclude`，
  且**图片本身（`.layout-image__img`）与条目盒仍不打标**（负向：不吃掉图片的平移手感）。

**反向验证**（8 条探针，逐条就地破坏 → 跑测试 → 字节还原）：基线 `0 失败 / 13`、`0 失败 / 45`；
P1 去掉 `v-if` → 4 失败；P2 去掉 field 判据 → 1；P3 放开权限 → 1；P4 `index` 恒 0 → 2；
P5 `item` 置空 → 2；P6 去掉 `click.stop` → 1；P7 去掉打印隐藏 → 1；P8 抽掉手势排除 → 1。
8/8 变红，且两个源文件 sha256 复原一致。

### 刻意不做

- **签名图不并入本次**：签名图的值是 `string[]`（只取地址、无 name/尺寸），与图片列表的
  `ImageItemV2[]` 不同源；它的删除入口由**单独一轮**按同一「内核渲染 + 事件回宿主」口径补上
  ——见 §29。
- **内核不改 `data`**：不给「自动删掉」的便利写法——删除后的写回涉及宿主鉴权与提交，
  内核代劳会让宿主失去插入业务规则的时机。
- **不做常显 / 不做批量删除**：常显会污染票面观感；批量删除属宿主工具栏职责。
- **图片本身仍不打 `panzoom-exclude`**：只有角标排除手势，拖到图上仍是平移（保持既有手感）。

---

## 29. 签名图「删除单张」角标：与图片列表同一口径（2026-10-14）

### 背景与口径

§28 先拿图片列表当先行改造例子，留下的第一条「刻意不做」正是签名图。本轮把它按**同一套口径**
补上。用户拍板原话：「**保持现状**，签名图照此口径改造」——「保持现状」指**不放宽** §28 的入口条件
（无 `field` 的静态图节点仍然不给入口）。

三条口径与 §28 逐条一致：内核只渲染 + 发事件、**绝不改 `data`**；入口 = 有字段 + 非设计态 +
非只读 + 字段权限非 `READ`·`HIDDEN`；悬停浮现。

差异只有两处，都源自签名图自身的形态：

| | 图片列表 | 签名图 |
|---|---|---|
| 值域 | `ImageItemV2[]`（`{name, src, width, height}`） | `string[]`（只有地址） |
| 载荷 `item` | 条目对象 | 地址字符串 |
| 能否直接挂角标 | 条目盒 `.layout-image__item` 本就是图片的包裹层 | **原本没有包裹层** ⇒ 本轮新增 `.layout-p__signcell` |

### 实现

#### 1. 新增包裹层 `.layout-p__signcell`（角标要贴「图片自身」的右上角）

角标必须贴在**图片自身**的右上角，而不是字段 / 下划线的右上角；而 `position: absolute` 只认最近的
定位祖先，所以图片外面必须有一层盒子。签名图此前**单张时不带任何包裹层**（`<img>` 直接是
`.layout-p__input` / `.layout-p` 的子项，2026-09-30 为「DOM 与升级前逐字节一致」刻意保留），
故本轮新增：

```html
<span class="layout-p__signcell"
  ><img class="layout-p__sign" … /><button v-if="signDeletable" class="layout-p__sign-del" …>×</button></span
>
```

`.layout-p__signcell { position: relative; display: inline-flex; max-width: 100%; min-width: 0 }`
—— 盒型收缩到图片尺寸，`top:0; right:0` 恰好落在图片右上角（实测单元盒与图片盒逐边相等，
见下方实测表）。贴底对齐随之从图片挪到单元盒
（`.layout-p__signcell--inline { align-self: flex-end }`），
`.layout-p__signs > .layout-p__signcell { flex: 0 0 auto }` 承接原有的「并排图不参与伸缩」。

4 处 `<img>`（复合字段内单图 / 复合字段内多图 / 非复合单图 / 非复合多图）都按此包裹，且**仍然各在
原来那条 `v-if` 链的同一个分支里**——没加独立 `v-if`、没加 `<template v-for>`，「每个分支一个节点」
这条不变式原样保留（独立分支会留下注释占位 / Fragment 锚点，正是 `FieldContainerHtmlRoundTrip`
与 §26 反复强调的坑）。

#### 2. 角标 `.layout-p__sign-del`

与 `.layout-image__del` 同源：`position: absolute; top:0; right:0`、16×16 圆形、
`rgba(220,38,38,.92)`、`visibility: hidden → visible` + `opacity` 悬停浮现、
`@media print { display: none !important }`（**与图片列表角标拆成两条独立规则**，避免任一条改
选择器时让另一条的打印断言静默失配）、不带 `data-field`（不被 `collectFieldValues` 采集）、
`@click.stop`（不冒泡给宿主根上的点击委托）。

入口条件 `signDeletable` = `p` + `mode: "field"` + `valueType: "image"` + 有 `field` + `canFill`
+ `fieldPermissions[field]` 非 `READ`/`HIDDEN`。

#### 3. 事件链与载荷：`index` 必须是**值数组下标**

`GridSchemaNode → GridFormRenderer → FormRenderer` 逐层转发 `sign-remove`，载荷
`SignImageRemovePayloadV2`（`src/types/schema-v2.ts`）：`{ nodeId, field, index, item }`。

**`index` 是值数组下标，不是渲染下标** —— 这是本轮唯一有真实正确性风险的地方：
`resolveSignImageUrlsV2` 会**剔除空串**（避免空占位渲染破图），`["", "a"]` 里 `"a"` 的渲染下标是
0、值数组下标却是 1；宿主若直接 `splice(渲染下标, 1)` 就会**删错人**。

故在 `engine-v2/derivation.ts` 把归一化收敛成**唯一实现**
`resolveSignImageEntriesV2(raw, maxCount) → {index, src}[]`，两个对外解析器从它派生：

- `resolveSignImageUrlsV2` → 只要 `src`（渲染 / 分页沿用，行为逐字节不变）；
- `resolveSignImageUrlIndexesV2` → 只要 `index`（本轮新增，删除事件用）。

渲染层另抽出 `rawSignValue(node)` 给两条路径共用同一份 raw，杜绝「渲染顺序」与「回写下标」
各算各的。`item` 取同一渲染位置的地址，供宿主在值被外部改动后按内容二次定位；边界都写进类型注释：
值本身是单个字符串时 `index` 恒为 0（宿主需先转数组再 `splice`）、`maxCount` 只从尾部截断
（被截掉的项不可能被点到）。

#### 4. 手势排除

`PaperViewport`：`SIGN_IMAGE_SELECTOR` 纳入新增的 `.layout-p__signcell`；另加
`SIGN_DELETE_SELECTOR = ".layout-p__sign-del"` 并进 `EXCLUDE_SELECTOR`。**必须单独列**：角标与
`<img>` 是单元盒下的**兄弟**节点，不在 `.layout-p__sign` 的子树里——`collectExcludeTargets` 用的是
`querySelectorAll`（只匹配后代），单图时签名图选择器兜不住它。

#### 5. 顺带修掉一个既有缺口

`FormRenderer` 的**裸渲染分支**（不带 `PaperViewport` 的那条 `<GridFormRenderer v-else>`）只转发了
`field-change`，漏了 `image-remove`——症状即「关掉视口时图片列表角标点了没反应」。本轮把
`image-remove` 与 `sign-remove` 一并补上。

### 实测（真组件 + 真 scoped CSS + CDP 真鼠标 + 真打印媒体 + before/after 对照）

无头 Chromium 1071 挂**真 `GridSchemaNode`**（`mode="preview"`, `readonly=false`）。为了让
「多包一层盒子不改版式」这句话有证据，同一个组件、同样 props 渲染两份：一份保留新结构（after），
另一份 `cloneNode` 后把 `.layout-p__signcell` **拆掉**（before，等价于升级前的 DOM），分别量几何。

| 观测 | after | before | 结论 |
|---|---|---|---|
| 图片盒（`imageHeight` 缺省） | 69.31 × 20.8 | 69.31 × 20.8 | 一致 |
| 图片内联样式 | `height: 1.6em; max-width: 100%` | 同 | 一致 |
| 图片 `object-fit` / `display` | `contain` / `block` | 同 | 一致 |
| 图片盒（`imageHeight: 12mm`） | 151.14 × 45.34 | 151.14 × 45.34 | 一致 |
| 字段盒 `.layout-p` | 714.13 × 21.8 | 714.13 × 21.8 | 一致 |
| 下划线盒宽（`border-bottom: solid 1px`，复合字段） | 632.36 | 632.36 | 一致 |
| 图底 vs 下划线底 | 差 1.0px（= 那 1px 边框） | 差 1.0px | 一致 |
| 单元盒 vs 图片盒 | dx/dy/dw/dh **全 0** | — | `top/right:0` 即图片右上角 |
| 角标 vs 图片 | `gapRight 0` / `gapTop 0`，16×16，`position: absolute` | — | 正贴右上角 |
| 默认 `visibility` / `opacity` | `hidden` / `0` | — | 悬停才浮现 |
| 真鼠标移到第 2 张图（`elementFromPoint` = `IMG.layout-p__sign`） | 角标 1 → `visible` / `opacity 1`，角标 0 仍 `hidden` | — | 只浮现被悬停的那张 |
| `Emulation.setEmulatedMedia('print')` | 角标 `display: none`、0×0；图仍 69.31 × 20.8 | — | 角标不印、签名照印 |

截图肉眼复核：红色 × 落在被悬停那张签名图的右上角，同组其余图没有角标；after 组与 before 组的
图片尺寸及「图底压在下划线上」的相对位置一致。

### 基线变更（唯一一处）

`FieldPImageValue.test.ts` 的「单张与空值不引入额外锚点节点」曾断言
`shapeOf(.layout-p__input) === ["<img>"]`、且单张图**直接**是容器子项。新增单元盒后这两条不再成立，
已改述为：「容器直接子项仍是**唯一一个** `<span>`（与空态的 `.layout-p__value` 一一对应）」+
「单元盒内过滤掉角标按钮后就是那一个 `<img>`」。**「不引入额外锚点」这条不变式本身没动**——
只是多了一个**有意为之**的盒子。`FieldContainerHtmlRoundTrip` / `FullTicketSnapshot` /
`collectFieldValues` 等既有基线全部不受影响（全票快照里没有签名图，且它按设计态渲染、
角标本就不渲染）。

### 测试守卫

- `__tests__/SignImageDelete.test.ts`（新增 25 例）：入口条件 8 例（预览 / 只读 / 设计态 /
  权限 4 态 / 非签名字段 / 无 `field` / 空值 / 单张结构）、事件载荷 8 例（载荷形状、点哪个删哪个、
  **剔空项后的值数组下标**、单值简写、`maxCount`、内核不改 `data`、无角标不发事件）、
  不污染采集 / 不冒泡 3 例、样式契约 4 例、值下标解析器 2 例。
- `__tests__/PaperViewport.test.ts`：+1 例（46 例）——签名角标与单元盒都打上 `panzoom-exclude`。
- `__tests__/FieldPImageValue.test.ts`：形态断言按上面的「基线变更」更新（19 例仍全绿）。

**反向验证**（9 条探针，逐条在 `src` 的一次性副本上破坏 → 跑测试 → 从 `src` 回写复位；
刻意**不改动受版本控制的文件**，本环境对该类就地改写不可靠）：基线 `0 失败 / 71`；
P1 去掉角标入口闸门 → 5 失败；P2 去掉 `field` 判据 → 1；P3 放开权限闸门 → 1；
P4 `index` 退回渲染下标 → 1；P5 `item` 置空 → 5；P6 去掉 `click.stop` → 1；
P7 去掉打印隐藏 → 1；P8 抽掉手势排除 → 1；P9 去掉单元盒 `position: relative` → 1。
**9/9 变红**，复位后回到 `0 失败 / 71`，且真源码 blob 与探针前逐字节一致。

### 刻意不做

- **不放宽入口条件**：用户拍板「保持现状」——无 `field` 的静态图节点仍然不给删除入口
  （删的是**数据**，不是模板配置）。
- **内核不改 `data`**：同 §28，签名的删除还要走宿主的鉴权 / 留痕 / 提交接口。
- **不合并两条角标规则**：图片列表与签名图各持自己的绝对定位 / 悬停 / 打印规则，
  改一条不会静默影响另一条。
- **宿主侧旧浮动角标（`FdFormRenderer.vue` 的 `.fd-sign-delete`）本轮不动**：那是宿主仓的事。
  内核先把入口做出来，但两套入口并存会导致「同一张签名图上出现两个 ×」——是否撤掉宿主那套、
  或让宿主改用 `sign-remove`，留给宿主侧单独一轮决定。

