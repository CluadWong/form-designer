/**
 * 设计器文档状态：schema / 提交与历史 / 本地持久化 / 文件导入导出。
 *
 * 从 `FormDesigner.vue` 抽出（2026-09-07 批次 1 拆分）：只管「文档本身」，
 * 不认识选中、不认识 DOM、不认识视图模式，可脱离组件单测。
 *
 * 使用方通过 `commit()` 提交新的不可变 schema；结构性改动不带 tag（各自独立
 * 撤销步），检查器输入带 per-node tag（800ms 内连续输入合并为一步）。
 */
import { computed, ref, watch, type Ref } from "vue";
import {
  createEmptyFormSchemaV2,
  createGridNodeV2,
  insertRootGridV2,
  parseFormSchemaV2,
  serializeFormSchemaV2,
} from "@/types";
import type { FormSchemaV2 } from "@/types";
import {
  downloadJsonFile,
  exportFileName,
  SCHEMA_EXPORT_PREFIX,
  serializeSchemaJson,
} from "../export-api";

/**
 * 「导出文件」在控制台打印的标签。宿主联调时用它一眼认出设计器的输出，
 * 也便于自动化脚本按前缀捕获（`console.log` 内容即 schema JSON 文本）。
 */
export const SCHEMA_LOG_LABEL = "[ticket-designer] schema 配置 JSON";

export const SCHEMA_STORAGE_KEY = "ticket-designer-schema-v2";

const MAX_HISTORY = 100;
/** 同一 tag 在该时间窗内的连续提交合并为一个撤销步（检查器逐键输入）。 */
const COALESCE_WINDOW_MS = 800;

/** 空白初始化：空 page + 一个根 Grid，便于用户从空白开始设计。 */
export function buildBlankSchema(): FormSchemaV2 {
  const blank = createEmptyFormSchemaV2();
  const grid = createGridNodeV2();
  return insertRootGridV2(blank, grid);
}

export interface SchemaDocument {
  schema: Ref<FormSchemaV2>;
  dirty: Ref<boolean>;
  canUndo: Ref<boolean>;
  canRedo: Ref<boolean>;
  fileInput: Ref<HTMLInputElement | null>;
  commit: (next: FormSchemaV2, tag?: string) => void;
  resetHistory: (next: FormSchemaV2) => void;
  undo: () => void;
  redo: () => void;
  saveToLocal: () => void;
  loadFromLocal: () => void;
  exportFile: () => void;
  importFile: (event: Event) => void;
  triggerImport: () => void;
}

export interface SchemaDocumentOptions {
  /**
   * 整份文档被替换后（读取本地 / 导入文件）的回调：宿主通常在此清空选中，
   * 否则选中态会指向已不存在的节点。
   */
  onReset?: () => void;
}

export function useSchemaDocument(
  initialSchema?: FormSchemaV2,
  options: SchemaDocumentOptions = {},
): SchemaDocument {
  const schema = ref<FormSchemaV2>(
    initialSchema
      ? (JSON.parse(JSON.stringify(initialSchema)) as FormSchemaV2)
      : buildBlankSchema(),
  );
  const dirty = ref(false);
  const undoStack = ref<FormSchemaV2[]>([]);
  const redoStack = ref<FormSchemaV2[]>([]);
  const fileInput = ref<HTMLInputElement | null>(null);

  let lastCommitTag = "";
  let lastCommitTime = 0;

  // 任何 schema 赋值（所有操作都是不可变的）都标记文档已改动。
  watch(
    schema,
    () => {
      dirty.value = true;
    },
    { flush: "sync" },
  );

  function commit(next: FormSchemaV2, tag?: string): void {
    const now = Date.now();
    if (
      tag &&
      tag === lastCommitTag &&
      now - lastCommitTime < COALESCE_WINDOW_MS
    ) {
      schema.value = next;
    } else {
      undoStack.value.push(schema.value);
      if (undoStack.value.length > MAX_HISTORY) undoStack.value.shift();
      redoStack.value = [];
      schema.value = next;
      lastCommitTag = tag ?? "";
    }
    lastCommitTime = now;
  }

  /** 整份替换（载入样例 / 导入 / 新建空白）并重置历史。 */
  function resetHistory(next: FormSchemaV2): void {
    undoStack.value = [];
    redoStack.value = [];
    lastCommitTag = "";
    schema.value = next;
    dirty.value = false;
  }

  function undo(): void {
    const prev = undoStack.value.pop();
    if (!prev) return;
    redoStack.value.push(schema.value);
    schema.value = prev;
    lastCommitTag = "";
    dirty.value = true;
  }

  function redo(): void {
    const next = redoStack.value.pop();
    if (!next) return;
    undoStack.value.push(schema.value);
    schema.value = next;
    lastCommitTag = "";
    dirty.value = true;
  }

  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);

  function saveToLocal(): void {
    try {
      localStorage.setItem(
        SCHEMA_STORAGE_KEY,
        serializeFormSchemaV2(schema.value, true),
      );
      dirty.value = false;
    } catch (error) {
      alert(
        `保存失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  function loadFromLocal(): void {
    const text = localStorage.getItem(SCHEMA_STORAGE_KEY);
    if (!text) {
      alert("本地没有已保存的模板");
      return;
    }
    try {
      resetHistory(parseFormSchemaV2(text));
      options.onReset?.();
    } catch (error) {
      alert(
        `读取失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  function exportFile(): void {
    try {
      // 取值走交付 API `serializeSchemaJson`（与 `getSchema` 同源，纯序列化无副作用），
      // 下载实现收口在 `export-api.ts`。控制台同步打印，便于联调直接抄走配置。
      const json = serializeSchemaJson(schema.value);
      console.log(SCHEMA_LOG_LABEL, json);
      downloadJsonFile(exportFileName(SCHEMA_EXPORT_PREFIX), json);
    } catch (error) {
      alert(
        `导出失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  function importFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resetHistory(parseFormSchemaV2(String(reader.result)));
        options.onReset?.();
      } catch (error) {
        alert(
          `导入失败：${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        input.value = "";
      }
    };
    reader.onerror = () => {
      alert("文件读取失败");
      input.value = "";
    };
    reader.readAsText(file);
  }

  function triggerImport(): void {
    fileInput.value?.click();
  }

  return {
    schema,
    dirty,
    canUndo,
    canRedo,
    fileInput,
    commit,
    resetHistory,
    undo,
    redo,
    saveToLocal,
    loadFromLocal,
    exportFile,
    importFile,
    triggerImport,
  };
}
