# 表单低代码设计器统一设计文档

> 本文定义固定版式表单设计器的唯一目标架构：嵌套 Grid Schema V2。
>
> 组件业务语义见 [design-biz.md](./design-biz.md)，渲染契约见 [engine.md](./engine.md)，
> 总体说明见 [README.md](../README.md)。若旧文档或代码注释与本文冲突，以本文为准。
>
> 本文为设计目标契约（spec）；总体说明见 [README.md](../README.md)。
> 文档总索引见 [README.md](./README.md)。

## 1. 目标

系统用于设计、填写和打印工作票、审批单、记录表等固定纸张表单。设计器不是自由坐标绘图工具，
而是通过可嵌套格子构造稳定、可编辑、可序列化的 A3/A4 版式。

完成标准不是“人工编写的 Schema 可以渲染”，而是：

1. 用户可以通过设计器 UI 构造目标版式。
2. 设计器导出的 Schema 完整表达结构、字段和打印尺寸。
3. 保存并重新加载后，视觉和编辑能力不丢失。
4. 设计态、填写态和打印态使用同一 Schema 与同一 Renderer。
5. 输入真实数据后，字段位置、行高、边框和分页仍与模板一致。

## 2. 总体架构

```text
Designer
├─ 编辑嵌套 Schema
├─ 维护运行时 ID 索引
└─ 保存 FormSchema
          │
          ▼
GridFormRenderer
├─ 递归渲染 Grid/P/Table/HTML/Image
├─ 检测固定尺寸溢出
└─ 生成纸张 DOM
          │
          ├─ 设计态：选中、格子辅助线、警告
          ├─ 填写态：data/rules、可编辑字段
          └─ 打印态：隐藏辅助 UI，保持业务尺寸
```

核心决策：

- 正式导出和渲染格式使用嵌套 Schema。
- 每个节点仍有稳定唯一 ID。
- 设计器根据嵌套树派生 `id → node/parent/path` 索引，不把索引写入 Schema。
- 静态版式统一由 Grid 表达，不使用绝对定位。
- 固定文字和输入字段统一使用 P，通过 mode 区分。
- Table 只负责规则明细数据。
- HTML 是受控扩展点，不替代结构化模板。
- 固定工作票使用确定行高和 fixed 页面模式。

## 3. Schema 根结构

```ts
interface FormSchemaV2 {
  version: 2
  paper: PaperConfig
  baseRowHeight: number
  pages: PageSchema[]
}

interface PageSchema {
  id: string
  mode: 'fixed'
  margin: EdgeInsets
  children: FormNode[]
}

type FormNode =
  | GridNode
  | PNode
  | TableNode
  | HtmlNode
  | ImageNode
```

`SchemaNodeV2` 只包含 Page 和真正可放置的 FormNode（Grid/P/Table/HTML/Image）。GridRow、GridCell
和 TableCellTemplate 属于布局数据，不能作为独立节点被选择、删除或放入组件库。

### 3.1 为什么选择嵌套 Schema

嵌套结构直接对应设计器中的页面、Grid、行、格子和子组件：

- Renderer 可以递归渲染，不需要先还原 parentId 关系。
- Grid 内部的 Row/Cell 只是布局记录，不是可放置组件；Cell 可以自然包含多个子组件。
- colspan、表格单元格模板和局部复杂布局不依赖脆弱的位置编号。
- 保存的 JSON 可读，便于诊断和人工审查。
- 移动组件就是在两个 children 数组之间移动节点。

扁平 `components[] + parentId/index` 可以作为数据库存储转换格式，但不是设计器和 Renderer 的强制契约。

### 3.2 稳定 ID 与派生索引

Page、Grid 和实际组件（P/Table/HTML/Image）使用稳定组件 ID；GridRow/GridCell/TableCellTemplate 仅使用内部布局引用 ID，不进入选择链与可索引的可选节点。设计器加载 Schema 后，对可选节点建立：

```ts
interface EditorNodeRef<T = SchemaNode> {
  node: T
  parent: SchemaNode | null
  path: Array<string | number>
  slot: 'page' | 'row' | 'cell' | 'table-cell' | null
}

type EditorNodeIndex = Map<string, EditorNodeRef>
```

索引只存在于内存中，用于选中、拖拽、父级面包屑、配置更新和撤销重做。Schema 变化后增量更新或重建。

## 4. Grid 模型

```ts
interface GridNode {
  id: string
  type: 'grid'
  border: 'all' | 'outer' | 'inner' | 'none'
  rows: GridRow[]
  style?: BoxStyle
}

interface GridRow {
  id: string
  height: number
  cells: GridCell[]
}

interface GridCell {
  id: string
  width?: number | `${number}fr` | 'auto'
  colspan?: number
  padding?: number
  align?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
  children: FormNode[]
}
```

Grid 可以同时表达：

- 表单外框：一个包含多行的根 Grid。
- 单位/编号：一行四格。
- 负责人/班组：一行四格，但关闭内部边框。
- 工作班成员：一行五格。
- 设备名称：一行两格。
- 工作任务：一行两格，右格放 Table。
- 更复杂布局：GridCell 中继续放子 Grid。

GridCell 的内部行列布局通过嵌套 Grid 实现，而不是给 Cell 增加第二套行列模型。这样同一列可以拆成多行多列，
每个子格独立放置 Table 或其他组件；例如工作任务的第二格可以包装为三行单列子 Grid，再分别插入三个 Table。

第一阶段支持 colspan，不强制实现 rowspan。跨行视觉结构优先使用父 Grid + 嵌套子 Grid 表达。

设计器创建规则 Grid 时可使用行列快捷配置：

```ts
createGridBySizeV2({ rows: 5, columns: 4, rowHeight: 1 })
```

该 API 只负责生成初始 `rows[].cells[]`；保存后的 Schema 仍使用标准嵌套结构。每个 Cell 的
`children` 可以继续放置 P、Table、HTML、Image 或子 Grid。复杂表单可以先用行列配置生成骨架，
再逐格调整列宽、合并关系和嵌套组件。

## 5. 行高与尺寸

Schema 定义统一基础行高，例如：

```ts
baseRowHeight: 8 // mm
```

实际高度：

```text
GridRow 高度 = baseRowHeight × row.height
Table 表头高度 = baseRowHeight × table.headerHeight
Table 数据行高度 = baseRowHeight × table.rowHeight
```

约束：

- 普通单行使用 `height: 1`。
- 两行输入区域使用 `height: 2`。
- 工作任务由 1 行表头和 4 行数据组成，外层行高度为 5。
- Renderer 必须将行高输出为 CSS `min-height`，允许 Table 的实际内容将父 GridRow 撑开。
- `row.height`、`headerHeight` 和 `rowHeight` 表示最小行高，而不是内容的最大高度；内容超出时继续向下扩展。
- 所有尺寸使用 mm 或明确的 fr/auto 轨道，不依赖视口缩放推导业务尺寸。

## 6. P 模型

```ts
interface PNode {
  id: string
  type: 'p'
  mode: 'static' | 'field'
  text?: string
  field?: string
  prefix?: string
  suffix?: string
  params?: Record<string, string>
  valueType?: 'text' | 'image'
  imageHeight?: string
  /** 多张签名图之间的水平间距（CSS 长度，如 '2mm'、'0.5em'）；缺省 0.5em，单图无效果 */
  gap?: string
  /** 签名图数量上限：>0 生效（超出部分不渲染、不采集、不参与估高）；≤0 或未设 = 不限 */
  maxCount?: number
  underline?: boolean
  innerBorder?: boolean
  width?: string
  default?: string
  style?: TextStyle
}
```

约束：

- static P 必须使用 text，不参与数据绑定。
- field P 必须使用 field，值来自外部 data。
- field P 不渲染占位符，字段名通过 `field` 属性绑定。
- field P 可通过可选 `prefix` / `suffix` 组合为“前标签 + 输入器 + 后标签”；只配置 `prefix` 时即可表达“标签 + 输入器”。
- 控件类型不闭枚举：日期 / 签名等交给宿主，控件类型经 `params.action` 透传（内核只当属性转发、不绑点击、不解释键）——内核于 2026-09-30 起不再 emit 点击相关事件，按字段上的 `data-field` + `params` 由宿主自行接管。
- `valueType` 决定**值的渲染形态**（内核职责，闭枚举）：`text`（缺省）按文本渲染；
  `image` 把 `data[field]` 当图片地址渲染为**坐落在下划线上**的 `<img>`。
- `imageHeight` 给出图片值高度（CSS 长度，如 `10mm`）；**空态也占这个高度**，
  令「未签名 / 已签名」两态下划线位置一致。**缺省 = 与标签（文字行盒）等高**，即
  `.layout-p` 的 `line-height: 1.6`（渲染为 `1.6em`，随纸张「基础字号」自适应：
  13px → 5.50mm、16px → 6.77mm）——签名图与标签水平并排、底边正好压在下划线上，
  宽度按比例、受输入区约束（`object-fit: contain` 不裁不拉，竖长图也不变形）。
  若留空时不设高度，图片会按固有尺寸铺开（实测一张 400×120 的签名图渲染成
  105.83×31.75mm，把原本 5.77mm 的字段行撑到 38.51mm，撑高 6.7 倍）。
- 电子签名场景因此收敛为**一个节点**：`prefix: "负责人签名："` + `underline: true` +
  `params: { action: "signature" }` + `valueType: "image"`。
  空值渲染「负责人签名：____」，宿主回填图片后签名图贴在那条线上。
- **多人签名（2026-09-30）**：`valueType: "image"` 时 `data[field]` 可传**字符串数组**，
  多张签名图**并排落在同一条下划线上**、**溢出自动换行**（需求形态：
  「多人签名：〰️〰️〰️」——一次审批多个签批人各一张）。取值口径：
  - **单值仍是字符串**（`"a.png"`）、多值才是数组（`["a.png","b.png"]`）——两者在
    `resolveSignImageUrlsV2` 里归一：标量包成 `[x]`、`null`/`""` 得 `[]`、数组逐项
    `String()` 后滤掉空串。**单值路径与改动前逐字节一致**（DOM 不变，见下）。
  - `gap` 控多图横向间距（缺省 `0.5em`，随基础字号自适应）；`maxCount` 是渲染层的
    **同一道闸门**——截断后的张数同时决定「渲染几张 / 采集几张 / 估高几张」，不会出现
    「屏幕 3 张、取值 5 个」的错配。
  - 换行宽度由图片自身比例决定，**设计期算不出**（没有固定宽），故分页取
    「每张独占一行」的**保守上界**（宁高估留白、不低估溢出），见 `engine.md` §9。
  - **实测几何**（真实 Chromium 挂载真组件，A4 / 内容宽 183.5mm / 默认 1.6em 图高 5.5mm / 间距 0.5em）：
    单行容量 **7 张**；8 张 → 2 行、16 张 → 3 行；容器高 = 行数 × 图高 + (行数−1) × 间距
    **+ 1px（下划线边框，`border-box`）**；无论几行，**末行底边精确压在签名线上**（偏差 0px）；
    容器高不随单行内张数变化（1 / 3 / 6 / 7 张同为 5.77mm）——即「并排不撑高」。
  - 空态（`[]` / `null` / 不传）与单张仍按一行占位，未签名与已签名两态的**下划线位置不跳动**。

## 7. Table 模型

```ts
interface TableNode {
  id: string
  type: 'table'
  field?: string
  columns: TableColumn[]
  headerHeight: number
  rowHeight: number
  minRows: number
  rowTemplate: TableCellTemplate[]
}

interface TableCellTemplate {
  id: string
  columnKey: string
  align?: 'left' | 'center' | 'right'
  children: FormNode[]
}
```

- columns 定义表头、key 和列宽。
- rowTemplate 定义每一数据行的单元格内容。
- 默认 Table 为 `thead > tr > th` 加 `tbody > tr > td > p`；每个数据列模板默认放置一个 Field P。
- 用户可以删除某个默认 P，再在对应 `td` 中放置其他组件，以覆盖特殊单元格需求。
- minRows 确保空数据时仍有可手写/填写的固定行数。
- 动态行数由 data 推导（非 schema 属性）：渲染行数 = `max(minRows, data 中实际出现的最大行号)`；行模板字段名由渲染期按「列key_行号」自动派生（`bindTableRowCell`：列 `工作地点` 第 r 行即 `工作地点_r`），data 含 `工作地点_5` 即补渲染第 5 行；中间未填行留空，保证 data 完整可见。表格内字段不可单独选中/配置，增删列即增删字段。详见 `src/types/schema-v2-table-rows.ts`。
- 一个单元格需要多个元素时，children 中直接放多个节点或一个子 Grid。
- 静态表单外框、签名区和说明区不使用 Table，统一使用 Grid。

## 8. HTML 与 Image

### 8.1 HTML

HTML 仅处理暂时无法结构化的局部内容：

```ts
interface HtmlNode {
  id: string
  type: 'html'
  html: string
  css?: string
}
```

- HTML 被限制在所属 GridCell 内。
- CSS 经 Shadow DOM 隔离，仅作用本块，不污染表单样式。
- 渲染前由引擎统一用 DOMPurify 清洗，始终剥离 script/事件属性/危险 URL，无信任开关。
- 内部字段用 `{{field}}` 自动绑定 data，无需显式声明。
- 不允许将整张表单放进一个 HTML 节点。

### 8.2 Image（图片列表）

Image 保留 Logo、二维码、盖章区和现场照片能力，形态是**列表**（2026-09-28 由单图改造）：

- 模板：`images: ImageItemV2[]`，每项 `{ name, src, width, height }`（宽高单位 mm，缺省自适应）；
  旧 schema 的单图字段 `src` / `width` / `height` 保留为兼容读取路径：`src` 在面板写入时清除，
  `width` / `height` 则**提升为 `defaultWidth` / `defaultHeight`**（语义正是「整组图默认尺寸」，不静默丢弃）。
- 尺寸有两档，**行内优先**（2026-09-29 补默认档）：
  1. 行内 `images[i].width` / `.height` —— **该张图的渲染尺寸**（`vertical` / `horizontal` 下生效），精确到某一张；
     宽度落在条目盒上、高度落在 `<img>` 本身（同日修正）——盒高必须留给「图片 + 名称」共同撑开，
     否则图片 `height:100%` 会吃满盒高、把同列的名称挤出盒外（被单元格 `overflow:hidden` 裁掉，
     高度小的条目尤其明显）；勾选「显示名称」时名称行计入分页估算（`imageItemHeightMm`，11px × 1.4 一行）；
  2. 节点级 `defaultWidth` / `defaultHeight` —— **整组图的统一尺寸兜底**，某行留空该维时吃默认值
     （如把「与输入框等高的 30×10mm 签名条」配一次即可，不必每行重复填）；
  两档都缺的维度 → 按图片自身比例（`fill` 布局下配置高只提供宽高比，高度由行宽推得）。
  图片与盒子的关系交给 `objectFit`（contain 等比完整显示 / cover 裁剪 / fill 拉伸）。
  尺寸解析统一走 `withImageDefaultsV2`；**采集侧用 `applyDefaults: false`** 只回读「行内 / 数据」的显式尺寸
  —— 默认值不写进字段值，否则之后再改默认宽高对已保存的数据不再生效。
- 取值：`field` 绑定数据字段。数据有值时用**数据内容**，并**按 index 与模板行逐字段合并**
  （数据项缺 `name` / `width` / `height` 时继承模板同序号行，模板行也缺则吃节点默认宽高）
  ——模板行是「样式预设」，数据是「内容」。
  值形态：对象数组 `[{ name, src, width, height }]`、地址字符串数组 `["url"]`，或**单个地址字符串**
  （视为一张图，与模板第 0 行配对；宿主回填单张签名图的最省事形态）。
- 排布：`layout` = `vertical`（默认，一张一行）/ `horizontal`（并排一行）/ `fill`（按宽高比自动换行、行内撑满）。
- 对齐分**两个方向**，各管一个方向、可同时生效（2026-09-29 补垂直，原 `align` 只做水平）：
  - `align` = `left` / `center` / `right`，**水平**位置：垂直布局走 `align-items`（每张图左右）、
    水平布局走 `justify-content`（整行左右）；缺省按布局取默认（垂直居中、水平靠左，见 `derivation.resolveImageAlignV2`）；
  - `verticalAlign` = `top` / `middle` / `bottom`，**垂直**位置：垂直布局走 `justify-content`（整组上下）、
    水平布局走 `align-items`（每行上下）；缺省固定 `top`（= 升级前的 CSS 默认，见 `derivation.resolveImageVerticalAlignV2`）。
    值域与单元格垂直对齐（`cellVerticalAlign`）一致，便于两处共用心智；
  - 两者的缺省值都取「升级前的行为」，故既有 schema 的渲染结果不变；
    `fill` 布局每行被 `flex-grow` 撑满，两个方向都不生效（`align-items: stretch` 是该布局「行内等高、
    图片按比例铺满」的前提，渲染层刻意不覆盖它）。
- `maxCount` 限制张数（未设 / 0 = 不限）；`showName` 控制 `name` 是否画到表单上。
- 唯一真相源 `resolveImageItemsV2`（渲染 / 分页 / 采集三处共用）：整块列表都没有可显示地址时，
  屏幕上保留占位灰框、**打印时不占版面**（分页按 0 高度计）。

## 9. 边框模型

边框由 Grid 控制：

- all：外边框和内部格线。
- outer：只有 Grid 外边框。
- inner：只有相邻 Cell 的内部格线。
- none：不绘制边框。

嵌套时父 GridCell 承担外框，子 Grid 使用 inner/none，避免双边框。Table 只绘制自己的表头和行列内部线，
所属 GridCell 负责外部边界。

## 10. 设计器交互

设计器必须支持：

- 选中 Grid 后调整整体行数、列数和边框。
- Grid 内部保存行高、列宽、padding、对齐等布局数据。
- 向 Cell 拖入 Grid、P、Table、HTML、Image。
- 在 Cell 中调整多个子组件顺序。
- 将已有子组件包装为子 Grid。
- 编辑 P 的 static/field 模式。
- 编辑 Table 列、表头、行高、最小行数和行模板。
- Grid 的行列数量通过右侧属性面板调整；组件库只负责添加 Grid 或实际组件，不提供固定的行/列快捷操作。
- 通过节点树或面包屑选择父级容器。
- 显示结构错误、字段冲突和内容溢出。
- 保存、加载、撤销和重做。

设计器不支持任意绝对坐标拖拽。拖放目标必须是 Page、GridCell 或 TableCellTemplate。

## 11. 渲染与运行时数据

Renderer 直接递归 Schema，不执行持久化结构转换：

```text
Page
└─ Grid
   └─ GridRow
      └─ GridCell
         ├─ P
         ├─ Grid
         ├─ Table
         ├─ HTML
         └─ Image
```

数据保持外置：

```ts
type FormData = Record<string, unknown>
type RulesMap = Record<string, FieldRule>
```

- static P 显示 text。
- field P 读取并回写 data[field]。
- Table 数据行数由 data 推导（非 schema 属性）：渲染行数 = `max(minRows, data 键中最大行号)`；行模板字段名由渲染期按「列key_行号」自动派生（列 `工作地点` 第 r 行即 `工作地点_r`），与 data 逐行键对应；中间未填行留空。
- readonly/hidden/required 由 RulesMap 提供，不写入模板。
- 重复 field 在设计态给出软警告。

## 12. 页面模式与分页

工作票优先使用 fixed 页面模式：

- 一张 Page 对应一张真实纸张。
- Grid 按确定尺寸排版。
- 内容超出 Page 可用区域时给出 PAPER_OVERFLOW，不自动拆散固定布局。
- 多页固定表单使用多个 PageSchema，页面边界由模板明确声明。

动态明细报表后续支持 flow：普通 Grid 作为不可拆分块，Table 按 data 实际行数渲染、可完整行切分并重复表头（动态行数由 data 推导，非 schema 属性）。

## 13. 版本与迁移

V2 是唯一正式模型和唯一设计器入口。旧流式实现属于待移除的历史代码，不再接受新功能扩展，
也不提供旧模式编辑。保存和加载只处理 `version: 2` 的嵌套 Schema。

## 14. 第一阶段验收基线

云铝电气第二种工作票前五行必须满足以下架构判定。其**具体操作步骤与验收指标见 [acceptance-row-spec.md](./acceptance-row-spec.md)**，本文不再另列步骤，避免三处描述出现偏差。

1. 能从空白 A4 页面通过 UI 创建，而不是手写 Schema。
2. 标题、四个基本信息行（单位/编号、负责人/班组、成员、设备名称）和工作任务行结构正确，外层 Grid 带 all 边框。
3. 单行高度一致；工作任务行高度等于 5 个基础行高，左侧“工作任务”竖排，右侧 Table 包含表头和 4 行输入格。
4. 所有输入位置都有独立 field。
5. Schema 保存、重新加载并修改列宽/标签后，结构与样式效果不变。
6. 所有节点仍可被选中、移动和配置。
7. 填入测试数据后能正确回写 data。
8. A4 打印截图与参考 HTML/图片接近，打印尺寸误差不超过 0.5mm。

只有完成上述闭环，才能判断该模型确实能通过设计器实现完整表单。

注：本基线是 P10 验收的架构判定视角。

## 15. 决策记录

1. 嵌套 Schema 是正式导出与渲染格式。
2. 稳定 ID 是节点身份，运行时索引是派生数据。
3. Grid 是静态版式唯一通用容器。
4. P 统一固定文字和输入字段。
5. Table 只处理规则明细。
6. 行高作为最小值；内容自适应撑高时必须保持列、边框和相邻行关系正确。
7. HTML 是受控扩展点，不是模板主格式。
8. UI 构建闭环是架构验收标准，单纯渲染手写 Schema 不算完成。
9. **缩放是「视口外壳」，不是版式的一部分**（2026-10-08）：`PaperViewport` 是纯 slot 组件，
   只吃「宽高 + 内容」、不认识 schema，故可作为公共导出套在**任意**票面外 —— 包括从旧设计器
   （form-create）迁移过来的表单。宿主因此只需一套工具栏、一套百分比语义，不必为两种表单各维护
   一份缩放。配套契约（比例真源在视口 / 百分比是投影 / 命令不走回环）见 `docs/engine.md` §23。
