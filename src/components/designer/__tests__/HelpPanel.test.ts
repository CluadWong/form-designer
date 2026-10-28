import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import HelpPanel from "@/components/designer/HelpPanel.vue";

/**
 * 应用内帮助面板（2026-09-08）：工具栏「帮助」按钮触发的浮层。
 * 锁四件事：关闭态零 DOM、打开态内容可见、三条关闭途径（✕ / 遮罩 / Esc）、
 * 以及「初始即 open」时 Esc 监听也已挂上（immediate watch 契约）。
 */
describe("HelpPanel 应用内帮助面板", () => {
  it("关闭时不渲染任何浮层 DOM", () => {
    const wrapper = mount(HelpPanel, { props: { open: false } });
    expect(wrapper.find(".v2-help").exists()).toBe(false);
  });

  it("打开时渲染面板与指南内容（含操作指南 / 快捷键 / 术语速查）", async () => {
    const wrapper = mount(HelpPanel, { props: { open: false } });
    await wrapper.setProps({ open: true });
    expect(wrapper.find(".v2-help__panel").exists()).toBe(true);
    expect(wrapper.text()).toContain("操作指南");
    expect(wrapper.text()).toContain("Ctrl/Cmd + S");
    expect(wrapper.text()).toContain("术语速查");
  });

  it("右上 ✕ 按钮触发 close", async () => {
    const wrapper = mount(HelpPanel, { props: { open: true } });
    await wrapper.find(".v2-help__close").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("点击遮罩（面板外）触发 close", async () => {
    const wrapper = mount(HelpPanel, { props: { open: true } });
    await wrapper.find(".v2-help").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("Esc 键触发 close；转 closed 后监听摘除、再按 Esc 不再触发", async () => {
    // 初始即 open：验证 immediate watch 在首挂载就挂上了 Esc 监听。
    const wrapper = mount(HelpPanel, { props: { open: true } });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(wrapper.emitted("close")).toHaveLength(1);

    await wrapper.setProps({ open: false });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
});

/**
 * 2026-10-28 重做后的契约：速查式结构（左目录 + 折叠小节 + 搜索）与上下文定位。
 * 锁四件事：目录项与每个小节一一对应、搜索只留命中节、无命中给空态、
 * `section` prop 能把指定小节展开（属性面板「?」的定位链路末端）。
 */
describe("HelpPanel 速查结构与搜索", () => {
  function mountOpen() {
    return mount(HelpPanel, { props: { open: true } });
  }

  it("目录项与正文小节一一对应（同一批 id）", () => {
    const wrapper = mountOpen();
    const navIds = wrapper.findAll("[data-help-nav]").map((n) => n.attributes("data-help-nav"));
    const sectionIds = wrapper
      .findAll("[data-help-section]")
      .map((n) => n.attributes("data-help-section"));
    expect(navIds.length).toBeGreaterThan(5);
    expect(navIds).toEqual(sectionIds);
  });

  it("默认只展开首节（三步上手），其余收起", () => {
    const wrapper = mountOpen();
    expect(wrapper.find('[data-help-section="start"]').attributes("open")).toBeDefined();
    expect(wrapper.find('[data-help-section="keys"]').attributes("open")).toBeUndefined();
  });

  it("点目录项：对应小节展开并成为当前项", async () => {
    const wrapper = mountOpen();
    await wrapper.find('[data-help-nav="keys"]').trigger("click");
    expect(wrapper.find('[data-help-section="keys"]').attributes("open")).toBeDefined();
    expect(wrapper.find('[data-help-nav="keys"]').classes()).toContain("is-active");
  });

  it("搜索只保留命中小节，并自动展开", async () => {
    const wrapper = mountOpen();
    await wrapper.find("[data-help-search]").setValue("签名");
    await nextTick();
    expect(wrapper.find('[data-help-section="sign"]').classes()).not.toContain("is-hidden");
    expect(wrapper.find('[data-help-section="sign"]').attributes("open")).toBeDefined();
    // 与「签名」无关的节被隐藏
    expect(wrapper.find('[data-help-section="keys"]').classes()).toContain("is-hidden");
  });

  it("搜索无命中：给出空态提示，不出现空白面板", async () => {
    const wrapper = mountOpen();
    await wrapper.find("[data-help-search]").setValue("zzzz-不存在");
    await nextTick();
    expect(wrapper.find(".v2-help__empty").exists()).toBe(true);
    expect(wrapper.find(".v2-help__empty").text()).toContain("zzzz-不存在");
  });

  it("section prop：打开时定位并展开指定小节（属性面板「?」的落点）", async () => {
    const wrapper = mount(HelpPanel, { props: { open: false } });
    await wrapper.setProps({ open: true, section: "clear" });
    await nextTick();
    expect(wrapper.find('[data-help-section="clear"]').attributes("open")).toBeDefined();
    expect(wrapper.find('[data-help-nav="clear"]').classes()).toContain("is-active");
  });
});
