import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { compileStyle } from "@vue/compiler-sfc";
import { GridFormRenderer } from "@/components/renderer-v2";
import {
  appendNodeToCellV2,
  createEmptyFormSchemaV2,
  createFieldPNodeV2,
  createGridNodeV2,
  insertRootGridV2,
} from "@/types/schema-v2-operations";

/**
 * 字段 P 回车换行（2026-10-13）
 *
 * 症状：设计器导出的模板里，**没有前后标签**的输入框（第一行）回车不换行；
 * **有前标签**的（`prefix: "1"`）回车正常换行。
 *
 * 根因（无头 Chromium 115 + 真键盘实测，见 `headless-layout-geometry-probe`）：
 * Chrome 在 contenteditable 里回车时**不插 `<div>`**，而是**克隆光标所在内联上下文的元素**
 * —— 此处即 `<span class="layout-p__value">`。无前后标签的字段，可编辑区就是 `.layout-p`
 * 自身（`display:flex`），于是这些值元素成为 flex item、并排在同一视觉行上：
 * `innerText` 里其实已经有 `\n`，视觉上却不换行（实测两个值元素 `top` 完全相同）。
 * 有前标签的字段值元素在 `.layout-p__input` 内，被 `> .layout-p__value{display:block;width:100%}`
 * 兜住，所以看着正常 —— 这也解释了「为什么只有第一种不换行」。
 *
 * 修复：`GridSchemaNode.vue` 样式里新增 `.layout-p :deep(> .layout-p__value){flex:1 1 100%}`
 * —— 让直接挂在 `.layout-p` 下的值元素占满整行，连续多个自然折行。
 *
 * jsdom 没有编辑管线（插不了、也量不出），故测试锁**成因侧**两条：
 * ① 编译后的样式里确有该规则 —— 且限定为 `.layout-p` 的**直接子级**，不误伤复合字段；
 * ② 真实渲染出的 DOM 里，非复合字段的值元素确实是 `.layout-p` 的**直接子级**
 *    （若结构变了，① 的规则永远匹配不到 —— 上一版 `:deep(div)` 规则失效正是这个原因：
 *    它假设浏览器插 `<div>`，而实际插的是克隆出来的 span）。
 *
 * 真机行为与修复效果见 `docs/engine.md` §26。
 */
import schemaNodeSource from "@/components/renderer-v2/GridSchemaNode.vue?raw";

function buildSchema() {
  const blank = createEmptyFormSchemaV2();
  const grid = createGridNodeV2({ rows: 2, columns: 1 });
  let schema = insertRootGridV2(blank, grid);
  const plain = createFieldPNodeV2("字段");
  const composite = createFieldPNodeV2("字段2") as { prefix?: string };
  composite.prefix = "1";
  schema = appendNodeToCellV2(schema, grid.rows[0].cells[0].id, plain);
  schema = appendNodeToCellV2(
    schema,
    grid.rows[1].cells[0].id,
    composite as never,
  );
  return schema;
}

/** 取出 `<style scoped>` 编译后的 CSS（与真实构建同一条编译路径）。 */
function compiledCss(): string {
  const match = schemaNodeSource.match(/<style[^>]*scoped[^>]*>([\s\S]*?)<\/style>/);
  if (!match) throw new Error("GridSchemaNode.vue 里找不到 <style scoped>");
  const res = compileStyle({
    source: match[1],
    filename: "GridSchemaNode.vue",
    id: "data-v-test",
    scoped: true,
  });
  // 去掉注释后再解析：注释里含有反引号与 `{}`，会把规则切碎。
  return res.code.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 命中某条声明（如 `flex: 1 1 100%`）的全部规则选择器（已 trim、去多余空白）。 */
function rulesWith(css: string, declaration: RegExp): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = m[1].replace(/\s+/g, " ").trim();
    const body = m[2].replace(/\s+/g, " ").trim();
    if (declaration.test(body)) out.push({ selector, body });
  }
  return out;
}

describe("字段 P 回车换行（无前后标签的字段）", () => {
  describe("① 样式规则：值元素占满整行（不被误伤到复合字段）", () => {
    const css = compiledCss();

    it("存在「`.layout-p` 的直接子级 `.layout-p__value` 占满整行」的规则", () => {
      // 修复前这条不存在：旧规则只覆盖 `div`，而浏览器插的是克隆出来的 span。
      const hit = rulesWith(css, /flex: 1 1 100%|flex-basis: 100%/).filter(
        (r) => r.selector === ".layout-p[data-v-test] > .layout-p__value",
      );
      expect(
        hit,
        `期望有「.layout-p 的直接子级 .layout-p__value 占满整行」的规则，实际命中：${JSON.stringify(
          rulesWith(css, /flex: 1 1 100%|flex-basis: 100%/).map((r) => r.selector),
        )}`,
      ).toHaveLength(1);
    });

    it("该规则限定为直接子级：不会把 `.layout-p__input` 内的值元素也改成 flex 项", () => {
      const selectors = rulesWith(css, /flex: 1 1 100%|flex-basis: 100%/).map((r) => r.selector);
      // 复合字段的值元素由 `.layout-p__input > .layout-p__value{display:block;width:100%}` 兜住，
      // 不应再被 flex 规则命中（否则会把它的宽度语义改掉）。
      expect(selectors.some((s) => s.includes(".layout-p__input"))).toBe(false);
    });

    it("复合字段那半条机制仍在（`display:block;width:100%`）—— 它是有前标签时能换行的原因", () => {
      const selectors = rulesWith(css, /display: block/).map((r) => r.selector);
      expect(selectors).toContain(".layout-p__input > .layout-p__value[data-v-test]");
    });
  });

  describe("② 渲染结构：值元素确实是可编辑宿主的直接子级", () => {
    const wrapper = mount(GridFormRenderer, {
      props: { schema: buildSchema(), mode: "preview" },
    });

    it("非复合字段：可编辑宿主就是 `.layout-p` 自身，值元素是它的直接子级", () => {
      const host = wrapper.find(".layout-p:not(.layout-p--composite)");
      expect(host.exists()).toBe(true);
      // 宿主必须可编辑 —— 「Chrome 克隆光标所在内联元素」的前提。
      expect(host.attributes("contenteditable")).toBe("true");

      const children = [...host.element.children];
      expect(children).toHaveLength(1);
      expect(children[0].classList.contains("layout-p__value")).toBe(true);
    });

    it("复合字段：宿主是 `.layout-p__input`，值元素不在 `.layout-p` 直接子级上", () => {
      const composite = wrapper.find(".layout-p--composite");
      expect(composite.exists()).toBe(true);

      // `.layout-p` 自身不承载输入（值元素在更内层），故不该被 ① 的规则命中。
      const directValue = [...composite.element.children].some((c) =>
        c.classList.contains("layout-p__value"),
      );
      expect(directValue).toBe(false);

      const input = composite.find(".layout-p__input");
      expect(input.attributes("contenteditable")).toBe("true");
      const inner = [...input.element.children];
      expect(inner).toHaveLength(1);
      expect(inner[0].classList.contains("layout-p__value")).toBe(true);
    });
  });
});
