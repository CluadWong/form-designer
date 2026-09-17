import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import FormDesigner from "@/components/designer/FormDesigner.vue";
import { makeFiftyRowGridSchema } from "@/dev/gridPaginationDemo";

/**
 * 「页面属性 → 基础字号」的**提交时机 + 传导**回归。
 *
 * 契约：该输入框绑 `@change`（失焦 / 回车提交），与面板其余数值输入一致。提交后
 * 基础字号写入 `FormSchemaV2.baseFontSize`，经纸张 CSS 变量作用于所有未单独设字号的
 * 文字，且**随后放置**的组件面板默认字号要等于基础字号（而非引擎默认 13）。
 *
 * 注意：曾因「拖拽起手不会让输入框失焦」的推断把绑定改为 `@input`，但该推断未经浏览器
 * 验证，实测 `@change` 下放置组件正常跟随，故恢复 `@change`。本组用例按 `@change`
 * 语义固化：**只派发 input 不提交，派发 change 才提交**。
 */
function mountDesigner() {
  return mount(FormDesigner, { props: { initialSchema: makeFiftyRowGridSchema() } });
}

/** 选中左侧树里第一个匹配的节点。 */
async function selectRow(
  wrapper: ReturnType<typeof mountDesigner>,
  text: string,
): Promise<void> {
  const row = wrapper.findAll(".v2-tree-row").find((r) => r.text().includes(text));
  await row?.trigger("click");
  await nextTick();
}

function paperStyle(wrapper: ReturnType<typeof mountDesigner>): string {
  return wrapper.find(".grid-form-paper").attributes("style") ?? "";
}

const BASE_FONT_SIZE_INPUT = '[data-base-font-size="true"]';

/** 模拟用户输入并**失焦 / 回车**：派发 `change`。 */
async function commitBaseFontSize(
  wrapper: ReturnType<typeof mountDesigner>,
  value: string,
): Promise<void> {
  const input = wrapper.find(BASE_FONT_SIZE_INPUT);
  await input.setValue(value);
  await nextTick();
}

/** 模拟「只敲了键、尚未失焦」：**只派发 `input`，不派发 `change`**。 */
async function typeBaseFontSizeWithoutCommit(
  wrapper: ReturnType<typeof mountDesigner>,
  value: string,
): Promise<void> {
  const input = wrapper.find(BASE_FONT_SIZE_INPUT);
  (input.element as HTMLInputElement).value = value;
  await input.trigger("input");
  await nextTick();
}

function baseFontSizeDomValue(wrapper: ReturnType<typeof mountDesigner>): string {
  return (wrapper.find(BASE_FONT_SIZE_INPUT).element as HTMLInputElement).value;
}

describe("FormDesigner 基础字号：提交时机与传导", () => {
  it("失焦（change）即写入并作用到纸张 CSS 变量，表头按 16/13 等比跟随", async () => {
    const wrapper = mountDesigner();
    await selectRow(wrapper, "页面");

    expect(paperStyle(wrapper)).toContain("--v2-base-font-size: 13px");

    await commitBaseFontSize(wrapper, "20");

    const after = paperStyle(wrapper);
    expect(after).toContain("--v2-base-font-size: 20px");
    expect(after).toContain("--v2-table-header-font-size: 25px");
  });

  it("只敲键未失焦（仅 input）不写入 schema（提交时机的既有契约）", async () => {
    const wrapper = mountDesigner();
    await selectRow(wrapper, "页面");

    await typeBaseFontSizeWithoutCommit(wrapper, "20");

    // 未失焦 → 不提交：画布与 schema 保持原值。
    expect(paperStyle(wrapper)).toContain("--v2-base-font-size: 13px");

    // 失焦后才生效。
    await commitBaseFontSize(wrapper, "20");
    expect(paperStyle(wrapper)).toContain("--v2-base-font-size: 20px");
  });

  it("提交后放置的文本组件：面板字号默认值 = 基础字号（不再是引擎默认 13）", async () => {
    const wrapper = mountDesigner();
    await selectRow(wrapper, "页面");
    await commitBaseFontSize(wrapper, "20");

    await selectRow(wrapper, "格子 1-1");
    await wrapper.find('[data-palette="text"]').trigger("click");
    await nextTick();

    const numbers = wrapper
      .findAll('input[type="number"]')
      .map((n) => (n.element as HTMLInputElement).value);
    // 文本面板：字号 = 基础字号 20；行高 = 引擎默认 1.6
    expect(numbers).toEqual(["20", "1.6"]);
  });

  it("提交后放置的表格：表头字号默认值按基础字号等比缩放", async () => {
    const wrapper = mountDesigner();
    await selectRow(wrapper, "页面");
    await commitBaseFontSize(wrapper, "20");

    await selectRow(wrapper, "格子 1-2");
    await wrapper.find('[data-palette="table"]').trigger("click");
    await nextTick();

    const numbers = wrapper
      .findAll('input[type="number"]')
      .map((n) => (n.element as HTMLInputElement).value);
    expect(numbers).toEqual(["4", "25"]);
  });

  it("低于下限的输入不写入 schema，且输入框回写为生效值（显示与生效一致）", async () => {
    const wrapper = mountDesigner();
    await selectRow(wrapper, "页面");

    await commitBaseFontSize(wrapper, "2");

    // 关键：schema 未被写入（仍是默认 13px），而不是被钳制成 6px。
    expect(paperStyle(wrapper)).toContain("--v2-base-font-size: 13px");
    // 且输入框不留残余非法字符 —— 提交被跳过时组件不重渲染，需手工回写。
    expect(baseFontSizeDomValue(wrapper)).toBe("13");

    // 改为合法值后正常提交。
    await commitBaseFontSize(wrapper, "20");
    expect(paperStyle(wrapper)).toContain("--v2-base-font-size: 20px");
    expect(baseFontSizeDomValue(wrapper)).toBe("20");
  });
});
