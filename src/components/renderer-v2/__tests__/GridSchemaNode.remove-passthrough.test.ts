import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import GridSchemaNode from "@/components/renderer-v2/GridSchemaNode.vue";
import { createGridBySizeV2, createImageNodeV2 } from "@/types";
import type { FieldPNodeV2, FormNodeV2, GridNodeV2 } from "@/types";

/**
 * 删除事件在**嵌套节点**上的透传（2026-10-15）。
 *
 * 背景：`GridSchemaNode` 递归渲染子节点（`cell.children` 与 rowTemplate 派生行）时，
 * 只绑了 `@field-change`，漏绑 `@image-remove` / `@sign-remove`。后果是票面里
 * **只要图片/签名线不在第一层节点上**（绝大多数在 grid cell 或表格模板里），
 * 角标照常由内核渲染、点击也照常 emit，但事件在中间层没有 handler，被 Vue 静默丢弃 ——
 * 表现就是「hover 出现删除按钮，点了没反应」。顶层节点反而正常，所以极易误判为宿主没接。
 *
 * 本文件锁的就是这条：**嵌套层级不得吞掉删除事件**。
 * 只锁「透传到位」，不改任何删除语义（谁允许删仍由宿主判，见 FormRenderer 的 emits 注释）。
 */
const SIGN_A = "data:image/png;base64,AAA";
const SIGN_B = "data:image/png;base64,BBB";

function signNode(): FieldPNodeV2 {
  return {
    id: "sign-1",
    type: "p",
    mode: "field",
    field: "签名",
    prefix: "签名：",
    valueType: "image",
    params: { action: "signature" },
  };
}

/** 把 children 塞进 grid 的第 0 行第 0 格（保留该 cell 的既有属性）。 */
function nest(grid: GridNodeV2, children: FormNodeV2[]): GridNodeV2 {
  const cell = grid.rows[0].cells[0];
  grid.rows[0].cells = [{ ...cell, children }, ...grid.rows[0].cells.slice(1)];
  return grid;
}

/** 填写态挂载（与 `FieldPImageValue.test.ts` 同口径：preview + 非只读）。 */
function mountGrid(node: GridNodeV2, data: Record<string, string | string[]>) {
  return mount(GridSchemaNode, {
    props: { node, baseRowHeight: 8, mode: "preview", readonly: false, data },
  });
}

describe("删除事件在嵌套节点上的透传", () => {
  it("签名线在**子网格**的 cell 里：sign-remove 仍能透传到最外层", async () => {
    const inner = nest(createGridBySizeV2({ rows: 1, columns: 1 }), [signNode()]);
    const outer = nest(createGridBySizeV2({ rows: 1, columns: 1 }), [inner]);

    const wrapper = mountGrid(outer, { 签名: [SIGN_A, SIGN_B] });
    const badges = wrapper.findAll(".layout-p__sign-del");
    expect(badges.length).toBe(2);

    await badges[0].trigger("click");

    const emitted = wrapper.emitted("sign-remove");
    expect(emitted, "子节点发出的 sign-remove 必须被逐层转发到最外层").toBeTruthy();
    expect(emitted![0][0]).toMatchObject({ field: "签名", index: 0 });
  });

  it("签名线在**顶层**时同样透传（两层路径口径一致，不因层级不同而行为分化）", async () => {
    const outer = nest(createGridBySizeV2({ rows: 1, columns: 1 }), [signNode()]);
    const wrapper = mountGrid(outer, { 签名: [SIGN_A] });

    await wrapper.find(".layout-p__sign-del").trigger("click");

    expect(wrapper.emitted("sign-remove")?.[0][0]).toMatchObject({
      field: "签名",
      index: 0,
    });
  });

  it("三层嵌套也不丢", async () => {
    const a = nest(createGridBySizeV2({ rows: 1, columns: 1 }), [signNode()]);
    const b = nest(createGridBySizeV2({ rows: 1, columns: 1 }), [a]);
    const c = nest(createGridBySizeV2({ rows: 1, columns: 1 }), [b]);

    const wrapper = mountGrid(c, { 签名: [SIGN_A] });
    await wrapper.find(".layout-p__sign-del").trigger("click");

    expect(wrapper.emitted("sign-remove")).toBeTruthy();
  });

  it("图片列表在**子网格**的 cell 里：image-remove 同样透传（与签名不是同一渲染分支）", async () => {
    const imageNode = { ...createImageNodeV2(), field: "附图" } as FormNodeV2;
    const inner = nest(createGridBySizeV2({ rows: 1, columns: 1 }), [imageNode]);
    const outer = nest(createGridBySizeV2({ rows: 1, columns: 1 }), [inner]);

    const wrapper = mountGrid(outer, { 附图: [SIGN_A, SIGN_B] });
    const badges = wrapper.findAll(".layout-image__del");
    expect(badges.length).toBe(2);

    await badges[0].trigger("click");

    const emitted = wrapper.emitted("image-remove");
    expect(emitted, "子节点发出的 image-remove 必须被逐层转发到最外层").toBeTruthy();
    expect(emitted![0][0]).toMatchObject({ field: "附图", index: 0 });
  });
});
