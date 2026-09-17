import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import FormDesigner from "@/components/designer/FormDesigner.vue";
import type { FormSchemaV2 } from "@/types";
import type { FormDesignerExposed } from "@/components/designer/export-api";
import { GridFormRenderer } from "@/components/renderer-v2";
import { makeFiftyRowGridSchema } from "@/dev/gridPaginationDemo";
import * as printFormModule from "@/components/renderer-v2/print-form";
import type { PrintFormOptions } from "@/components/renderer-v2/print-form";

/** 单行就超过一页的 Grid（行高 100 × 基准 8mm = 800mm ≫ A4 正文 277mm）：
 *  分页引擎会「强制放入并告警」，用于验证该告警能通过状态栏暴露出来。 */
function makeOversizedRowSchema(): FormSchemaV2 {
  return {
    version: 2,
    paper: { size: "A4" },
    baseRowHeight: 8,
    pages: [
      {
        id: "p1",
        type: "page",
        mode: "fixed",
        margin: { top: 10, right: 10, bottom: 10, left: 10 },
        children: [
          {
            id: "tall-grid",
            type: "grid",
            border: "all",
            rows: [
              {
                id: "tall-row",
                type: "grid-row",
                height: 100,
                cells: [{ id: "tall-cell", type: "grid-cell", children: [] }],
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * 设计器分页（十六续）回归用例。
 *
 * 背景：曾出现「`paginate` 传了 true 却看不到分页效果」的反馈。经查渲染链路是通的
 * （本文件用例 1 即为固化证据），看不到效果的原因是**设计器默认空白 Schema、内容远未超页**，
 * 分页引擎无事可做。故用例同时载入超高 Schema（`makeFiftyRowGridSchema`）+ 切换「分页开关」，
 * 确保分页效果可验证。
 */
function mountWithTallSchema() {
  return mount(FormDesigner, {
    props: { initialSchema: makeFiftyRowGridSchema() },
  });
}

describe("FormDesigner 分页渲染", () => {
  it("超高 Schema 在设计器中渲染为多张物理页，且行数不丢失", () => {
    const wrapper = mountWithTallSchema();
    const papers = wrapper.findAll(".grid-form-paper");
    expect(papers.length).toBeGreaterThan(1);
    expect(wrapper.findAll(".layout-grid__row")).toHaveLength(50);
  });

  it("每张物理页的纸张高度固定（整纸高 − 0.5mm 安全余量），不使用 min-height 无限撑开", () => {
    const wrapper = mountWithTallSchema();
    const papers = wrapper.findAll(".grid-form-paper");
    for (const paper of papers) {
      const style = paper.attributes("style") ?? "";
      // 297 − 0.5 = 296.5：略小于页高，避免「纸高 == 页高」时取整溢出一缕、打印多出空白尾页。
      expect(style).toContain("height: 296.5mm");
      expect(style).not.toContain("min-height");
    }
  });

  it("空白 Schema 仍只渲染一张纸（分页不产生空页）", () => {
    const wrapper = mount(FormDesigner);
    expect(wrapper.findAll(".grid-form-paper")).toHaveLength(1);
  });

  it("关闭分页开关后回到单张纸的整页连续渲染，行数不丢", async () => {
    const wrapper = mountWithTallSchema();
    expect(wrapper.findAll(".grid-form-paper").length).toBeGreaterThan(1);

    // 分页开关已移入「页面」配置项，需先选中页面节点方能操作
    const pageRow = wrapper.findAll(".v2-tree-row").find(r => r.text().includes("页面"));
    await pageRow?.trigger("click");
    await nextTick();

    await wrapper.find('[data-paginate="true"]').setValue(false);

    expect(wrapper.findAll(".grid-form-paper")).toHaveLength(1);
    expect(wrapper.findAll(".layout-grid__row")).toHaveLength(50);
  });
});

describe("FormDesigner 状态栏暴露分页结果", () => {
  it("内容超高时显示物理（打印）页数，且与画布纸张数一致", () => {
    const wrapper = mountWithTallSchema();
    const paperCount = wrapper.findAll(".grid-form-paper").length;

    const status = wrapper.find('[data-physical-page-count="true"]');
    expect(status.exists()).toBe(true);
    expect(status.text()).toContain(String(paperCount));
    // 逻辑页仍只有 1 页，多出来的是换页结果
    expect(status.text()).toMatch(/打印：\d+ 张/);
  });

  it("逻辑页与物理页相同（空白 Schema）时不额外显示打印页数", () => {
    const wrapper = mount(FormDesigner);
    expect(wrapper.find('[data-physical-page-count="true"]').exists()).toBe(false);
  });

  it("单节点比整页还高时，状态栏显示分页告警", () => {
    const wrapper = mount(FormDesigner, {
      props: { initialSchema: makeOversizedRowSchema() },
    });
    expect(wrapper.find('[data-paginate-warning-count="true"]').exists()).toBe(true);
  });

  it("无超高内容时不显示分页告警", () => {
    const wrapper = mountWithTallSchema();
    expect(wrapper.find('[data-paginate-warning-count="true"]').exists()).toBe(false);
  });
});

/**
 * 打印强制分页（根因回归）。
 *
 * 背景：曾出现「屏幕是连续编辑视图（`paginate=false`，单张、随内容长高的纸），但一打印就多出
 * 空白尾页」——根因是打印时没有强制分页：那张单张、超高的纸被直接序列化进 iframe，内容溢出
 * `@page` 尺寸，多出空白页。`FormDesigner.printDocument` 现已在打印前临时把 `paginate` 置 true、
 * 等 `printForm` 同步序列化完再还原，屏幕编辑态不受影响。
 *
 * 本组用例固化该修复：即便用户关掉了分页开关，打印路径也必须走「已分页」的纸张。
 */
describe("FormDesigner 打印强制分页", () => {
  /** 通过工具栏「打印」按钮触发 `printDocument`（与用户真实操作一致）。 */
  async function clickPrint(wrapper: ReturnType<typeof mountWithTallSchema>): Promise<void> {
    const btn = wrapper.findAll("button").find((b) => b.text().includes("打印"));
    expect(btn).toBeTruthy();
    await btn!.trigger("click");
    await nextTick();
    await nextTick();
  }

  /** 挂载超高 Schema 并把分页开关关闭，回到单张连续纸。 */
  async function mountWithPaginationOff() {
    const wrapper = mountWithTallSchema();
    expect(wrapper.findAll(".grid-form-paper").length).toBeGreaterThan(1);

    const pageRow = wrapper.findAll(".v2-tree-row").find((r) => r.text().includes("页面"));
    await pageRow?.trigger("click");
    await nextTick();
    await wrapper.find('[data-paginate="true"]').setValue(false);

    // 关闭后回到单张纸（连续编辑视图）。
    expect(wrapper.findAll(".grid-form-paper")).toHaveLength(1);
    return wrapper;
  }

  it("打印时即便 paginate=false，送印的仍是已分页的多张纸（不溢出空白尾页）", async () => {
    const wrapper = await mountWithPaginationOff();

    // 在 printForm 入口同步记录「送印纸张数」——此时分页已被临时强制打开，
    // 必须在 restore 还原 paginate 之前捕获，否则会误读成连续编辑态的 1 张纸。
    let papersAtPrint = 0;
    const printFormSpy = vi
      .spyOn(printFormModule, "printForm")
      .mockImplementation((opts: PrintFormOptions | undefined) => {
        const root = opts?.root ?? null;
        papersAtPrint = root?.querySelectorAll(".grid-form-paper").length ?? 0;
        return false; // jsdom 无 iframe，原实现亦静默返回 false
      });
    try {
      await clickPrint(wrapper);
      expect(printFormSpy).toHaveBeenCalledTimes(1);
      // 关键断言：送印的是已分页的多张纸，而非一张连续超高纸（否则内容溢出 @page、多出空白尾页）。
      expect(papersAtPrint).toBeGreaterThan(1);
    } finally {
      printFormSpy.mockRestore();
    }
  });

  it("打印结束后分页开关还原为关闭（屏幕编辑态不受影响）", async () => {
    const wrapper = await mountWithPaginationOff();
    const printFormSpy = vi.spyOn(printFormModule, "printForm");
    try {
      await clickPrint(wrapper);
    } finally {
      printFormSpy.mockRestore();
    }
    // 打印还原后，画布回到「单张连续纸」状态。
    expect(wrapper.findAll(".grid-form-paper")).toHaveLength(1);
  });

  it("原本就开启分页时，打印照常送印多张纸（无副作用）", async () => {
    const wrapper = mountWithTallSchema(); // 默认 paginate=true
    expect(wrapper.findAll(".grid-form-paper").length).toBeGreaterThan(1);

    let papersAtPrint = 0;
    const printFormSpy = vi
      .spyOn(printFormModule, "printForm")
      .mockImplementation((opts: PrintFormOptions | undefined) => {
        const root = opts?.root ?? null;
        papersAtPrint = root?.querySelectorAll(".grid-form-paper").length ?? 0;
        return false;
      });
    try {
      await clickPrint(wrapper);
      expect(printFormSpy).toHaveBeenCalledTimes(1);
      expect(papersAtPrint).toBeGreaterThan(1);
    } finally {
      printFormSpy.mockRestore();
    }
  });
});
