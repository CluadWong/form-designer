import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import GridSchemaNode from "@/components/renderer-v2/GridSchemaNode.vue";

/**
 * 字段 P 失焦归一化（2026-10-21）
 *
 * 症状：多行字段依次输入 `1` `2` `3` `4`（每行一个）后 Tab 失焦，值变成
 * `1,2,3,4,2,3,4` —— 首段保留、换行之后的内容重复一遍。
 *
 * 根因（无头 Chromium 实测）：Chrome 在 contenteditable 里按 Enter **不插 `<div>`**，而是
 * **克隆光标所在的内联元素**（与 `FieldPLineBreak` 记录的成因一致）。输入四行后 DOM 是四个
 * 并列的 `span.layout-p__value`，`innerText` 读出来正确；但 Vue 只 patch **第一个** span，
 * 克隆出来的兄弟节点它不认识也删不掉 —— 回写后再读就把「值容器 + 残留克隆」叠加成两套。
 *
 * jsdom 没有编辑管线（既插不了也量不出），故这里**手工构造浏览器产出的脏 DOM**，并 stub
 * `innerText`（jsdom 未实现），锁两条：
 *   ① 归一时 `emit` 的值是「先读、后删」得到的完整值，不是清理后的残值；
 *   ② 归一遍之后 DOM 只剩一个值容器，再失焦一次不会读到重复内容（幂等）。
 */
function stubInnerText(el: HTMLElement, text: string): void {
  Object.defineProperty(el, "innerText", { configurable: true, get: () => text });
}

/** 复刻 Chrome 回车后的产物：值容器之后追加同 class 的兄弟 span。 */
function appendClonedSpans(container: HTMLElement, lines: string[]): void {
  lines.forEach((line) => {
    const span = document.createElement("span");
    span.className = "layout-p__value";
    span.textContent = line;
    container.appendChild(span);
  });
}

const fieldNode = {
  id: "content",
  type: "p" as const,
  mode: "field" as const,
  field: "安措内容",
  underline: true,
};

describe("字段 P 失焦归一化（多行输入不重复回写）", () => {
  it("普通字段：克隆出的兄弟 __value 被归一，emit 拿到完整多行值", async () => {
    const wrapper = mount(GridSchemaNode, {
      props: { node: fieldNode, baseRowHeight: 8, data: { 安措内容: "1" } },
    });

    const root = wrapper.element as HTMLElement;
    // Chrome 实际产物：第一个 span 是 Vue 的，后三个是回车克隆出来的
    appendClonedSpans(root, ["2", "3", "4"]);
    expect(root.querySelectorAll(".layout-p__value").length).toBe(4);

    stubInnerText(root, "1\n2\n3\n4");
    await wrapper.trigger("blur");

    // ① 先读后删：值必须是完整四行，不能因为清理丢掉克隆容器里的内容
    const ev = wrapper.emitted("field-change");
    expect(ev?.[0]).toEqual(["安措内容", "1\n2\n3\n4"]);

    // ② DOM 归一到单值容器
    const values = root.querySelectorAll(".layout-p__value");
    expect(values.length).toBe(1);
    expect(values[0].textContent).toBe("1\n2\n3\n4");
  });

  it("归一后再次失焦不会读到重复内容（幂等）", async () => {
    const wrapper = mount(GridSchemaNode, {
      props: { node: fieldNode, baseRowHeight: 8, data: { 安措内容: "1" } },
    });

    const root = wrapper.element as HTMLElement;
    appendClonedSpans(root, ["2", "3", "4"]);
    stubInnerText(root, "1\n2\n3\n4");
    await wrapper.trigger("blur");

    // 第二次失焦：此时 DOM 已归一，innerText 只可能是四行
    stubInnerText(root, "1\n2\n3\n4");
    await wrapper.trigger("blur");

    const ev = wrapper.emitted("field-change");
    expect(ev?.length).toBe(2);
    expect(ev?.[1]).toEqual(["安措内容", "1\n2\n3\n4"]);
    expect(root.querySelectorAll(".layout-p__value").length).toBe(1);
  });

  it("innerBorder 字段：按行重建 __line，清掉克隆出来的行 div", async () => {
    const wrapper = mount(GridSchemaNode, {
      props: {
        node: { ...fieldNode, innerBorder: true },
        baseRowHeight: 8,
        data: { 安措内容: "1\n2\n3\n4" },
      },
    });

    const root = wrapper.element as HTMLElement;
    const lines = root.querySelector(".layout-p__lines");
    expect(lines).toBeTruthy();
    // 回车克隆出的行 div 落在 .layout-p__lines 内
    ["2", "3", "4"].forEach((line) => {
      const d = document.createElement("div");
      d.className = "layout-p__line";
      d.textContent = line;
      lines!.appendChild(d);
    });
    expect(lines!.querySelectorAll(".layout-p__line").length).toBe(7);

    stubInnerText(root, "1\n2\n3\n4");
    await wrapper.trigger("blur");

    const ev = wrapper.emitted("field-change");
    expect(ev?.[0]).toEqual(["安措内容", "1\n2\n3\n4"]);
    // 按 text 重建：4 行，不多不少
    expect(lines!.querySelectorAll(".layout-p__line").length).toBe(4);
    expect(Array.from(lines!.querySelectorAll(".layout-p__line")).map((d) => d.textContent)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  it("复合字段：归一发生在 __input 内，前缀 / 后缀标签不受影响", async () => {
    const wrapper = mount(GridSchemaNode, {
      props: {
        node: {
          id: "member",
          type: "p" as const,
          mode: "field" as const,
          field: "工作班成员人数",
          prefix: "共",
          suffix: "人",
          underline: true,
        },
        baseRowHeight: 8,
        data: { 工作班成员人数: "1" },
      },
    });

    const input = wrapper.find(".layout-p__input");
    expect(input.exists()).toBe(true);

    appendClonedSpans(input.element as HTMLElement, ["2", "3"]);
    stubInnerText(input.element as HTMLElement, "1\n2\n3");
    await input.trigger("blur");

    const ev = wrapper.emitted("field-change");
    expect(ev?.[0]).toEqual(["工作班成员人数", "1\n2\n3"]);
    expect((input.element as HTMLElement).querySelectorAll(".layout-p__value").length).toBe(1);
    // 前缀 / 后缀为静态标签，不参与归一
    expect(wrapper.text()).toContain("共");
    expect(wrapper.text()).toContain("人");
  });

  it("裸文本与无 class 的块一并清掉（其他浏览器 / 粘贴产物）", async () => {
    const wrapper = mount(GridSchemaNode, {
      props: { node: fieldNode, baseRowHeight: 8, data: { 安措内容: "1" } },
    });

    const root = wrapper.element as HTMLElement;
    root.appendChild(document.createTextNode("残留"));
    const stray = document.createElement("div");
    stray.textContent = "游离";
    root.appendChild(stray);

    stubInnerText(root, "1\n2");
    await wrapper.trigger("blur");

    expect(root.querySelectorAll("div").length).toBe(0);
    expect((root.textContent ?? "").includes("残留")).toBe(false);
    expect(wrapper.emitted("field-change")?.[0]).toEqual(["安措内容", "1\n2"]);
  });
});
