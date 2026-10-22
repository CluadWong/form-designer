import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import GridFormRenderer from "@/components/renderer-v2/GridFormRenderer.vue";
import { makeYunlvSecondTicketFirstFiveRowsSchema } from "@/dev/yunlv-second-ticket-first-five-rows";
import demoData from "@/dev/demoData";
import type { FormDataV2 } from "@/types";

/**
 * A3「统一渲染路径」验收闸门：消费态（非 design）走同一条渲染路径，
 * 即「填充 = 渲染组件 + 数据」，而不是另起一套 DOM。
 *
 * 背景：G11 曾把填写态做成 `<textarea class="layout-p__control">` 分支，导致「浏览/打印看到的版式」
 * 与「填写时的版式」在换行、行高、innerBorder 逐行横线上不一致；十续已回退该分支，
 * 字段统一为可编辑 `<p>`（复合字段为其中的 `.layout-p__input`）。本文件把这条不变式固化成断言，
 * 防止将来再次分化出两套渲染路径。
 *
 * 口径（2026-09-04 内核收拢为 design | preview 两值，与消费态契约一致）：
 * - 内核非设计态仅剩 `preview` 一个值，与旧 `fill` 完全等价（消费态）；
 * - 真正的「不可输入」由 `readonly` 闸门决定，与 `mode` 正交
 *   （`FormRenderer` 默认 `readonly=true` 只读回显、显式 `readonly=false` 进入填写态；设计器预览态显式传 `:readonly="false"`）。
 * 故本文件锁一条核心不变式：**非设计态渲染结果只受 `readonly` 闸门影响，且差异仅限 `contenteditable`**。
 *
 * 设计态（design）不在此不变式内：它无 data、字段显示 `default` 占位，且按 A2 拍板
 * 保留 contenteditable 就地输入以查看交互效果，与交付态本就不同源。
 */
const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
const data = { ...(demoData as Record<string, unknown>) } as FormDataV2;

type RenderCase = {
  readonly?: boolean;
  paginate?: boolean;
};

function renderHtml({ readonly = false, paginate = false }: RenderCase): string {
  return renderWrapper({ readonly, paginate }).html();
}

function renderWrapper({ readonly = false, paginate = false }: RenderCase) {
  return mount(GridFormRenderer, {
    props: { schema, data, mode: "preview", readonly, paginate },
  });
}

/**
 * DOM **结构签名**：标签名 + 属性（除 `contenteditable`）+ 非空文本，递归展开。
 *
 * 为什么不用 HTML 字符串直接比：可填写态多出的 `.layout-p__clear`（清空按钮，2026-10-21）
 * 被剔除后，差异还会落在**格式化空白**上（pretty-print 一行一个元素，删元素就多一空行），
 * 逐字符比必然假报警。结构签名天然忽略注释节点、空文本与缩进，只比真正参与渲染的东西。
 *
 * 允许的差异只有两处，均在签名里归一：
 * 1. `contenteditable`（只读闸门）；
 * 2. 清空按钮——它是交互元素，只读回显里本就不该存在；按钮绝对定位、不携带版式，
 *    属「哪一态能改值」的产品差异，不是渲染路径分叉。
 */
function signatureOf(el: Element): string {
  const children: string[] = [];
  el.childNodes.forEach((child) => {
    if (child.nodeType === 1) {
      const element = child as Element;
      if (element.classList.contains("layout-p__clear")) return;
      children.push(signatureOf(element));
      return;
    }
    if (child.nodeType === 3) {
      const text = child.nodeValue ?? "";
      if (text.trim() !== "") children.push(`#${text}`);
    }
  });
  const attrs = Array.from(el.attributes)
    .filter((attr) => attr.name !== "contenteditable")
    .map((attr) => `${attr.name}="${attr.value}"`)
    .sort()
    .join(" ");
  return `<${el.tagName.toLowerCase()} ${attrs}>[${children.join("")}]`;
}

function countEditable(html: string): number {
  return html.match(/ contenteditable="true"/g)?.length ?? 0;
}

function countPages(html: string): number {
  return html.match(/class="grid-form-paper"/g)?.length ?? 0;
}

describe("A3 统一渲染路径：消费态（preview）同构", () => {
  it("可填写（readonly=false）与只读（readonly=true）只差 contenteditable 与清空按钮，DOM 结构一致", () => {
    const editable = renderHtml({ readonly: false });
    const readonly = renderHtml({ readonly: true });

    // 结构签名：忽略 contenteditable、注释、空白与清空按钮后必须逐节点一致
    expect(signatureOf(renderWrapper({ readonly: false }).element)).toBe(
      signatureOf(renderWrapper({ readonly: true }).element),
    );
    // 且确实只差这些：可填写态每个字段都有 contenteditable，只读态一个都没有
    expect(countEditable(editable)).toBeGreaterThan(0);
    expect(countEditable(readonly)).toBe(0);
  });

  it("消费态不再出现 textarea / input 控件（十续回退 textarea 分支后的统一结构）", () => {
    for (const html of [
      renderHtml({ readonly: false }),
      renderHtml({ readonly: true }),
    ]) {
      expect(html).not.toContain("<textarea");
      expect(html).not.toContain("<input");
      expect(html).not.toContain("layout-p__control");
    }
  });

  it("只读闸门对普通字段与复合字段同口径（无「一类可编辑、一类不可」的割裂）", () => {
    const editable = renderHtml({ readonly: false });
    const readonly = renderHtml({ readonly: true });

    // 样例含复合字段（如「共 ___ 人」）与普通字段，二者在只读下都应失去 contenteditable
    const inputs = (html: string): number =>
      html.match(/class="layout-p__input[^"]*"/g)?.length ?? 0;
    expect(inputs(editable)).toBeGreaterThan(0);
    expect(inputs(editable)).toBe(inputs(readonly));
    expect(readonly).not.toMatch(/class="layout-p__input[^"]*" contenteditable/);
    expect(editable).toMatch(/class="layout-p__input[^"]*" contenteditable="true"/);
  });

  it("分页开启时，只读态 / 填写态的物理页数一致（分页结果不因 readonly 而分叉）", () => {
    const pages = [
      renderHtml({ readonly: false, paginate: true }),
      renderHtml({ readonly: true, paginate: true }),
    ].map(countPages);
    expect(pages[0]).toBeGreaterThan(0);
    expect(pages[1]).toBe(pages[0]);
  });
});
