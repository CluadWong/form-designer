<script setup lang="ts">
import { computed, ref, watch, provide, onMounted, onUnmounted, nextTick } from "vue";
import CanvasSurface from "./CanvasSurface.vue";
import PaperViewport from "@/components/renderer-v2/PaperViewport.vue";
import { PALETTE_DRAG_MIME } from "@/engine-v2/node-address";
import type { SampleEntry } from "@/samples/types";
import type { DesignerUIConfig } from "./config";
import { setLocale, DEFAULT_LOCALE } from "@/i18n";
/** D2：打印触发收口到渲染内核，设计器不再裸调 `window.print()`。 */
import { printForm } from "@/components/renderer-v2/print-form";
/** 表单数据采集口径类型（`getFormData` 的脱敏 / 回源开关）。 */
import type { CollectFieldValuesOptions } from "@/components/renderer-v2";
import { validateFormSchemaV2 } from "@/types";
import type { FormDataV2, FormSchemaV2 } from "@/types";
import {
  collectFormData,
  normalizeIncomingSchema,
  type FormDesignerExposed,
} from "./export-api";
import { paginateSchema } from "@/engine-v2/pagination";
import StatusBar from "./StatusBar.vue";
import DesignerToolbar from "./DesignerToolbar.vue";
import PaletteSidebar from "./PaletteSidebar.vue";
import InspectorPanel from "./InspectorPanel.vue";
import HelpPanel from "./HelpPanel.vue";
// 批次 4（2026-09-08）：共用控件样式上移到宿主引入——批次 3 后 DesignerToolbar /
// PaletteSidebar / InspectorPanel 都依赖这些非 scoped 类，挂在 InspectorPanel 上
// 会造成「宿主壳层样式依赖右侧面板引入」的错误归属与时序耦合。
import "./styles/designer-ui.css";
import {
  buildBlankSchema,
  useSchemaDocument,
} from "./composables/useSchemaDocument";
import { useNodeSelection } from "./composables/useNodeSelection";
import { useSchemaEdits, type NodeKind } from "./composables/useSchemaEdits";
import { useFillData } from "./composables/useFillData";
import { TreeControlKey, type TreeControl } from "./composables/treeControl";

const props = defineProps<{
  initialSchema?: FormSchemaV2;
  /** 可载入的样例集（由外层注入，设计器不依赖 dev 目录，见 B3）。 */
  samples?: SampleEntry[];
  /** 全局 UI 配置（设计页可见性开关）：缺省见 `defaultDesignerUIConfig`，
   *  默认显示全部模块（含「填充数据」组）；宿主可局部传 `false` 关闭。 */
  uiConfig?: Partial<DesignerUIConfig>;
}>();

// 全局配置的语言注入 i18n（默认简体中文；宿主 `uiConfig.locale` 切换整页语言）。
watch(
  () => props.uiConfig?.locale,
  (loc) => setLocale(loc ?? DEFAULT_LOCALE),
  { immediate: true },
);

/**
 * 本文件是设计器**编排层**（2026-09-07 批次 1 拆分后）：装配四个 composable 并接线到模板，
 * 自身不再持有文档 / 选中 / 编辑 / 填充数据的实现细节。
 * - `useSchemaDocument`：schema、提交与历史、持久化、文件导入导出；
 * - `useNodeSelection`：选中态、层级循环选中、结构树；
 * - `useSchemaEdits`：一切「改 schema」的动作（节点增删、Inspector 属性更新）；
 * - `useFillData`：预览态表单数据的导入 / 导出 / 存本地 / 读本地。
 */

// ── 视图状态 ────────────────────────────────────────────────
/**
 * - `design`：设计态，可编辑结构、可选中/添加组件；
 * - `preview`：**结构只读的交互填充态** —— 带数据渲染，不可添加/选中/重排组件，
 *   但字段 P 仍按同一 `<p>` 路径可编辑（值经 DOM 遍历采集）。
 */
type ViewMode = "design" | "preview";
const viewMode = ref<ViewMode>("design");
/** 非设计态：结构一律不可编辑（不可选中、不可拖拽、不可添加/删除组件）。 */
const previewMode = computed(() => viewMode.value !== "design");
/** 统一编辑闸门（C1）：仅设计态可改结构；结构性编辑动作经此单一判定。 */
const editable = computed(() => !previewMode.value);
/**
 * 分页开关（默认开启）：开启后渲染器按纸张正文高度把超高内容切成多张物理页。
 * 关闭时整页连续渲染（便于整体排版时查看连续结构）。**打印/预览始终分页**，
 * 此开关只影响设计态画布。
 */
const paginate = ref(true);
/** localStorage 键：帮助面板「已看过首次引导」标记（命名跟随 ticket-designer-* 惯例）。 */
const HELP_SEEN_STORAGE_KEY = "ticket-designer-help-seen-v1";

/**
 * 是否已看过首次使用引导。localStorage 不可用（隐私模式等）时视为未看过——
 * 宁可多弹一次引导，也不让它永不出现。
 */
function hasSeenHelpOnce(): boolean {
  try {
    return localStorage.getItem(HELP_SEEN_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/** 关闭帮助面板并落「已看过」标记，保证首次使用引导只出现一次。 */
function closeHelp(): void {
  helpOpen.value = false;
  try {
    localStorage.setItem(HELP_SEEN_STORAGE_KEY, "1");
  } catch {
    // 标记写不进（配额/隐私模式）时静默降级：下次会话引导会再弹，不影响本次关闭。
  }
}

/** 应用内帮助面板开关：工具栏「帮助」按钮触发；首次挂载若无已读标记则默认弹出（首次使用引导）。 */
const helpOpen = ref(!hasSeenHelpOnce());
const canvasEl = ref<HTMLElement | null>(null);

// ── 文档：schema / 历史 / 持久化 ────────────────────────────
// `onDocumentReset` 在装配出 `clearSelection` 后赋值，此处先给空实现避免声明顺序问题。
let onDocumentReset: () => void = () => {};
const schemaDoc = useSchemaDocument(props.initialSchema, {
  onReset: () => onDocumentReset(),
});
const {
  schema,
  dirty,
  canUndo,
  canRedo,
  fileInput,
  commit,
  resetHistory,
  saveToLocal,
  loadFromLocal,
  exportFile,
  importFile,
  triggerImport,
} = schemaDoc;

// ── 选择态 ──────────────────────────────────────────────────
const selection = useNodeSelection(schema, { editable: () => editable.value });
const {
  selectedNodeId,
  selectedNode,
  selectedNodeType,
  selectedCellContext,
  selectedCellBox,
  nodeTree,
  clearSelection,
  selectNode,
  selectNodeById,
  selectIssue,
} = selection;
onDocumentReset = clearSelection;

/** 结构树「删除」按钮完整禁用态（批次 3 拆件后由宿主计算传给 PaletteSidebar）。 */
const canRemoveSelected = computed(
  () =>
    editable.value &&
    selectedNodeId.value !== null &&
    selectedNode.value?.type !== "page" &&
    selectedNode.value?.type !== "grid-cell",
);

// ── 结构树全局折叠 / 展开 + 定位（provide 下发信号，NodeTreeItem 经 inject 接收）──
const treeControl: TreeControl = {
  token: ref(0),
  target: ref(true),
  focusId: ref<string | null>(null),
  focusToken: ref(0),
};
provide(TreeControlKey, treeControl);
/**
 * 折叠全部：置 target=false 并自增 token，驱动所有节点收起。
 * 同时清 `focusId`：否则子节点被重新挂载时 `immediate` 的定位判断会拿旧焦点
 * 把整条祖先链又展开回来（用户刚点的「折叠全部」等于失效）。
 */
function collapseAll(): void {
  treeControl.target.value = false;
  treeControl.focusId.value = null;
  treeControl.token.value++;
}
/** 展开全部：置 target=true 并自增 token，驱动所有节点展开。 */
function expandAll(): void {
  treeControl.target.value = true;
  treeControl.focusId.value = null;
  treeControl.token.value++;
}
/**
 * 左侧结构树定位（2026-09-11）：选中节点一变（画布点选 / 问题面板定位 / 树内互选）
 * 就下发 focus 信号 —— 各 `NodeTreeItem` 自行展开祖先链（把目标行渲染出来），
 * `PaletteSidebar` 负责就近滚动到可见。此处只发信号，不碰 DOM。
 *
 * `flush: "sync"` 是必需的，不是风格问题：默认 `pre` 会把回调推迟到下一轮 flush，
 * 于是「挂载时自动选中首个页面」这个信号会在**用户随后的操作之后**才落地 ——
 * 实测表现为「刚启动立刻点『折叠全部』，页面节点又被旧信号展开」，让折叠失效。
 * 同步下发把它钉在选中发生的那一刻，之后的折叠/展开可以安心覆盖它。
 */
watch(
  selectedNodeId,
  (id) => {
    treeControl.focusId.value = id;
    if (!id) return;
    treeControl.focusToken.value++;
  },
  { flush: "sync" },
);

// ── 结构编辑动作 ───────────────────────────────────────────
const edits = useSchemaEdits({
  document: schemaDoc,
  selection,
  editable: () => editable.value,
  clearSelection,
});
const {
  addRootGrid,
  addGrid,
  addNodeToSelectedCell,
  removeSelectedNode,
  copySelected,
  cutSelected,
  pasteClipboard,
  duplicateSelected,
  mergeSelectedCellRight,
  splitSelectedCell,
  onCanvasNodeDragStart,
  onDropNode,
  onDropPalette,
  updateSelectedText,
  updateSelectedField,
  updateSelectedPrefix,
  updateSelectedSuffix,
  updateSelectedWidth,
  updateSelectedDefault,
  updateSelectedInnerBorder,
  updateGridBorder,
  updateTableBorder,
  updateGridDimensions,
  updateTableRows,
  addTableColumn,
  removeTableColumn,
  renameTableColumnKey,
  updateTableColumn,
  updateGridColumnWidth,
  updateGridCellDefault,
  updateGridGap,
  updateSelectedCellPadding,
  updateSelectedCellAlign,
  updateSelectedCellVerticalAlign,
  updateSelectedCellRowHeight,
  updateSelectedFontSize,
  updateSelectedLineHeight,
  updateSelectedFontWeight,
  updateSelectedColor,
  updateSelectedFontFamily,
  updateSelectedAlign,
  updateSelectedVerticalAlign,
  updateSelectedHtml,
  updateSelectedCss,
  updateSelectedImageSrc,
  updateSelectedImageField,
  updateSelectedImageSize,
  updateSelectedImageFit,
  updateBaseRowHeight,
  updatePaperSize,
  paperMarginTop,
  paperMarginRight,
  paperMarginBottom,
  paperMarginLeft,
  updatePaperMarginSide,
} = edits;

// ── 填充数据（预览态） ─────────────────────────────────────
const fillData = useFillData({
  canvasEl,
  enterPreview: (data) => enterPreview(data),
});
const {
  previewFormData,
  previewData,
  fillDataFileInput,
  importFillDataFile,
  triggerImportFillData,
  exportFillDataFile,
  saveFillDataToLocal,
  loadFillDataFromLocal,
} = fillData;

/** 载入数据并进入预览态（清选中，避免残留设计态选中）。 */
function enterPreview(data: FormDataV2): void {
  previewFormData.value = data;
  viewMode.value = "preview";
  clearSelection();
}

/** 在「设计 / 预览」之间切换；再次点击同一模式则回到设计态。 */
function toggleViewMode(mode: "preview"): void {
  if (viewMode.value === mode) {
    viewMode.value = "design";
    previewFormData.value = null;
    return;
  }
  // 预览不再注入预置种子数据（2026-09-08）：进入预览即为空表单，
  // 填写值由用户就地输入或经「导入数据 / 读取数据」产生。
  enterPreview({});
}

/** 撤销 / 重做：文档回退后清空选中（旧节点可能已不存在）。 */
function undo(): void {
  schemaDoc.undo();
  clearSelection();
}

function redo(): void {
  schemaDoc.redo();
  clearSelection();
}

/**
 * 打印：触发走渲染内核统一入口（`printForm`），呈现（`@page` 纸张 + `@media print` 样式）
 * 亦由渲染内核负责——两者同层，设计器不再各自 `window.print()`（D2）。
 *
 * 传入本设计器的画布作为**打印根**：只把其中的纸张（`.grid-form-paper`）序列化进同源 iframe
 * 打印，宿主页面其余部分（工单页菜单 / 头部 / 其他区域）不进打印流。
 *
 * ⚠️ 打印必须强制分页：屏幕可能为「连续编辑视图」（`paginate` 关闭，便于整页编辑），
 * 但若直接打印那张单张、超高的纸，内容会溢出 `@page` 尺寸、多出空白尾页（即「纸越来越高、不分页、
 * 打印多一页空白」的根因）。故打印前临时把分页打开，等 `printForm` 同步完成纸张序列化后再还原，
 * 屏幕编辑态不受影响。
 */
async function printDocument(): Promise<void> {
  const wasPaginating = paginate.value;
  if (!wasPaginating) {
    paginate.value = true;
    await nextTick();
    await nextTick();
  }
  printForm({ root: canvasEl.value });
  if (!wasPaginating) {
    paginate.value = false;
  }
}

/** 载入一个注入的样例（B3：样例来自 props 注册表，设计器不依赖 dev 目录）。 */
function loadSample(sample: SampleEntry): void {
  resetHistory(sample.loadSchema());
  clearSelection();
}

function resetBlank(): void {
  // 空白初始化默认配一个 Grid 作为根部（用户要求），仍从空 page 起算。
  resetHistory(buildBlankSchema());
  clearSelection();
}

/**
 * 模板拖拽起点（落点判定 / 插入指示 / 合法投放格计算在表面层 CanvasSurface，
 * 见 A6 分层重构）：本壳层只写拖拽数据，drop 后由 `onDropPalette` 提交 schema。
 */
function startPaletteDrag(kind: NodeKind, event: DragEvent): void {
  if (!editable.value) return;
  event.dataTransfer?.setData(PALETTE_DRAG_MIME, kind);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
}

// ── 派生：校验与分页（供状态栏与问题列表） ─────────────────
const issues = computed(() => validateFormSchemaV2(schema.value));
const warningCount = computed(() => issues.value.length);
/**
 * 分页结果（纯函数、DOM 无关）：用于状态栏暴露「实际会打印几张纸」与超高告警。
 *
 * 与渲染内核 `GridFormRenderer` 调的是**同一个** `paginateSchema` 且入参口径一致，
 * 因此状态栏数字与画布物理页必然一致，不会两处各算一套而漂移。
 */
const pagination = computed(() =>
  paginateSchema(schema.value, { data: previewData.value }),
);

// ── 快捷键与离开确认 ───────────────────────────────────────
/** 焦点在表单控件 / 可编辑区内时，快捷键让位给浏览器原生（文本复制、撤销、退格等）。 */
function isTypingTarget(event: KeyboardEvent): boolean {
  const t = event.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    t.isContentEditable
  );
}

function onKeydown(event: KeyboardEvent): void {
  // 输入框 / contenteditable 内：全部让位原生（含 Ctrl+Z/S/C/V）
  if (isTypingTarget(event)) return;
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (mod) {
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      undo();
    } else if ((key === "z" && event.shiftKey) || key === "y") {
      event.preventDefault();
      redo();
    } else if (key === "s") {
      event.preventDefault();
      saveToLocal();
    } else if (key === "c") {
      event.preventDefault();
      copySelected();
    } else if (key === "x") {
      event.preventDefault();
      cutSelected();
    } else if (key === "v") {
      event.preventDefault();
      pasteClipboard();
    } else if (key === "d") {
      event.preventDefault();
      duplicateSelected();
    }
    return;
  }
  // 无修饰键：Delete / Backspace 删除选中（仅设计态）
  if ((key === "delete" || key === "backspace") && editable.value) {
    event.preventDefault();
    removeSelectedNode();
  }
}

function beforeUnload(event: BeforeUnloadEvent): void {
  if (dirty.value) {
    event.preventDefault();
    event.returnValue = "";
  }
}

onMounted(() => {
  // 默认选中首个页面节点，使右侧「页面设置」（纸张/边距/行高/分页）开箱即可见
  if (schema.value.pages.length > 0) {
    selectNodeById(schema.value.pages[0].id);
  }
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("beforeunload", beforeUnload);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("beforeunload", beforeUnload);
});

// ── 对外交付：schema 配置 / 表单数据（程序化契约见 export-api.ts）──
/**
 * 当前 schema 的**深拷贝**。刻意不返回内部引用：宿主拿到后想怎么改（加字段、裁节点）
 * 都不该污染设计器的编辑状态；要让它生效就 `setSchema` 回灌。
 */
function getSchema(): FormSchemaV2 {
  return JSON.parse(JSON.stringify(schema.value)) as FormSchemaV2;
}

/**
 * 当前表单的**字段与值** `{ 字段名: 值 }`。
 *
 * 走 `collectFieldValues`（与渲染期同一份 DOM 遍历采集器），所以设计态 / 预览态
 * 就地输入的内容都能拿到；没有配置任何字段时返回 `{}`。默认按「导出数据」的外发
 * 口径脱敏（`maskHidden`），与工具栏「导出数据」按钮完全同口径。
 */
function getFormData(options?: CollectFieldValuesOptions): FormDataV2 {
  return collectFormData(canvasEl.value, {
    maskHidden: true,
    ...options,
  });
}

/** 载入一份 schema（对象或 JSON 文本）并重置历史与选中——宿主「编辑既有表单」的入口。 */
function setSchema(next: FormSchemaV2 | string): void {
  resetHistory(normalizeIncomingSchema(next));
  clearSelection();
}

/**
 * 导出 schema 文件：与工具栏「导出文件」**同一实现**（`useSchemaDocument.exportFile`，
 * 内含 `serializeSchemaJson` 取值与控制台打印）。宿主经 ref 调用与点按钮完全等价。
 */
function exportSchemaFile(): void {
  exportFile();
}

defineExpose<FormDesignerExposed>({
  getSchema,
  getFormData,
  setSchema,
  exportSchemaFile,
  // 「导出数据」与工具栏同一实现（`useFillData.exportFillDataFile`，含 console 打印）
  exportFillDataFile,
  print: printDocument,
  resetBlank,
});
</script>

<template>
  <div class="v2-designer">
    <DesignerToolbar
      :samples="samples"
      :dirty="dirty"
      :can-undo="canUndo"
      :can-redo="canRedo"
      :preview-mode="previewMode"
      :ui-config="uiConfig"
      @reset-blank="resetBlank"
      @load-sample="loadSample"
      @undo="undo"
      @redo="redo"
      @save-template="saveToLocal"
      @load-template="loadFromLocal"
      @export-template="exportFile"
      @import-template="triggerImport"
      @import-fill-data="triggerImportFillData"
      @export-fill-data="exportFillDataFile"
      @load-fill-data="loadFillDataFromLocal"
      @save-fill-data="saveFillDataToLocal"
      @toggle-preview="toggleViewMode('preview')"
      @print="printDocument"
      @help="helpOpen = true"
    />

    <div class="v2-designer__body">
      <PaletteSidebar
        :editable="editable"
        :can-remove="canRemoveSelected"
        :node-tree="nodeTree"
        :selected-node-id="selectedNodeId"
        @add-node="addNodeToSelectedCell"
        @add-grid="addGrid"
        @palette-drag="startPaletteDrag"
        @select="selectNodeById"
        @remove-selected="removeSelectedNode"
        @collapse-all="collapseAll"
        @expand-all="expandAll"
      />

      <main
        ref="canvasEl"
        class="v2-canvas"
        :class="{ 'v2-canvas--preview': previewMode }"
        @click="selectNode"
      >
        <PaperViewport :fit-on-mount="false">
          <CanvasSurface
            :schema="schema"
            :mode="previewMode ? 'preview' : 'design'"
            :selected-node-id="previewMode ? null : selectedNodeId"
            :data="previewData"
            :readonly="false"
            :bare="true"
            :paginate="previewMode || paginate"
            @node-drag-start="onCanvasNodeDragStart"
            @drop-node="onDropNode"
            @drop-palette="onDropPalette"
          />
        </PaperViewport>
      </main>

      <InspectorPanel
        v-model:paginate="paginate"
        :node="selectedNode"
        :node-id="selectedNodeId"
        :node-type="selectedNodeType"
        :cell-context="selectedCellContext"
        :cell-box="selectedCellBox"
        :issues="issues"
        :api="edits"
        :paper-size="schema.paper.size"
        :base-row-height="schema.baseRowHeight"
        :paper-margin-top="paperMarginTop"
        :paper-margin-right="paperMarginRight"
        :paper-margin-bottom="paperMarginBottom"
        :paper-margin-left="paperMarginLeft"
        :header="schema.paper.header"
        :footer="schema.paper.footer"
        @select-issue="selectIssue"
      />
    </div>

    <StatusBar
      :page-count="schema.pages.length"
      :warning-count="warningCount"
      :physical-page-count="pagination.pages.length"
      :paginate-warning-count="pagination.warnings.length"
    />

    <!-- 隐藏 file input 留在宿主（批次 3 拆件）：useSchemaDocument / useFillData 直接持有其 ref。 -->
    <input
      ref="fileInput"
      type="file"
      accept=".json,application/json"
      class="v2-toolbar__file"
      @change="importFile"
    />
    <input
      ref="fillDataFileInput"
      type="file"
      accept=".json,application/json"
      class="v2-toolbar__file"
      @change="importFillDataFile"
    />

    <HelpPanel :open="helpOpen" @close="closeHelp" />
  </div>
</template>

<style scoped>
.v2-designer {
  display: grid;
  /* 中排用 minmax(0, 1fr)：`1fr` 的隐式最小尺寸是 auto，容器被压矮时会被内容顶住，
     写成 minmax(0, 1fr) 才允许画布区真正收缩（与 __body 的 min-height: 0 配套）。 */
  grid-template-rows: 48px minmax(0, 1fr) 28px;
  /* 高度吃满宿主容器，**不写死 100vh**（2026-09-10 修）：
     宿主若有页头 / 侧栏 / tab，100vh 会把组件撑出 wrapper，整页出现滚动条，
     status-bar 与「纸张缩放条」被挤出可视区，必须滚到底才看得见。
     前提：宿主容器链路必须有**确定高度**，三种接法任选其一 ——
       ① flex 宿主：祖先链 `display:flex; flex-direction:column; min-height:0`，本组件自然撑满；
       ② 固定高宿主：`.host { height: calc(100vh - <页头高>) }`；
       ③ 兜底：任一祖先上设 `--v2-designer-height`（如 `calc(100vh - 56px)`），
          组件拿不到确定高度时用它顶上。 */
  height: var(--v2-designer-height, 100%);
  min-height: 0;
  overflow: hidden;
  background: #f3f4f6;
}

/* 批次 3 壳层拆件（2026-09-08）：工具栏样式随 DesignerToolbar、左栏样式随
   PaletteSidebar 迁出；`.v2-toolbar` / `.v2-sidebar` 基础样式本就在非 scoped
   `styles/designer-ui.css`。此处仅保留宿主布局与隐藏 file input 样式；
   原 `.v2-toolbar__meta` / `.v2-toolbar__control*` / `.v2-grid-size-control*`
   为无模板引用的死样式，已随之删除（批次 4 CSS 收敛的一部分）。 */
.v2-toolbar__file {
  display: none;
}

.v2-designer__body {
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr) 360px;
  min-height: 0;
}

.v2-canvas {
  min-width: 0;
  overflow: hidden;
}

/* 落点高亮样式已随拖拽逻辑一并下沉至 CanvasSurface（A6）。 */

/* 打印纸张尺寸（`@page { size: Wmm Hmm }`）**不在此处写死**：
   它由渲染内核 `GridFormRenderer` 按 `schema.paper` 运行时注入（见 `page-size-style.ts`）。
   此前这里硬编码 `@page { size: A4 }`，导致切到 A3 横向后屏幕渲染 420×297mm 正常、
   打印却仍按 A4 出页、内容被裁切（P11-3 修复）。 */

@media print {
  :deep(.status-bar) {
    display: none !important;
  }

  .v2-designer,
  .v2-designer__body,
  .v2-canvas {
    display: block;
    height: auto;
    overflow: visible;
  }
}
</style>
