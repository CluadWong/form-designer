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

### 额外属性（params）与点击触发

任何节点（`SchemaNodeBaseV2`）都可带 `params?: Record<string, string>`——设计器里的「额外属性」键值对，
渲染时**原样插到该节点根元素的 HTML 属性**上（页面节点即纸张 `<main>`）：

```html
<div class="layout-p" data-node-id="field-plan-start" data-field="计划工作时间_开始" action="datePicker" date-validate="after:计划工作时间_1"></div>
```

- 内核**不解释任何键**——`action="datePicker"`、`date-validate="..."` 的语义完全归宿主；宿主在填写态自行扫描属性、接管交互与跨字段校验。这是「内核只做表单设计、不碰业务」的落点。
- 渲染前统一过黑名单（`src/utils/node-params.ts`）：丢弃 `on*`（事件）、`data-*`（内核寻址）、保留名（`class`/`style`/`id`/`field`/`src`/`contenteditable`…），以及不匹配 `/^[a-z][a-z0-9_-]*$/` 的名字（含大写驼峰，如 `innerHTML`）；空串值不写属性。**这层过滤是必需的**——直接 `v-bind` 原始对象会把 `on*` 键绑成事件监听器，等于开一条脚本注入通道。

字段另有 1 bit 的 `interactive?: boolean`（取代旧 `action` 闭枚举）：

- 为 `true` 时，内核在**填写态**由**点击字段元素本身** emit `field-activate`，载荷 `{ nodeId, field, params }`，触发权交还宿主（宿主召唤选择器并在回调里回写 data）；表单上不加任何额外按钮。
- 内核只持有「要不要绑点击、发不发事件」这 1 bit，**不持有控件类型词表**——`datePicker` / `date-time` / 宿主自定义属开放集，一律经 `params` 表达，故新增控件类型零内核改动。（唯一的词表出现在「读入旧数据」的迁移里，见下一段。）
- 设计态 / 只读态 / 未配置（或 `false`）不触发；点击与就地输入并存，内核不改 contenteditable 语义。

旧数据的 `action` / `actionParams` 在读入时迁移为 `interactive` + `params`（`src/types/schema-v2-serialization.ts` 的 `migrateLegacyFieldActivation`），导出只写新形态。迁移**顺带把作废的旧词表翻成宿主词表**，存量模板无需宿主改代码即可直接消费：

| 旧 `action` | 迁移后 `params.action` | 说明 |
|---|---|---|
| `date` | `datePicker` | 日期/时间选择器 |
| `upload` | `uploadImg` | 图片上传 |
| `signature` | `uploadImg` | 签名扫件复用图片上传通道（宿主无独立签名分支） |
| `text` / 未配置 | （不写） | 旧内核在 `text` 下本就不触发，故不置 `interactive` |
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
3. 字段绑定：`{{field}}` 在挂载时解析为 shadow 内 `<span data-bind="field">` 占位；填值时引擎经 `host.shadowRoot` 对 `[data-bind]` 逐个 `textContent = data[field]` 原地更新，与 field P / Image 共用 in-place 填值模型（不重建节点）。
4. 放入限制 overflow 的 Cell 容器，由 §12 做溢出检测。
5. **打印时提升 Shadow DOM**：局部打印取内容靠克隆 + 序列化，而克隆**不带走 shadow tree**（DOM 规范行为），
   故送印前把 shadow 里的非 `<style>` 子节点临时移到 host 上、打完移回，并把控件实时值固化进 attribute。
   详见 §19 与 `print-form.ts` 头部注释。

HTML 内部 DOM 不参与普通节点索引；其内部 contenteditable 不回写 FormData（`{{field}}` 绑定由引擎在原地更新）。

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

**Shadow DOM 与控件值**：见 §11 第 5 条——HTML 模块的 shadow 内容与 `input` / `textarea` 实时值
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
