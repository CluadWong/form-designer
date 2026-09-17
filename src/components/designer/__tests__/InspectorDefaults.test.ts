import { describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import TextInspector from "@/components/designer/inspectors/TextInspector.vue";
import FieldPInspector from "@/components/designer/inspectors/FieldPInspector.vue";
import GridInspector from "@/components/designer/inspectors/GridInspector.vue";
import CellInspector from "@/components/designer/inspectors/CellInspector.vue";
import PageInspector from "@/components/designer/inspectors/PageInspector.vue";
import TableInspector from "@/components/designer/inspectors/TableInspector.vue";
import HtmlInspector from "@/components/designer/inspectors/HtmlInspector.vue";
import ImageInspector from "@/components/designer/inspectors/ImageInspector.vue";
import {
  createTextNodeV2,
  createFieldPNodeV2,
  createTableNodeV2,
  createGridNodeV2,
  createHtmlNodeV2,
  createImageNodeV2,
} from "@/types";
import {
  DEFAULT_CELL_PADDING,
  DEFAULT_CELL_ROW_HEIGHT,
  DEFAULT_TEXT_FONT_SIZE_PX,
  DEFAULT_TEXT_LINE_HEIGHT,
} from "@/engine-v2/derivation";
import type { TextNodeV2, FieldPNodeV2 } from "@/types";

/** 面板只读展示，编辑动作由 api 承载；此处用空实现占位。 */
const api = new Proxy({}, { get: () => () => {} }) as never;

type AnyWrapper = VueWrapper<unknown>;

/**
 * 通用守卫：面板里的每个配置控件都不能「既无值、又无占位提示」（即视觉上完全空白）。
 * 复选框/单选框的 value 固定为 "on"，颜色选择器恒有值，均天然非空，跳过。
 */
function assertNoBareControls(wrapper: AnyWrapper): void {
  wrapper.findAll("input, textarea, select").forEach((el) => {
    const tag = el.element.tagName.toLowerCase();
    const type = el.attributes("type");
    if (type === "checkbox" || type === "radio") return;
    // select 永远显示所选选项的文本（即便 value 为空，如「居中（默认）」）——校验该文本非空即可。
    if (tag === "select") {
      const select = el.element as HTMLSelectElement;
      const label = select.options[select.selectedIndex]?.textContent ?? "";
      expect(label.trim() !== "", "空白配置项：<select> 无可见选项文本").toBe(true);
      return;
    }
    const value = (el.element as HTMLInputElement | HTMLTextAreaElement).value;
    const placeholder = el.attributes("placeholder") ?? "";
    expect(
      value !== "" || placeholder !== "",
      `空白配置项：<${tag}${type ? " type=" + type : ""}> 既无值也无占位`,
    ).toBe(true);
  });
}

/**
 * 「添加组件后，组件面板的配置项应渲染出对应的默认参数，而不是空着」的回归。
 *
 * 设计契约：schema 刻意**不落**默认值（缺省即用引擎 / CSS 默认，见 `useSchemaEdits`
 * 的「空/非法→undefined」用例）。故默认值只在面板**展示**，不写回 schema；对确无默认的
 * 自由文本项（字体族 / HTML 片段 / 图片地址 / 前·后标签…）给出占位提示，避免视觉空白。
 */
describe("组件面板：新建节点的默认参数渲染", () => {
  it("文本：字号 / 行高显示生效默认（13 / 1.6），与渲染层 CSS 一致", () => {
    const wrapper = mount(TextInspector, {
      props: { node: createTextNodeV2() as TextNodeV2, api },
    });
    const numbers = wrapper.findAll('input[type="number"]');
    expect((numbers[0].element as HTMLInputElement).value).toBe(
      String(DEFAULT_TEXT_FONT_SIZE_PX),
    );
    expect((numbers[1].element as HTMLInputElement).value).toBe(String(DEFAULT_TEXT_LINE_HEIGHT));
    // 内容有默认文案
    expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toBe("固定文本");
    assertNoBareControls(wrapper);
  });

  it("输入框：字段名默认「字段」，可选文本项均有占位（不留空）", () => {
    const wrapper = mount(FieldPInspector, {
      props: { node: createFieldPNodeV2() as FieldPNodeV2, api },
    });
    expect(wrapper.find("input").element.value).toBe("字段");
    expect(wrapper.find('input[placeholder="如「单位：」"]').exists()).toBe(true);
    expect(wrapper.find('input[placeholder="如「元」"]').exists()).toBe(true);
    expect(wrapper.find("textarea[placeholder]").exists()).toBe(true);
    assertNoBareControls(wrapper);
  });

  it("网格：行列 / 边框 / 列宽有默认，间距与内边距显示生效默认 0", () => {
    const wrapper = mount(GridInspector, { props: { node: createGridNodeV2(), api } });
    expect((wrapper.find('[data-dimension="rows"]').element as HTMLInputElement).value).toBe("1");
    expect((wrapper.find('[data-dimension="columns"]').element as HTMLInputElement).value).toBe(
      "1",
    );
    expect((wrapper.find('[data-grid="gap"]').element as HTMLInputElement).value).toBe("0");
    expect(
      (wrapper.find('[data-cell-default="padding"]').element as HTMLInputElement).value,
    ).toBe("0");
    assertNoBareControls(wrapper);
  });

  it("表格：最小行数 / 边框 / 表头样式 / 列配置均有默认", () => {
    const wrapper = mount(TableInspector, { props: { node: createTableNodeV2(), api } });
    const numbers = wrapper.findAll('input[type="number"]');
    expect((numbers[0].element as HTMLInputElement).value).toBe("4"); // 最小行数
    expect((numbers[1].element as HTMLInputElement).value).toBe("16"); // 表头字号默认 16（CSS）
    const selects = wrapper.findAll("select");
    expect((selects[0].element as HTMLSelectElement).value).toBe("all"); // 边框
    // 表头粗细的生效默认是「加粗」：`.layout-table__header` CSS 为 600，未设 headerStyle 时
    // 表头视觉即加粗，面板此前显示「常规」与实际不符。
    expect((selects[1].element as HTMLSelectElement).value).toBe("bold");
    expect(wrapper.findAll('[data-table-columns="true"] .v2-col-table__row').length).toBe(3); // 表头 + 2 列
    assertNoBareControls(wrapper);
  });

  it("格子：内边距 / 行高倍数显示生效默认（0 / 1），不留空", () => {
    const cell = createGridNodeV2().rows[0].cells[0];
    const wrapper = mount(CellInspector, {
      props: {
        node: cell,
        cellContext: null,
        cellBox: { padding: DEFAULT_CELL_PADDING, align: "center", verticalAlign: "middle" },
        api,
      },
    });
    expect(
      (wrapper.find('[data-cell-padding="true"]').element as HTMLInputElement).value,
    ).toBe(String(DEFAULT_CELL_PADDING));
    expect(
      (wrapper.find('[data-cell-row-height="true"]').element as HTMLInputElement).value,
    ).toBe(String(DEFAULT_CELL_ROW_HEIGHT));
    assertNoBareControls(wrapper);
  });

  it("格子：内边距显示 Grid 级生效值（cellBox）而非留空", () => {
    const cell = createGridNodeV2().rows[0].cells[0];
    const wrapper = mount(CellInspector, {
      props: {
        node: cell,
        cellContext: null,
        cellBox: { padding: 3, align: "center", verticalAlign: "middle" },
        api,
      },
    });
    expect(
      (wrapper.find('[data-cell-padding="true"]').element as HTMLInputElement).value,
    ).toBe("3");
    assertNoBareControls(wrapper);
  });

  it("HTML 模块：HTML 片段与样式均有占位提示（内容无默认值，不臆造内容）", () => {
    const wrapper = mount(HtmlInspector, { props: { node: createHtmlNodeV2(), api } });
    const areas = wrapper.findAll("textarea");
    expect(areas).toHaveLength(2);
    areas.forEach((a) => expect((a.attributes("placeholder") ?? "").length).toBeGreaterThan(0));
    assertNoBareControls(wrapper);
  });

  it("图片：字段名 / 地址 / 宽高均有占位提示，填充方式有默认 contain", () => {
    const wrapper = mount(ImageInspector, { props: { node: createImageNodeV2(), api } });
    expect(wrapper.find('input[placeholder="绑定数据字段（可选）"]').exists()).toBe(true);
    expect(wrapper.find('input[placeholder="https:// 链接或 Base64"]').exists()).toBe(true);
    expect(wrapper.findAll('input[placeholder="如 40"]')).toHaveLength(2);
    expect((wrapper.find("select").element as HTMLSelectElement).value).toBe("contain");
    assertNoBareControls(wrapper);
  });
});

/**
 * 页面属性「基础字号」＝全局默认字号（2026-09-17 需求）：
 * 设定后作用于所有未单独设字号的文字，表格表头按 16/13 等比跟随。
 * 面板必须显示**生效值**（未设 = 13），而不是留空或写死 16 —— 与本文件其余用例同一契约。
 */
describe("页面属性：基础字号（全局默认字号）", () => {
  function mountPage(props: { baseFontSize: number; baseRowHeight?: number }) {
    return mount(PageInspector, {
      props: {
        paperSize: "A4",
        baseRowHeight: props.baseRowHeight ?? 8,
        baseFontSize: props.baseFontSize,
        paperMarginTop: 12,
        paperMarginRight: 12,
        paperMarginBottom: 12,
        paperMarginLeft: 12,
        paginate: true,
        "onUpdate:paginate": () => {},
        api,
      },
    });
  }

  it("页面属性里有「基础字号」，显示生效值并带合法区间", () => {
    const wrapper = mountPage({ baseFontSize: 13 });
    const input = wrapper.find('[data-base-font-size="true"]');
    expect(input.exists()).toBe(true);
    expect((input.element as HTMLInputElement).value).toBe("13");
    expect((input.element as HTMLInputElement).min).toBe("6");
    expect((input.element as HTMLInputElement).max).toBe("72");
    assertNoBareControls(wrapper);
  });

  it("页面属性显示的是当前基础字号（不一定等于默认 13）", () => {
    const wrapper = mountPage({ baseFontSize: 18 });
    expect(
      (wrapper.find('[data-base-font-size="true"]').element as HTMLInputElement).value,
    ).toBe("18");
  });

  it("文本 / 输入框：字号默认跟随基础字号，行高不受影响", () => {
    const text = mount(TextInspector, {
      props: { node: createTextNodeV2() as TextNodeV2, baseFontSize: 16, api },
    });
    const nums = text.findAll('input[type="number"]');
    expect((nums[0].element as HTMLInputElement).value).toBe("16");
    expect((nums[1].element as HTMLInputElement).value).toBe(String(DEFAULT_TEXT_LINE_HEIGHT));

    const field = mount(FieldPInspector, {
      props: { node: createFieldPNodeV2() as FieldPNodeV2, baseFontSize: 16, api },
    });
    expect(
      (field.findAll('input[type="number"]')[0].element as HTMLInputElement).value,
    ).toBe("16");
  });

  it("表格：表头字号默认随基础字号等比（13 → 16，22 → 27）", () => {
    const defaultWrapper = mount(TableInspector, {
      props: { node: createTableNodeV2(), baseFontSize: 13, api },
    });
    expect(
      (defaultWrapper.find('[data-table-header-font-size="true"]').element as HTMLInputElement)
        .value,
    ).toBe("16");

    const largerWrapper = mount(TableInspector, {
      props: { node: createTableNodeV2(), baseFontSize: 22, api },
    });
    expect(
      (largerWrapper.find('[data-table-header-font-size="true"]').element as HTMLInputElement)
        .value,
    ).toBe("27"); // 22 × 16/13 = 27.08 → 27
    assertNoBareControls(largerWrapper);
  });
});
