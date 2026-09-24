import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import HtmlBlock from "@/components/renderer-v2/HtmlBlock.vue";
import { collectFieldValues } from "@/components/renderer-v2/collectFieldValues";
import type { HtmlNodeV2 } from "@/types";

/**
 * HTML 模块内字段的**权限切换**回归（2026-09-24）。
 *
 * 场景：宿主的权限面板允许在 HIDDEN / READ / EDIT 之间任意切换，切换只需改
 * `fieldPermissions`，片段本身**不重建**（`data-masked` / `contenteditable` 都是
 * `applyFieldState` 事后写上的、不进 markup 串）。
 *
 * 曾出现的缺陷：`HIDDEN → EDIT/READ` 后 `data-masked` 残留 ⇒ 票面值显示正常（回填照跑），
 * 但 `collectFieldValues` 按「脱敏字段」分支处理、**不从 DOM 取值** ⇒ 保存/采集为空。
 * 故本文件锁死「脱敏标记必须随权限切换被摘掉」这条契约。
 */

const node = (html: string): HtmlNodeV2 =>
  ({ id: "html-1", type: "html", html, css: "" }) as HtmlNodeV2;

function mountHtml(html: string, permissions: Record<string, "EDIT" | "READ" | "HIDDEN">) {
  return mount(HtmlBlock, {
    props: {
      node: node(html),
      data: { a: "真值" },
      readonly: false,
      fieldPermissions: permissions,
    },
  });
}

function fieldEl(wrapper: ReturnType<typeof mountHtml>, selector: string): HTMLElement {
  return wrapper.element.shadowRoot!.querySelector<HTMLElement>(selector)!;
}

describe("HTML 模块：字段权限切换后脱敏标记必须清除（原生 [data-field]）", () => {
  it("HIDDEN 态：假值 ***、标 data-masked、不可编辑", async () => {
    const wrapper = mountHtml('<p data-field="a"></p>', { a: "HIDDEN" });
    const el = fieldEl(wrapper, '[data-field="a"]');
    expect(el.textContent).toBe("***");
    expect(el.hasAttribute("data-masked")).toBe(true);
    expect(el.getAttribute("contenteditable")).toBe("false");
    wrapper.unmount();
  });

  it("HIDDEN → EDIT：脱敏标记摘掉、值回填、可编辑、可采集", async () => {
    const wrapper = mountHtml('<p data-field="a"></p>', { a: "HIDDEN" });
    await wrapper.setProps({ fieldPermissions: { a: "EDIT" } });
    await nextTick();

    const el = fieldEl(wrapper, '[data-field="a"]');
    expect(el.hasAttribute("data-masked")).toBe(false);
    expect(el.textContent).toBe("真值");
    expect(el.getAttribute("contenteditable")).toBe("true");
    // 关键：采集不再被误判为脱敏字段
    expect(collectFieldValues(wrapper.element).a).toBe("真值");
    wrapper.unmount();
  });

  it("HIDDEN → READ：脱敏标记摘掉、值回填但不可编辑，仍可采集", async () => {
    const wrapper = mountHtml('<p data-field="a"></p>', { a: "HIDDEN" });
    await wrapper.setProps({ fieldPermissions: { a: "READ" } });
    await nextTick();

    const el = fieldEl(wrapper, '[data-field="a"]');
    expect(el.hasAttribute("data-masked")).toBe(false);
    expect(el.textContent).toBe("真值");
    expect(el.getAttribute("contenteditable")).toBe("false");
    expect(collectFieldValues(wrapper.element).a).toBe("真值");
    wrapper.unmount();
  });

  it("HIDDEN 态采集：maskHidden 给 ***，否则按 baseData 回源、无源则省略", async () => {
    const wrapper = mountHtml('<p data-field="a"></p>', { a: "HIDDEN" });
    expect(collectFieldValues(wrapper.element, { maskHidden: true }).a).toBe("***");
    expect(collectFieldValues(wrapper.element, { baseData: { a: "真值" } }).a).toBe("真值");
    expect("a" in collectFieldValues(wrapper.element)).toBe(false);
    wrapper.unmount();
  });

  it("反复切换 HIDDEN ↔ EDIT 后状态不残留", async () => {
    const wrapper = mountHtml('<p data-field="a"></p>', { a: "EDIT" });
    for (let i = 0; i < 3; i += 1) {
      await wrapper.setProps({ fieldPermissions: { a: "HIDDEN" } });
      await nextTick();
      expect(fieldEl(wrapper, '[data-field="a"]').textContent).toBe("***");
      await wrapper.setProps({ fieldPermissions: { a: "EDIT" } });
      await nextTick();
      const el = fieldEl(wrapper, '[data-field="a"]');
      expect(el.hasAttribute("data-masked")).toBe(false);
      expect(el.textContent).toBe("真值");
    }
    expect(collectFieldValues(wrapper.element).a).toBe("真值");
    wrapper.unmount();
  });

  it("对照：{{field}} 占位写法靠重建清标记（markup 变化 ⇒ 走重建分支）", async () => {
    const wrapper = mountHtml("<p>{{a}}</p>", { a: "HIDDEN" });
    await wrapper.setProps({ fieldPermissions: { a: "EDIT" } });
    await nextTick();
    expect(collectFieldValues(wrapper.element).a).toBe("真值");
    wrapper.unmount();
  });
});
