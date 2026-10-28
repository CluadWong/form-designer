import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import HelpLink from "@/components/designer/inspectors/HelpLink.vue";
import { HELP_OPEN_KEY } from "@/components/designer/help-anchor";

/**
 * 属性面板里的「?」（2026-10-28）。
 *
 * 锁两件事：**没有注入就不渲染**（InspectorPanel 被单独挂载时不能出现一个点了没反应的按钮）、
 * 有注入时点击把 section 原样交给宿主。
 */
describe("HelpLink 上下文帮助入口", () => {
  it("未注入 openHelp：不渲染按钮", () => {
    const wrapper = mount(HelpLink, { props: { section: "sign" } });
    expect(wrapper.find(".v2-help-link").exists()).toBe(false);
  });

  it("已注入：渲染按钮，点击带上 section 调用 openHelp", async () => {
    const openHelp = vi.fn();
    const wrapper = mount(HelpLink, {
      props: { section: "sign", hint: "查看电子签名" },
      global: { provide: { [HELP_OPEN_KEY as symbol]: openHelp } },
    });
    const button = wrapper.find(".v2-help-link");
    expect(button.exists()).toBe(true);
    expect(button.attributes("title")).toBe("查看电子签名");
    expect(button.attributes("data-help-link")).toBe("sign");

    await button.trigger("click");
    expect(openHelp).toHaveBeenCalledWith("sign");
  });
});
