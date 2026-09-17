import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { GridFormRenderer } from "@/components/renderer-v2";
import { buildBlankSchema } from "@/components/designer/composables/useSchemaDocument";
import { parseFormSchemaV2, type FormSchemaV2 } from "@/types";
import schemaJson from "@/fixtures/ticket-schema-v2-1789525251312.json";

const importedSchema: FormSchemaV2 = parseFormSchemaV2(schemaJson as unknown);

const PX_PER_MM = 96 / 25.4;
/** 模拟真实渲染行高（多行字段 / 换行文本 / 嵌套表格撑高，远高于确定性 8mm 估算）。 */
const ROW_MM = 20;

/**
 * 导入分页失效回归（2026-09-16）。
 *
 * 现象：新建空白 → 导入大文档，超出第一页的内容不换页，而是堆在第一页并溢出纸张底部。
 *
 * 根因：`displayedPages = measuredPages ?? renderedPages` 存在滞后。导入时 `renderedPages` 已
 * 重算为新 schema，但 `measuredPages` 仍残留**空白文档**的版式，DOM 于是先渲染旧版式；
 * `correctPagination` 测到旧 DOM 的行高（只有空白文档的 row id），回灌给新 schema 时新行全部
 * 命中不到 → `measureRow` 返回 undefined → 回退确定性估算（每行 8mm，总高 < 一页）→ 仍 1 页，
 * 且此后 `renderedPages` 不再变化，校正永不重跑。
 *
 * 本用例在 jsdom 里用「测量代理」忠实还原浏览器行为：`document.querySelectorAll` 被替换为
 * **读取当前已渲染 DOM** 并按 ROW_MM 报高 —— 即浏览器 offsetHeight 的真实语义。
 * 于是：
 * - 修复后：同步清空 measuredPages → 本次渲染落到新 schema 的确定性版式 → 代理测到的是
 *   **新 schema 的行** → 正确切分为多页。
 * - 修复前：代理测到的是空白文档的行 → 新 schema 行高全缺 → 仍 1 页（本用例失败）。
 */
describe("GridFormRenderer 导入后重新测量（分页滞后回归）", () => {
  it("空白 → 导入大文档：按新文档真实行高切分为多页", async () => {
    let wrapper!: ReturnType<typeof mount>;
    const spy = vi
      .spyOn(document, "querySelectorAll")
      .mockImplementation(((selector: string) => {
        if (!String(selector).includes("layout-grid__row")) {
          return [] as unknown as NodeListOf<Element>;
        }
        // 忠实模拟浏览器：测量【当前已渲染 DOM】中的每一行。
        const ids: string[] = [];
        (wrapper.element as HTMLElement)
          .querySelectorAll<HTMLElement>(".grid-form-paper .layout-grid__row")
          .forEach((el) => {
            const id = el.dataset.layoutId;
            if (id) ids.push(id);
          });
        return ids.map((id) => ({
          dataset: { layoutId: id },
          offsetHeight: Math.round(ROW_MM * PX_PER_MM),
        })) as unknown as NodeListOf<Element>;
      }) as typeof document.querySelectorAll);

    try {
      wrapper = mount(GridFormRenderer, { props: { schema: buildBlankSchema() } });
      await nextTick();
      await nextTick();
      expect(wrapper.findAll(".grid-form-paper").length).toBe(1);

      // 导入：整篇替换 schema（与设计器 resetHistory 行为一致）
      await wrapper.setProps({ schema: importedSchema });
      await nextTick();
      await nextTick();
      await nextTick();

      const papers = wrapper.findAll(".grid-form-paper").length;
      const rows = wrapper.findAll(".layout-grid__row").length;
      // eslint-disable-next-line no-console
      console.log("[verify] 导入后物理页数 =", papers, "行数 =", rows);

      // 修复前该值为 1（校正测到的是旧 DOM）；修复后应按实测行高切分。
      expect(papers).toBeGreaterThan(1);
    } finally {
      spy.mockRestore();
    }
  });
});
