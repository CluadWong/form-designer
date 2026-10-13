import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { GridFormRenderer } from "@/components/renderer-v2";
import {
  nodeHasVisibleContent,
  pageHasVisibleContent,
} from "@/components/renderer-v2/paper-visibility";
import { paginateSchema } from "@/engine-v2/pagination";
import type { FormDataV2, FormSchemaV2, FormNodeV2 } from "@/types";

/**
 * 「打印多出一张空白纸」回归（2026-10-10）。
 *
 * 现象：表单打印时出现看起来全白的一页。
 *
 * 根因（两层叠加）：
 * ① 分页引擎只按高度切页 —— Grid 行高恒为 `row.height × baseRowHeight`，**空行也一样算**。
 *    页内 33 个空行 = 264mm，把格撑到几乎满页（正文区 273mm），尾部节点放不下 → 被切成第二张纸。
 * ② 被挤出去的那张纸只剩下「无来源图片列表」，而 `.layout-image--blank` 在 `@media print`
 *    下 `display:none`（既定语义，见 `ImageBlankPrint.test.ts`）→ 那张纸打印出来全白。
 *
 * 修复：渲染层按 `paper-visibility` 判定「这张纸渲染后有没有可见内容」，无内容的纸不出。
 * 判定是 `computed` 且依赖 `data` ⇒ **不删任何节点**，宿主脚本填入数据后纸张自动回来。
 *
 * 闸门（2026-10-10 二次调整）——**只在非设计态隐藏**（内核 `blankPageMode`，缺省 `"auto"`）：
 * - 非设计态（`mode="preview"`，或未传 `mode` 且有 `data`）：隐藏，屏幕所见即打印所得；
 * - 设计态（`mode="design"`，或未传 `mode` 且无 `data`）：**保留**，画布上每一页都要能点中、
 *   能编辑 —— 设计画布**默认就是分页的**（`paginate` 默认 true），所以闸门必须按 `mode` 判定，
 *   按 `paginate` 判定会把空白页藏掉且与状态栏计数对不上；
 * - 设计器「打印」按钮：`printForm` 序列化的就是设计画布，故在打印窗口内显式传
 *   `blankPageMode: "hide"`（见 `FormDesigner.printDocument`）。
 */

/** Grid 行（可带子节点）。 */
function row(id: string, children: FormNodeV2[] = [], height = 1) {
  return {
    id,
    type: "grid-row" as const,
    height,
    cells: [{ id: `cell-${id}`, type: "grid-cell" as const, children }],
  };
}

/**
 * 复刻用户报障的 schema 结构：
 * - grid1：`border: "all"`，第 1 行一个固定文本 + **33 个空行**（合计 34 行 × 8mm ≈ 272mm，
 *   几乎占满正文区 273mm）；
 * - grid2：`border: "none"`，唯一内容是**无来源图片**（`images: [{}]`）。
 * 分页结果是 2 张纸，但第 2 张打印全白。
 */
function schemaWithTrailingBlankImage(): FormSchemaV2 {
  const emptyRows = Array.from({ length: 33 }, (_, i) => row(`r-empty-${i}`));
  return {
    version: 2,
    paper: { size: "A4" },
    baseRowHeight: 8,
    pages: [
      {
        id: "page-1",
        type: "page",
        mode: "fixed",
        margin: { top: 12, right: 12, bottom: 12, left: 12 },
        children: [
          {
            id: "g-1",
            type: "grid",
            border: "all",
            rows: [row("r-text", [{ id: "t-1", type: "text", text: "固定文本" } as FormNodeV2]), ...emptyRows],
          },
          {
            id: "g-2",
            type: "grid",
            border: "none",
            rows: [
              row("r-img", [
                {
                  id: "img-1",
                  type: "image",
                  layout: "vertical",
                  field: "shot",
                  images: [{}],
                } as unknown as FormNodeV2,
              ]),
            ],
          },
        ],
      },
    ],
  } as unknown as FormSchemaV2;
}

describe("paper-visibility：判定「这张纸渲染后是否留下可见内容」", () => {
  it("无边框 Grid 的空行算不上内容；无来源图片也算不上", () => {
    expect(nodeHasVisibleContent({ id: "g", type: "grid", border: "none", rows: [row("r")] } as FormNodeV2)).toBe(false);
    expect(
      nodeHasVisibleContent({
        id: "g",
        type: "grid",
        border: "none",
        rows: [row("r", [{ id: "img", type: "image", images: [{}] } as unknown as FormNodeV2])],
      } as FormNodeV2),
    ).toBe(false);
  });

  it("有边框的 Grid 一律算有内容（框线会打印），哪怕每格全空", () => {
    expect(nodeHasVisibleContent({ id: "g", type: "grid", border: "all", rows: [row("r")] } as FormNodeV2)).toBe(true);
    expect(nodeHasVisibleContent({ id: "g", type: "grid", border: "inner", rows: [row("r")] } as FormNodeV2)).toBe(true);
  });

  it("文本 / 字段 P / 表格 都算有内容（保守：判不准就保留）", () => {
    expect(nodeHasVisibleContent({ id: "t", type: "text", text: "  " } as FormNodeV2)).toBe(false);
    expect(nodeHasVisibleContent({ id: "t", type: "text", text: "x" } as FormNodeV2)).toBe(true);
    expect(
      nodeHasVisibleContent({ id: "p", type: "p", mode: "field", field: "name" } as unknown as FormNodeV2),
    ).toBe(true);
    expect(nodeHasVisibleContent({ id: "tb", type: "table", rows: [] } as unknown as FormNodeV2)).toBe(true);
  });

  it("图片来源由 data 决定：填了数据 → 同一节点从「无内容」翻转为「有内容」", () => {
    const node = {
      id: "g",
      type: "grid",
      border: "none",
      rows: [row("r", [{ id: "img", type: "image", field: "shot", images: [{}] } as unknown as FormNodeV2])],
    } as FormNodeV2;
    expect(nodeHasVisibleContent(node)).toBe(false);
    expect(nodeHasVisibleContent(node, { shot: ["https://x/a.png"] } as FormDataV2)).toBe(true);
  });

  it("无子节点的纸（分页兜底空纸）判为空", () => {
    expect(
      pageHasVisibleContent({
        id: "p",
        sourcePageId: "p",
        sourceIndex: 0,
        index: 1,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        children: [],
      }),
    ).toBe(false);
  });
});

describe("GridFormRenderer：无可见内容的物理页不出纸", () => {
  it("非设计态：分页引擎确实产出 2 张纸，但第 2 张（只有无来源图片）不出", async () => {
    const schema = schemaWithTrailingBlankImage();
    // 先坐实分页层的事实：2 张纸（这是「空白页」的来源，分页引擎不负责判定可见性）。
    expect(paginateSchema(schema).pages.length).toBe(2);

    const wrapper = mount(GridFormRenderer, { props: { schema, mode: "preview" } });
    await nextTick();
    await nextTick();

    const papers = wrapper.findAll(".grid-form-paper");
    // eslint-disable-next-line no-console
    console.log("[verify] 分页 2 张 / 实际出纸 =", papers.length);
    expect(papers.length).toBe(1);
  });

  it("宿主填入数据后，被隐藏的那张纸自动回来（判定依赖 data，未删节点）", async () => {
    const schema = schemaWithTrailingBlankImage();
    const wrapper = mount(GridFormRenderer, { props: { schema, mode: "preview" } });
    await nextTick();
    await nextTick();
    expect(wrapper.findAll(".grid-form-paper").length).toBe(1);

    await wrapper.setProps({ data: { shot: ["https://x/a.png"] } as FormDataV2 });
    await nextTick();
    await nextTick();
    await nextTick();

    expect(wrapper.findAll(".grid-form-paper").length).toBe(2);
  });

  it("设计态（mode=design，且 paginate 默认 true）不过滤：空白纸必须留在画布上可选可编辑", async () => {
    // 设计画布默认就是分页的（`paginate` 由 Inspector 开关控制、默认 true），
    // 所以闸门必须按 `mode` 判定 —— 按 `paginate` 判定会把空白页藏掉、无法编辑。
    const wrapper = mount(GridFormRenderer, {
      props: { schema: schemaWithTrailingBlankImage(), mode: "design" },
    });
    await nextTick();
    await nextTick();
    expect(wrapper.findAll(".grid-form-paper").length).toBe(2);
  });

  it("未传 mode 且无 data（向后兼容 = 设计态）同样不过滤", async () => {
    const wrapper = mount(GridFormRenderer, { props: { schema: schemaWithTrailingBlankImage() } });
    await nextTick();
    await nextTick();
    expect(wrapper.findAll(".grid-form-paper").length).toBe(2);
  });

  it("设计器打印窗口：mode=design 但显式 blankPageMode='hide' 时过滤生效", async () => {
    // `printForm` 序列化的就是设计画布，故打印窗口内必须显式切到 `hide`（见 FormDesigner.printDocument）。
    const wrapper = mount(GridFormRenderer, {
      props: { schema: schemaWithTrailingBlankImage(), mode: "design", blankPageMode: "hide" },
    });
    await nextTick();
    await nextTick();
    expect(wrapper.findAll(".grid-form-paper").length).toBe(1);
  });

  it("blankPageMode='keep' 在非设计态也强制保留（反向开关可用）", async () => {
    const wrapper = mount(GridFormRenderer, {
      props: { schema: schemaWithTrailingBlankImage(), mode: "preview", blankPageMode: "keep" },
    });
    await nextTick();
    await nextTick();
    expect(wrapper.findAll(".grid-form-paper").length).toBe(2);
  });

  it("连续编辑视图（paginate=false）不切分也不过滤", async () => {
    const wrapper = mount(GridFormRenderer, {
      props: { schema: schemaWithTrailingBlankImage(), mode: "design", paginate: false },
    });
    await nextTick();
    await nextTick();
    expect(wrapper.findAll(".grid-form-paper").length).toBe(1);
  });

  it("兜底：全部纸都被判为空时保留原列表，避免「一张纸都不剩」", async () => {
    const blank: FormSchemaV2 = {
      version: 2,
      paper: { size: "A4" },
      baseRowHeight: 8,
      pages: [
        {
          id: "page-1",
          type: "page",
          mode: "fixed",
          margin: { top: 12, right: 12, bottom: 12, left: 12 },
          children: [
            { id: "g-1", type: "grid", border: "none", rows: [row("r-1"), row("r-2")] } as unknown as FormNodeV2,
          ],
        },
      ],
    } as unknown as FormSchemaV2;
    const wrapper = mount(GridFormRenderer, { props: { schema: blank, mode: "preview" } });
    await nextTick();
    await nextTick();
    expect(wrapper.findAll(".grid-form-paper").length).toBe(1);
  });
});
