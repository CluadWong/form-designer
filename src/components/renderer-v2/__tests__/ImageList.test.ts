import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { parseFormSchemaV2 } from "@/types";
import type { FormDataV2, FormSchemaV2, GridNodeV2, ImageNodeV2 } from "@/types";
import { GridSchemaNode } from "@/components/renderer-v2";
import { collectFieldValues } from "@/components/renderer-v2/collectFieldValues";
import { paginateSchema } from "@/engine-v2/pagination";
import { resolveImageItemsV2, imageItemHeightMm } from "@/engine-v2/derivation";

/**
 * 图片列表组件（2026-09-28 由单图改造）：
 * - 字段值是**对象数组** `[{ name, src, width, height }]`，数据有值时整列表以数据为准；
 * - 静态模板 `images` 只是设计期占位，`maxCount` 限制张数，`layout` 决定排布；
 * - 采集侧把同一字段的多个条目聚回数组，name / 尺寸从条目盒的 `data-*` 回读。
 */
function imageNode(overrides: Partial<ImageNodeV2> = {}): ImageNodeV2 {
  return {
    id: "img-1",
    type: "image",
    layout: "vertical",
    images: [{ src: "data:image/png;base64,AAAA", height: 30 }],
    ...overrides,
  } as ImageNodeV2;
}

function render(
  node: ImageNodeV2,
  data: Record<string, unknown> = {},
  mode: "design" | "preview" = "preview",
) {
  return mount(GridSchemaNode, {
    props: {
      node,
      data: data as FormDataV2,
      baseRowHeight: 8,
      mode,
      readonly: true,
    },
  });
}

describe("图片列表取值：数据优先、模板兜底、受数量上限约束", () => {
  it("数据给了字段值 → 按对象数组渲染；数据项自带字段时以数据为准", () => {
    const node = imageNode({ field: "photos", images: [{ src: "template.png" }] });
    const items = resolveImageItemsV2(node, {
      data: { photos: [{ name: "门头", src: "a.png" }, { src: "b.png" }] },
    });
    expect(items).toEqual([{ name: "门头", src: "a.png" }, { src: "b.png" }]);
  });

  it("字段值是字符串数组（后端简写）也能读，缺省字段继承模板行", () => {
    expect(
      resolveImageItemsV2(imageNode({ field: "photos" }), { data: { photos: ["a.png", "b.png"] } }),
    ).toEqual([{ src: "a.png", height: 30 }, { src: "b.png" }]);
  });

  it("模板行是样式预设：数据只给地址时继承模板宽高（签名条 30×10 场景）", () => {
    const node = imageNode({
      field: "签名图",
      layout: "horizontal",
      images: [{ width: 30, height: 10 }],
    });
    // 宿主只回填一张签名图（单个地址字符串）→ 与模板第 0 行配对，尺寸照旧
    expect(resolveImageItemsV2(node, { data: { 签名图: "data:image/png;base64,SIG" } })).toEqual([
      { src: "data:image/png;base64,SIG", width: 30, height: 10 },
    ]);
    // 对象数组同理：给了自己的尺寸就以数据为准（逐字段覆盖）
    expect(
      resolveImageItemsV2(node, {
        data: { 签名图: [{ src: "x.png" }, { src: "y.png", width: 20, height: 5 }] },
      }),
    ).toEqual([
      { src: "x.png", width: 30, height: 10 },
      { src: "y.png", width: 20, height: 5 },
    ]);
  });

  it("数据里没有该字段 → 回退模板", () => {
    const node = imageNode({ field: "photos", images: [{ src: "template.png" }] });
    expect(resolveImageItemsV2(node, { data: {} })).toEqual([{ src: "template.png" }]);
  });

  it("设计态忽略数据（改模板时画布不被数据顶掉）", () => {
    const node = imageNode({ field: "photos", images: [{ src: "template.png" }] });
    expect(resolveImageItemsV2(node, { data: { photos: ["a.png"] }, isDesign: true })).toEqual([
      { src: "template.png" },
    ]);
  });

  it("数量上限截断（未设 / 0 = 不限）", () => {
    const data = { photos: ["a.png", "b.png", "c.png"] };
    expect(resolveImageItemsV2(imageNode({ field: "photos", maxCount: 2 }), { data })).toHaveLength(2);
    expect(resolveImageItemsV2(imageNode({ field: "photos", maxCount: 0 }), { data })).toHaveLength(3);
  });

  it("旧 schema 的单图字段回退成一条（向后兼容）", () => {
    const legacy = {
      id: "i",
      type: "image",
      src: "legacy.png",
      width: 40,
      height: 20,
    } as ImageNodeV2;
    expect(resolveImageItemsV2(legacy, {})).toEqual([{ src: "legacy.png", width: 40, height: 20 }]);
  });
});

/**
 * 尺寸两档（2026-09-29）：**行内优先，节点级默认兜底**。
 * 用途是把「整组图统一尺寸」（如与输入框等高的 10mm 签名条）从「每行重复填」里解放出来。
 */
describe("默认宽高：行内优先，节点级兜底", () => {
  it("行内未配尺寸时吃节点默认宽高（整组图统一尺寸，不必逐行填）", () => {
    expect(
      resolveImageItemsV2(
        imageNode({ images: [{ src: "a.png" }, { src: "b.png" }], defaultWidth: 30, defaultHeight: 10 }),
        {},
      ),
    ).toEqual([
      { src: "a.png", width: 30, height: 10 },
      { src: "b.png", width: 30, height: 10 },
    ]);
  });

  it("行内配了的那一维优先，只缺的那一维吃默认值", () => {
    expect(
      resolveImageItemsV2(
        imageNode({ images: [{ src: "a.png", width: 20 }], defaultWidth: 30, defaultHeight: 10 }),
        {},
      ),
    ).toEqual([{ src: "a.png", width: 20, height: 10 }]);
  });

  it("宿主只回填地址的签名图同样吃默认宽高（原来会退回图片自身比例）", () => {
    const node = imageNode({
      field: "签名图",
      layout: "horizontal",
      images: [{}],
      defaultWidth: 30,
      defaultHeight: 10,
    });
    expect(resolveImageItemsV2(node, { data: { 签名图: "data:image/png;base64,SIG" } })).toEqual([
      { src: "data:image/png;base64,SIG", width: 30, height: 10 },
    ]);
  });

  it("设计态空列表的占位条目也吃默认尺寸（画布上能量出该尺寸）", () => {
    const wrapper = render(
      imageNode({ images: [], defaultWidth: 30, defaultHeight: 10 }),
      {},
      "design",
    );
    const item = wrapper.find(".layout-image__item");
    expect(item.attributes("style") ?? "").toContain("width: 30mm");
    // 尺寸落在 `<img>` 上而不是条目盒：盒子高度必须是内容高（图片 + 名称各占自身），
    // 盒高若被配置高锁死，图片会把盒高吃满、同列的名称只能溢出到盒外被裁掉。
    const img = item.find("img");
    expect(img.attributes("style") ?? "").toContain("height: 10mm");
    expect(item.attributes("style") ?? "").not.toContain("height:");
  });

  it("显示名称时名称与图片同列共存：图片仍拿配置高（不再被名称挤扁）", () => {
    const wrapper = render(
      imageNode({
        layout: "horizontal",
        showName: true,
        images: [
          { name: "门头照", src: "a.png", width: 40, height: 30 },
          { name: "签名", src: "b.png", width: 30, height: 10 },
        ],
      }),
    );
    const items = wrapper.findAll(".layout-image__item");
    expect(items).toHaveLength(2);
    // 每张图的毫米高都精确落在 `<img>` 上（此前 `height:100%` 会被名称压缩到不足配置值）
    expect(items[0].find("img").attributes("style") ?? "").toContain("height: 30mm");
    expect(items[1].find("img").attributes("style") ?? "").toContain("height: 10mm");
    expect(items[1].find(".layout-image__name").text()).toBe("签名");
  });

  it("渲染与分页同口径：行内没配、只有默认高 100mm → 仍按 100mm 占版面", () => {
    const r = paginateSchema(
      schemaWithTrailingImage(imageNode({ defaultHeight: 100, images: [{ src: "a.png" }] })),
    );
    expect(r.pages.length).toBe(2);
  });

  it("applyDefaults:false 拿到的条目保留「显式来源」尺寸（采集侧口径）", () => {
    const node = imageNode({
      images: [{ src: "a.png" }, { src: "b.png", width: 20 }],
      defaultWidth: 30,
      defaultHeight: 10,
    });
    expect(resolveImageItemsV2(node, { applyDefaults: false })).toEqual([
      { src: "a.png" },
      { src: "b.png", width: 20 },
    ]);
  });
});

describe("图片列表渲染：布局方式与条目 DOM", () => {
  it("默认垂直布局，容器带布局类与 data-field，条目按 index 落 DOM", () => {
    const wrapper = render(
      imageNode({ field: "photos", images: [{ src: "a.png", name: "A" }, { src: "b.png" }] }),
    );
    const container = wrapper.find(".layout-image");
    expect(container.classes()).toContain("layout-image--vertical");
    expect(container.attributes("data-field")).toBe("photos");
    expect(wrapper.findAll(".layout-image__item")).toHaveLength(2);
    expect(wrapper.findAll(".layout-image__img")[0].attributes("src")).toBe("a.png");
  });

  it("水平 / 填充布局的容器类随之切换", () => {
    expect(render(imageNode({ layout: "horizontal" })).find(".layout-image").classes()).toContain(
      "layout-image--horizontal",
    );
    expect(render(imageNode({ layout: "fill" })).find(".layout-image").classes()).toContain(
      "layout-image--fill",
    );
  });

  it("填充布局：按宽高比分配伸缩权重，并在行内撑满（宽图独占一行时权重更高）", () => {
    const wrapper = render(
      imageNode({
        layout: "fill",
        images: [
          { src: "wide.png", width: 60, height: 20 },
          { src: "tall.png", width: 20, height: 60 },
        ],
      }),
    );
    const items = wrapper.findAll(".layout-image__item");
    expect(items[0].attributes("style")).toContain("flex: 3 1 auto");
    expect(items[1].attributes("style")).toContain("flex: 0.3333333333333333 1 auto");
  });

  it("配置的宽高就是渲染尺寸（30×10mm 长条型签名条）", () => {
    const wrapper = render(
      imageNode({
        layout: "horizontal",
        images: [{ src: "sig.png", width: 30, height: 10 }],
      }),
    );
    // 宽度落在条目盒上，高度落在 `<img>` 上——盒高留给「图片 + 名称」共同撑开。
    expect(wrapper.find(".layout-image__item").attributes("style") ?? "").toContain("width: 30mm");
    const imgStyle = wrapper.find(".layout-image__img").attributes("style") ?? "";
    expect(imgStyle).toContain("width: 100%");
    expect(imgStyle).toContain("height: 10mm");
  });

  it("导出的 JSON 往返后高度仍在：parseFormSchemaV2 载入后仍按 30×10mm 渲染", () => {
    const schema = parseFormSchemaV2({
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
              border: "none",
              columns: ["1fr"],
              rows: [
                {
                  id: "r-1",
                  height: 2,
                  cells: [
                    {
                      id: "c-1",
                      type: "grid-cell",
                      children: [
                        {
                          id: "image-mul9u17s-fzcvw",
                          type: "image",
                          images: [{ width: 30, height: 10 }],
                          layout: "horizontal",
                          objectFit: "contain",
                          field: "签名图",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const grid = schema.pages[0].children[0] as GridNodeV2;
    const node = grid.rows[0].cells[0].children[0] as ImageNodeV2;
    expect(node.images?.[0]).toEqual({ width: 30, height: 10 });
    const style =
      render(node, { 签名图: "data:image/png;base64,SIG" })
        .find(".layout-image__img")
        .attributes("style") ?? "";
    expect(style).toContain("width: 100%");
    expect(style).toContain("height: 10mm");
  });

  it("只配高不配宽：图片高就是配置的 mm、宽度按自身比例（不写死 100% 宽）", () => {
    const wrapper = render(imageNode({ images: [{ src: "sig.png", height: 8 }] }));
    const style = wrapper.find(".layout-image__img").attributes("style") ?? "";
    expect(style).toContain("height: 8mm");
    expect(style).not.toContain("width: 100%");
    expect(style).toContain("align-self: center");
  });

  it("填充布局不锁 mm 高：高度由行宽与宽高比推得", () => {
    const wrapper = render(
      imageNode({ layout: "fill", images: [{ src: "a.png", width: 30, height: 10 }] }),
    );
    const item = wrapper.find(".layout-image__item").attributes("style") ?? "";
    expect(item).not.toContain("height: 10mm");
    const imgStyle = wrapper.find(".layout-image__img").attributes("style") ?? "";
    expect(imgStyle).toContain("aspect-ratio: 3");
  });

  it("水平对齐落到容器：垂直布局走 align-items、水平布局走 justify-content", () => {
    const styleOf = (node: ImageNodeV2): string =>
      render(node).find(".layout-image").attributes("style") ?? "";
    // 缺省：按布局取默认（垂直居中、水平靠左），与升级前的历史外观一致
    expect(styleOf(imageNode({ layout: "vertical" }))).toContain("align-items: center");
    expect(styleOf(imageNode({ layout: "horizontal" }))).toContain("justify-content: flex-start");
    // 旧 schema 不带 `layout` → 缺省即垂直（与 `layout ?? "vertical"` 同口径，不能按水平默认靠左）
    expect(styleOf({ ...imageNode(), layout: undefined })).toContain("align-items: center");
    // 显式配置：整组图在容器内的水平位置
    const right = render(imageNode({ layout: "vertical", align: "right" }));
    expect(right.find(".layout-image").attributes("style") ?? "").toContain("align-items: flex-end");
    expect(right.find(".layout-image").attributes("data-image-align")).toBe("right");
    expect(styleOf(imageNode({ layout: "fill", align: "center" }))).toContain(
      "justify-content: center",
    );
    // 非法值不静默生效：退回布局默认（测试用故意越界的值，故走 unknown 断言）
    expect(
      styleOf({
        ...imageNode({ layout: "horizontal" }),
        align: "middle",
      } as unknown as ImageNodeV2),
    ).toContain("justify-content: flex-start");
  });

  it("垂直对齐落到容器：与水平对齐各管一个方向，缺省 top = flex-start", () => {
    const styleOf = (node: ImageNodeV2): string =>
      render(node).find(".layout-image").attributes("style") ?? "";
    // 垂直布局：主轴是垂直 → 垂直对齐走 justify-content，水平对齐仍走 align-items（互不覆盖）
    const verticalDefault = styleOf(imageNode({ layout: "vertical" }));
    expect(verticalDefault).toContain("justify-content: flex-start");
    expect(verticalDefault).toContain("align-items: center");
    const verticalMixed = render(
      imageNode({ layout: "vertical", align: "right", verticalAlign: "middle" }),
    );
    const mixedStyle = verticalMixed.find(".layout-image").attributes("style") ?? "";
    expect(mixedStyle).toContain("align-items: flex-end");
    expect(mixedStyle).toContain("justify-content: center");
    // 水平布局：主轴是水平 → 垂直对齐落到 align-items（覆盖 CSS 里的默认 flex-start）
    const horizontalBottom = render(
      imageNode({ layout: "horizontal", align: "center", verticalAlign: "bottom" }),
    );
    const horizontalStyle = horizontalBottom.find(".layout-image").attributes("style") ?? "";
    expect(horizontalStyle).toContain("justify-content: center");
    expect(horizontalStyle).toContain("align-items: flex-end");
    // data 属性同步暴露两个方向，便于宿主 / 快照断言
    expect(
      horizontalBottom.find(".layout-image").attributes("data-image-vertical-align"),
    ).toBe("bottom");
    // 填充布局每行被撑满：只写水平对齐，不覆盖 `align-items: stretch`（行内等高所需）
    const fillStyle = styleOf(imageNode({ layout: "fill", verticalAlign: "bottom" }));
    expect(fillStyle).toContain("justify-content: flex-start");
    expect(fillStyle).not.toContain("align-items");
    // 非法值不静默生效：退回默认 top
    expect(
      styleOf({
        ...imageNode({ layout: "horizontal" }),
        verticalAlign: "center",
      } as unknown as ImageNodeV2),
    ).toContain("align-items: flex-start");
  });

  it("额外属性原样落到图片容器（宿主用 params 挂钩签名弹框：action=signature / interactive=true）", () => {
    const wrapper = render(
      imageNode({ params: { action: "signature", interactive: "true" } }),
    );
    const container = wrapper.find(".layout-image");
    expect(container.attributes("action")).toBe("signature");
    expect(container.attributes("interactive")).toBe("true");
  });

  it("name 默认不上画面；勾选「显示名称」后渲染说明文字", () => {
    const node = imageNode({ images: [{ src: "a.png", name: "门头照" }] });
    expect(render(node).find(".layout-image__name").exists()).toBe(false);
    expect(render({ ...node, showName: true }).find(".layout-image__name").text()).toBe("门头照");
  });

  it("设计态列表为空仍补一条占位（否则节点退化成零高度、无法选中）", () => {
    expect(render(imageNode({ images: [] }), {}, "design").findAll(".layout-image__item")).toHaveLength(1);
    expect(render(imageNode({ images: [] }), {}, "preview").findAll(".layout-image__item")).toHaveLength(0);
  });

  it("某一张加载失败只影响它自己：退回占位图并标 data-fallback", async () => {
    const wrapper = render(imageNode({ images: [{ src: "bad.png" }, { src: "ok.png" }] }));
    await wrapper.findAll(".layout-image__img")[0].trigger("error");
    const after = wrapper.findAll(".layout-image__img");
    expect(after[0].attributes("src")).toContain("data:image/svg+xml");
    expect(after[0].attributes("data-fallback")).toBe("true");
    expect(after[1].attributes("src")).toBe("ok.png");
  });
});

describe("字段采集：图片列表聚成数组", () => {
  it("同一字段的多个条目聚成对象数组，name / 宽高从 data-* 回读", () => {
    const node = imageNode({
      field: "photos",
      images: [
        { name: "门头", src: "a.png", width: 40, height: 30 },
        { src: "b.png" },
      ],
    });
    const wrapper = render(node, { photos: node.images });
    expect(collectFieldValues(wrapper.element).photos).toEqual([
      { name: "门头", src: "a.png", width: 40, height: 30 },
      { src: "b.png" },
    ]);
  });

  it("占位图不算真值：加载失败时 src 采成空串，不把占位 data URI 存成数据", async () => {
    const wrapper = render(imageNode({ field: "photos", images: [{ src: "bad.png" }] }));
    await wrapper.find(".layout-image__img").trigger("error");
    expect(collectFieldValues(wrapper.element).photos).toEqual([{ src: "" }]);
  });

  it("默认宽高不回写字段值：只采「行内配置 / 数据提供」的尺寸", () => {
    const node = imageNode({
      field: "photos",
      defaultWidth: 30,
      defaultHeight: 10,
      images: [{ src: "a.png" }, { src: "b.png", width: 20 }],
    });
    const wrapper = render(node, { photos: node.images });
    expect(collectFieldValues(wrapper.element).photos).toEqual([
      { src: "a.png" },
      { src: "b.png", width: 20 },
    ]);
    // 渲染层仍按默认宽高呈现（采集口径不影响版面）
    expect(wrapper.findAll(".layout-image__item")[0].attributes("style")).toContain("width: 30mm");
  });

  it("列表容器的 data-field 不会把数组覆盖成空串", () => {
    const wrapper = render(imageNode({ field: "photos", images: [{ src: "a.png" }] }));
    expect(collectFieldValues(wrapper.element).photos).toEqual([{ src: "a.png" }]);
  });

  it("文本字段与图片列表字段并存时互不干扰", () => {
    const wrapper = mount(GridSchemaNode, {
      props: {
        node: {
          id: "g-1",
          type: "grid",
          border: "none",
          columns: ["1fr"],
          rows: [
            {
              id: "r-1",
              height: 2,
              cells: [
                {
                  id: "c-1",
                  type: "grid-cell",
                  children: [
                    {
                      id: "p-1",
                      type: "p",
                      mode: "field",
                      field: "备注",
                      style: { fontSize: 13 },
                    },
                    imageNode({ field: "photos", images: [{ src: "a.png" }] }),
                  ],
                },
              ],
            },
          ],
        } as never,
        data: { 备注: "已核对", photos: [{ src: "a.png" }] } as FormDataV2,
        baseRowHeight: 8,
        mode: "preview",
        readonly: true,
      },
    });
    const values = collectFieldValues(wrapper.element);
    expect(values.备注).toBe("已核对");
    expect(values.photos).toEqual([{ src: "a.png" }]);
  });
});

/** 一页 277mm 可用（A4 297 − 上下边距 10×2）；先放一个约 248mm 的 Grid，再放图片。 */
function schemaWithTrailingImage(node: ImageNodeV2): FormSchemaV2 {
  return {
    version: 2,
    paper: { size: "A4" },
    baseRowHeight: 8,
    pages: [
      {
        id: "page-1",
        type: "page",
        mode: "fixed",
        margin: { top: 10, right: 5, bottom: 10, left: 5 },
        children: [
          {
            id: "g-1",
            type: "grid",
            border: "none",
            columns: ["1fr"],
            rows: [
              {
                id: "r-1",
                height: 31, // 31 × 8 = 248mm
                cells: [{ id: "c-1", type: "grid-cell", children: [] }],
              },
            ],
          },
          node,
        ],
      },
    ],
  } as unknown as FormSchemaV2;
}

describe("分页高度按布局折算", () => {
  it("垂直布局按各行累加：248 + 100 + 100 → 2 页", () => {
    const r = paginateSchema(
      schemaWithTrailingImage(
        imageNode({ images: [{ src: "a.png", height: 100 }, { src: "b.png", height: 100 }] }),
      ),
    );
    expect(r.pages.length).toBe(2);
  });

  it("水平布局按最高一张：248 + 100 → 2 页；三张 20mm 高的一行放得下", () => {
    const tall = paginateSchema(
      schemaWithTrailingImage(
        imageNode({ layout: "horizontal", images: [{ src: "a.png", height: 100 }] }),
      ),
    );
    expect(tall.pages.length).toBe(2);
    const short = paginateSchema(
      schemaWithTrailingImage(
        imageNode({
          layout: "horizontal",
          images: [
            { src: "a.png", height: 20 },
            { src: "b.png", height: 20 },
            { src: "c.png", height: 20 },
          ],
        }),
      ),
    );
    expect(short.pages.length).toBe(1);
  });

  it("数量上限参与估算：超上限的高图不计入高度", () => {
    const r = paginateSchema(
      schemaWithTrailingImage(
        imageNode({
          maxCount: 1,
          images: [{ src: "a.png", height: 20 }, { src: "b.png", height: 200 }],
        }),
      ),
    );
    expect(r.pages.length).toBe(1);
  });

  it("显示名称的名称行计入估算（26mm 图 + 名称行 > 剩余 29mm → 换页）", () => {
    // 前导网格 31 × 8 = 248mm，页面正文 277mm → 图片块只剩 29mm 可用。
    const silent = paginateSchema(
      schemaWithTrailingImage(
        imageNode({ images: [{ src: "a.png", height: 26, name: "签名" }] }),
      ),
    );
    expect(silent.pages.length).toBe(1);
    const named = paginateSchema(
      schemaWithTrailingImage(
        imageNode({ showName: true, images: [{ src: "a.png", height: 26, name: "签名" }] }),
      ),
    );
    // 名称与图片同在一个纵向条目盒里，是真实版面：不算它就会把名称挤出纸外
    expect(named.pages.length).toBe(2);
  });

  it("勾了显示名称但条目没有 name → 不加高度（没名字就没那一行）", () => {
    const r = paginateSchema(
      schemaWithTrailingImage(
        imageNode({ showName: true, images: [{ src: "a.png", height: 26 }] }),
      ),
    );
    expect(r.pages.length).toBe(1);
  });
});

describe("imageItemHeightMm：单条目估算（分页 / 校验共用）", () => {
  it("height 优先、只给 width 时按宽兜底、都没给时按基准行高", () => {
    expect(imageItemHeightMm({ height: 10 }, { baseRowHeight: 8 })).toBe(10);
    expect(imageItemHeightMm({ width: 30 }, { baseRowHeight: 8 })).toBe(30);
    expect(imageItemHeightMm({}, { baseRowHeight: 8 })).toBe(8);
  });

  it("勾了显示名称且条目有 name → 叠加一行名称高（11px × 1.4）", () => {
    const nameLine = (11 * 1.4) / (96 / 25.4);
    expect(imageItemHeightMm({ height: 10, name: "签名" }, { showName: true, baseRowHeight: 8 })).toBeCloseTo(10 + nameLine, 6);
    expect(imageItemHeightMm({ height: 10, name: "  " }, { showName: true, baseRowHeight: 8 })).toBe(10);
    expect(imageItemHeightMm({ height: 10, name: "签名" }, { showName: false, baseRowHeight: 8 })).toBe(10);
  });
});
