# 表单设计器业务设计

> 本文描述嵌套 Schema 下的组件语义和设计器操作。总体架构见 [design.md](./design.md)，
> 渲染算法见 [engine.md](./engine.md)，实施路线见 [development-plan.md](./development-plan.md)。
>
> 本文为业务/交互设计目标（spec）；具体能力是否已实现、当前缺口见 [development-plan.md](./development-plan.md) §2.1；
> P0–P8 阶段详细规格存档见 [archive/phase-specs-p0-p8.md](./archive/phase-specs-p0-p8.md)；文档总索引见 [README.md](./README.md)。

## 1. 产品产物

系统提供两个独立产物：

1. **模板设计器**：通过 UI 编辑数据无关的 FormSchema。
2. **表单预览组件**：接收 schema、data 和 rules，完成填写、查看和打印。

模板设计器是否合格，必须由“UI 构建 → 保存 → 加载 → 填写 → 打印”完整链路验证，
不能只以人工编写 Schema 后 Renderer 能显示作为验收。

## 2. 设计器界面

```text
┌─ 工具栏：纸张 / 边距 / 基础行高 / 预览 / 保存 / 撤销 ───┐
├──────────┬──────────────────────────┬──────────────────┤
│ 组件库   │ 固定纸张画布             │ 配置面板         │
│ Grid     │ 格子辅助线、选中和投放点 │ 页面/行/格/组件  │
│ P        │                          │                  │
│ Table    │                          │                  │
│ HTML     │                          │                  │
│ Image    │                          │                  │
├──────────┴──────────────────────────┴──────────────────┤
│ 节点面包屑 / 缩放 / 结构错误 / 字段与溢出警告           │
└─────────────────────────────────────────────────────────┘
```

画布操作围绕 Page、Grid 和组件进行，不提供绝对坐标定位；GridRow/GridCell 仅作为内部布局槽位。

注：上图为交互目标。当前 `FormDesigner.vue` 工具栏仅提供“新建空白模板 / 载入前五行样例”，纸张、边距、基础行高、预览、保存、撤销等控件尚未接入（见 development-plan P5 / P8 / P9）。

## 3. 节点与选择

Page、Grid、TableCellTemplate 和组件都有唯一 ID；GridRow/GridCell 的 ID 仅用于布局引用。设计器运行时建立节点索引：

选择链只包含 Page、Grid 和实际组件。点击 Cell 空白区域时，选择其所属 Grid；Row/Cell 不会成为 active 节点。
问题列表条目可点击定位：有 nodeId 的选中对应节点，Row/Cell/Template 布局问题或 schema 级问题自动回退选中最近的 Page/Grid 祖先。

节点索引提供按 ID 查询节点、祖先链和所属插槽的 API；Schema 更新后通过计算索引重新派生，避免保留旧对象引用。

```ts
interface EditorNodeRef {
  node: SchemaNode
  parent: SchemaNode | null
  path: Array<string | number>
  ownerCell?: GridCell | TableCellTemplate
}
```

索引用于：

- 根据 ID 选择节点。
- 展示 Page > Grid > Row > Cell > Component 面包屑。
- 确定拖拽源和目标。
- 更新配置面板。
- 生成结构 patch 和撤销记录。

索引不写入 Schema，重新加载后根据嵌套结构重建。

## 4. Grid 业务语义

Grid 是静态布局容器，由 rows 和 cells 构成。

### 4.1 行操作

- 在指定位置新增空行。
- 复制行及其所有子组件，并重新生成后代 ID。
- 删除行及其内容。
- 上下移动行。
- 设置基础行高倍数。
- 将内容过高的行标记为溢出，不自动改变固定高度。

### 4.2 Grid 布局操作

- 选中 Grid 后设置整体行数和列数，自动维护内部布局槽位。
- Grid 内部槽位支持固定 mm、fr 或 auto 宽度，以及 padding、水平和垂直对齐。
- 复杂内容通过在槽位内嵌套 Grid 实现，不把行和格子提升为独立组件。
- 拆分已合并格子。
- 将格子内组件排序。
- 将多个组件包装为子 Grid。

### 4.3 边框

- all：外框和内部格线。
- outer：仅外框。
- inner：仅内部格线。
- none：无边框。

嵌套 Grid 默认不重复绘制父格子的边框。

## 5. P 业务语义

P 有两种互斥模式：

| 模式 | 主要属性 | 设计态 | 预览态 |
|---|---|---|---|
| static | text | 显示固定标签 | 固定显示，不可编辑 |
| field | field、inputType、prefix、suffix | 输入格，可带前后固定标签；字段名写入 data-field 属性 | 填入 data[field] 并按权限编辑 |

约束：

- field P 的字段名不作为可见文本或占位符渲染，只写入组件的 data-field 属性。
- field P 的 `prefix` / `suffix` 用于同一组件内的前后固定标签；只配置 `prefix` 可表达“标签 + 输入器”。
- 切换 field → static 时提示 field 将不再参与数据绑定。
- field 模式未设置字段名时显示结构警告。
- field 重复是软警告，不阻止保存。
- 日期和签名先作为 inputType，不急于新增顶层组件。

## 6. Table 业务语义

Table 用于规则明细，不用于整张表单排版。

设计器必须支持：

- 新增、删除和移动列。
- 设置列 key、标题、宽度和对齐。
- 设置表头高度、数据行高度和最小行数。
- 编辑 rowTemplate 中每个列的子组件。
- 将 P 或子 Grid 放入单元格模板。
- 新建 Table 时，每个列模板默认包含一个 Field P，渲染结构为 `tbody > tr > td > p`；删除默认 P 后可以放置其他组件。

设计态根据 minRows 重复 rowTemplate 作为空数据占位。填写态渲染行数 = `max(minRows, data 中实际出现的最大行号)`：
行模板字段名由渲染期按「列key_行号」自动派生（列 `工作地点` 第 r 行即 `工作地点_r`），data 含 `工作地点_5` 即补渲染第 5 行；中间未填行留空，保证 data 完整可见（非 repeatable 配置属性）。表格内字段不可单独选中/配置，增删列即增删字段。

表格节点本身**不是字段**：表级 `field` 只作标签，不写入 DOM `data-field`，不参与 `collectFieldValues` 采集与 `collectSchemaFields` 字段清单（2026-09-11 修正，此前 `<table data-field>` 会把整表文本采成一个字段值）。

## 7. HTML 与 Image

### 7.1 HTML

- 只允许放在 GridCell 或 TableCellTemplate 中。
- 仅由开发人员在配置面板编辑 HTML + CSS，不涉及 JS。
- 渲染前用 DOMPurify 做引擎级固定清洗（始终执行、无信任开关）；CSS 经 Shadow DOM 隔离，不污染表单。
- 字段用 `{{field}}` 自动绑定 data，无需显式声明。
- 设计器显示 HTML 内容边界和尺寸溢出。

### 7.2 Image

- 固定图片配置 src。
- 动态图片配置 field。
- 支持 width、height、objectFit 和对齐。
- 图片加载失败时设计态显示占位和警告。

## 8. 拖拽规则

允许的投放目标：

- Page.children
- GridCell.children
- TableCellTemplate.children

投放行为：

1. 新组件生成唯一 ID。
2. 插入目标 children 的指定位置。
3. 更新运行时索引。
4. 触发结构校验和溢出测量。
5. 自动选中新组件并打开配置面板。

跨格移动从源 children 删除节点，再插入目标 children。移动容器时后代随嵌套对象整体移动。

禁止：

- 将节点移动到自身后代中。
- 将普通组件作为容器投放目标。
- 未确认时覆盖已有节点。
- 通过 DOM 移动绕过 Schema 更新。

## 9. 删除、复制和包装

### 删除

删除 Grid、Row、Cell、Table 时明确提示包含的后代数量。因为 Schema 是嵌套结构，删除父节点自然删除后代，
但撤销记录必须保存完整子树。删除最后一个 Cell 或最后一个 Row 时，操作必须自动清理空的父 Row/Grid，
不能把 `INVALID_GRID_ROWS` 或 `INVALID_GRID_CELLS` 留给后续操作。

### 复制

深复制节点时重新生成整个子树 ID，field 默认保留并产生可能重复的软警告，用户可批量重命名。

### 包装

当一个格子已有组件而用户需要并排放置第二个组件时，设计器提供“包装为 Grid”：

1. 创建子 Grid。
2. 将现有组件移入第一个 Cell。
3. 创建第二个 Cell。
4. 将新组件放入第二个 Cell。

## 10. 配置面板

配置面板根据节点类型切换：

| 节点 | 配置 |
|---|---|
| Page | 纸张、方向、边距、fixed 模式 |
| Grid | 行数、列数、边框、整体样式 |
| P | mode、text/field、inputType、下划线、文字样式 |
| Table | field、columns、表头/行高、minRows（动态行数由 data 推导，无 repeatable 属性） |
| HTML | html、css（Shadow DOM 隔离，{{field}} 绑定） |
| Image | src/field、尺寸、objectFit |

Grid 的 rows/cells 是内部布局数据，不作为节点链或独立配置节点；结构字段通过 Grid 的专用控件修改，不允许在普通 JSON 文本框里直接编辑 rows/cells/children。

注：当前实现仅覆盖基础子集——Grid（行数/列数/边框）、P（固定文本/字段名/前后标签）、Table（最小行数）；inputType、下划线、文字样式、columns 编辑、HTML/Image 配置尚未接入（见 development-plan §2.1 / P7）。

## 11. 数据与权限

```ts
interface FormPreviewProps {
  schema: FormSchemaV2
  data: Record<string, unknown>
  rules?: Record<string, {
    readonly?: boolean
    hidden?: boolean
    required?: boolean
  }>
}
```

- static P 不访问 data。
- field P 读取和回写 data[field]。
- Table 数据行数由 data 推导（非 schema 属性）：渲染行数 = `max(minRows, data 键中最大行号)`；行模板字段名由渲染期按「列key_行号」自动派生，与 data 逐行键对应。
- readonly 禁止编辑但保留内容。
- hidden 默认隐藏内容并保留固定版式空间，完全折叠需要显式 layoutHidden 规则。
- required 在预览中标记，并在提交时校验。

权限属于流程运行配置，不写入模板 Schema。

### 11.1 交付契约：Schema JSON 与表单数据

设计器对宿主交付两份 JSON（`designer` 入口导出纯函数，`FormDesigner` 实例经 `defineExpose` 亦可直取）：

| 产物 | 形状 | 用途 |
|---|---|---|
| Schema JSON | `FormSchemaV2` | 版式描述；服务端存储后下发给 `FormRenderer` |
| 表单数据 | `{ 字段名: 值 }`，如 `{"单位":"运输队"}` | 表单当前的字段与值；无字段时为 `{}` |

- **取值唯一真源 = `collectFieldValues`**（`renderer-v2/collectFieldValues`）：遍历渲染 DOM 的 `[data-field]` 采集。与消费页渲染采集是**同一份实现**，故设计器导出的数据与消费页采集的数据口径必然一致。
- 普通字段取 `[data-field]` 元素文本、图片字段取 `src`；HTML 模块穿透 Shadow DOM 取 `{{field}}`(data-bind) 与原生 `[data-field]`。
- **没有任何字段元素时返回 `{}`**（不是 `null` / `undefined`），空表单可直接存库。
- 默认**外发口径脱敏**：HIDDEN 字段出 `***`；本机回源真实值用 `{ maskHidden: false, baseData }`。
- 导出是**只读**操作：不修改文档、不写回 schema；数据不落库，每次由宿主现算。
- 工具栏「导出文件」/「导出数据」与这两个 API 是**同一实现**，点击时把对应 JSON `console.log` 到控制台，联调可直接抄走。「导出数据」「保存数据」**均不限预览态**（设计态同样有渲染 DOM，采到的是字段默认值；无字段则 `{}`）。
- 程序化契约见 `FormDesignerExposed`：`getSchema` / `getFormData` / `setSchema` / `exportSchemaFile` / `exportFillDataFile` / `print` / `resetBlank`。`getSchema` / `getFormData` 直接返回原生对象（需 JSON 文本时宿主自行 `JSON.stringify`）；`setSchema` 接受对象或 JSON 文本，载入后重置历史与选中。
- `print` 是**局部打印**（实现 = `vue-print-next`）：只把纸张序列化进同源 iframe 再调起浏览器打印，宿主页面的菜单 / 头部 / 其他区域**不进打印流**。纸张尺寸仍由 `@page` 唯一真源（渲染内核注入）决定，调用方**不要**再自己写 `@page`。实现契约见 [engine.md §19](./engine.md#19-打印实现契约2026-09-11-改为局部打印)。


## 12. 保存、加载和版本

保存流程：

1. 运行 Schema 结构校验。
2. 扫描空 field 和重复 field。
3. 检测固定尺寸溢出：P 文本估算宽度超过所在格子宽度、Page 最小内容高度超过可用高度时给出警告。
4. 清除设计器临时状态和运行时索引。
5. 写入 version 并序列化嵌套 Schema；加载时只接受 V2，并补全兼容默认字段。

加载流程：

1. 读取 version。
2. 执行版本迁移。
3. 校验 Schema。
4. 重建运行时节点索引。
5. 渲染并恢复选择/缩放之外的模板状态。

## 13. 前五行验收场景

本场景与 [development-plan.md](./development-plan.md) P10 的验收步骤**完全一致**，此处按测试人员操作顺序展开，供独立验收时逐项勾选。步骤编号与措辞以 P10 为准，不再另立。

测试人员必须从空白 A4 页面操作：

1. 新建 A4 fixed 模板，基础行高设为 8mm。
2. 创建标题（static P）。
3. 创建外层 Grid，并设置 all 边框；依次配置五个内部行（序号 1–5）的行列数、字段与边框。
4. 将工作任务行（第 5 行）设为 5 倍最小行高。
5. 配置全部 static/field P（含标题、各基本信息行输入格、工作任务内嵌表列）；工作任务左格的“工作任务”标签使用竖排 static P。
6. 在工作任务右格创建两列表格：表头 1、行高 1、minRows 4。
7. 保存并关闭模板。
8. 重新加载模板，并修改任意列宽和标签，确认结构与样式保持正确。
9. 填写测试数据。
10. 打印并与参考 HTML/图片比较。

验收指标与 P10 一致：不修改源码或 JSON、无结构 error、无意外溢出、行高和边框稳定（工作任务行 = 5 倍基础行高）、所有节点可再次选中/移动/配置、数据回写正确、打印尺寸误差 ≤ 0.5mm、主要结构与参考图一致（含左侧“工作任务”竖排、右侧表格表头与 4 行输入格）。

只有全部步骤无需修改源码或手写 JSON 才视为设计器方案成立。

注：本场景即 development-plan P10 的验收用例，步骤一一对应；目前因 P7/P8/P9 未完成尚不能全程通过 UI 完成，缺口见其 §2.1。
