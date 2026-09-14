/**
 * 填充数据生命周期：表单数据本身 + 导入 / 导出 / 存本地 / 读本地。
 *
 * 从 `FormDesigner.vue` 抽出（2026-09-07 批次 1 拆分）：只管「表单数据」，
 * 与 schema 存储键隔离（`DATA_STORAGE_KEY` vs `SCHEMA_STORAGE_KEY`）。
 *
 * **导出 / 保存数据不限预览态**（2026-09-11 改）：值一律经 `collectFieldValues` 遍历渲染
 * DOM 采集（薄封装 `collectFormData`），设计态同样有渲染 DOM（字段的默认值），
 * 没有配置任何字段时结果就是 `{}`。
 */
import { computed, reactive, ref, type Ref } from "vue";
import type { FormDataV2 } from "@/types";
import {
  collectFormData,
  downloadJsonFile,
  exportFileName,
  FILL_DATA_EXPORT_PREFIX,
  serializeFormDataJson,
} from "../export-api";

export const DATA_STORAGE_KEY = "ticket-designer-fill-data-v2";

/** 「导出数据」在控制台打印的标签（内容即表单数据 JSON 文本）。 */
export const FILL_DATA_LOG_LABEL = "[ticket-designer] 表单数据 JSON";

export type FillData = ReturnType<typeof useFillData>;

export function useFillData(options: {
  /** 画布根元素：导出/保存时遍历其 DOM 采集字段与值。 */
  canvasEl: Ref<HTMLElement | null>;
  /** 载入数据并进入预览态（含清选中），由宿主编排。 */
  enterPreview: (data: FormDataV2) => void;
}) {
  const previewFormData = reactive<{ value: FormDataV2 | null }>({
    value: null,
  });
  const previewData = computed<FormDataV2 | null>(() => previewFormData.value);
  const fillDataFileInput = ref<HTMLInputElement | null>(null);

  /** 填充数据导入：解析 FormDataV2 JSON 并进入预览态展示填写结果。 */
  function importFillDataFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as FormDataV2;
        // 走 enterPreview 而非直接改 viewMode：避免宿主用种子数据覆盖刚导入的数据。
        options.enterPreview(parsed);
      } catch (error) {
        alert(
          `导入数据失败：${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        input.value = "";
      }
    };
    reader.onerror = () => {
      alert("数据文件读取失败");
      input.value = "";
    };
    reader.readAsText(file);
  }

  function triggerImportFillData(): void {
    fillDataFileInput.value?.click();
  }

  /**
   * 导出表单数据：采集渲染 DOM 里的字段与值（`collectFieldValues` 口径）并下载 JSON。
   *
   * **不限预览态**（2026-09-11）：设计态同样有字段渲染 DOM，采到的是字段默认值；
   * 表单没有配置任何字段（或画布未挂载）时导出 `{}`，不再提前 return。
   */
  function exportFillDataFile(): void {
    try {
      // 「导出数据」外发场景：脱敏字段（HIDDEN）保持 *** 导出（P9.2b 脱敏导出口径）
      const values = collectFormData(options.canvasEl.value, {
        maskHidden: true,
      });
      const json = serializeFormDataJson(values);
      console.log(FILL_DATA_LOG_LABEL, json);
      downloadJsonFile(exportFileName(FILL_DATA_EXPORT_PREFIX), json);
    } catch (error) {
      alert(
        `导出数据失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 保存当前表单数据到本地（仅数据，与 schema 存储键隔离）。
   *
   * **不限预览态**（2026-09-11）：设计态同样有字段渲染 DOM，采到的是字段默认值；
   * 表单没有配置任何字段（或画布未挂载）时保存 `{}`，不再提前 return。
   */
  function saveFillDataToLocal(): void {
    try {
      localStorage.setItem(
        DATA_STORAGE_KEY,
        // 本机「保存数据」：脱敏字段（HIDDEN）从 previewFormData 回源真实值，保存→读取不丢数据
        serializeFormDataJson(
          collectFormData(options.canvasEl.value, {
            baseData: previewFormData.value,
          }),
        ),
      );
    } catch (error) {
      alert(
        `保存数据失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 从本地读取填写数据并进入预览态。 */
  function loadFillDataFromLocal(): void {
    const text = localStorage.getItem(DATA_STORAGE_KEY);
    if (!text) {
      alert("本地没有已保存的填写数据");
      return;
    }
    try {
      options.enterPreview(JSON.parse(text) as FormDataV2);
    } catch (error) {
      alert(
        `读取数据失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    previewFormData,
    previewData,
    fillDataFileInput,
    importFillDataFile,
    triggerImportFillData,
    exportFillDataFile,
    saveFillDataToLocal,
    loadFillDataFromLocal,
  };
}
