import { describe, expect, it } from "vitest";
import { mount, type DOMWrapper } from "@vue/test-utils";
import { nextTick as vueNextTick } from "vue";
import FormDesigner from "@/components/designer/FormDesigner.vue";
import { DATA_STORAGE_KEY } from "@/components/designer/composables/useFillData";

/** 定位「填充数据」工具组，避免与 schema 组的「保存 / 导出文件」按钮混淆。 */
function findFillDataGroup(wrapper: ReturnType<typeof mount>): DOMWrapper<Element> {
  const groups = wrapper.findAll(".v2-toolbar__group");
  const group = groups.find((g) => g.text().includes("填充数据"));
  if (!group) throw new Error("未找到「填充数据」工具组");
  return group;
}

function buttonByText(
  group: DOMWrapper<Element>,
  text: string,
): DOMWrapper<HTMLButtonElement> {
  const btn = group.findAll("button").find((b) => b.text().trim() === text);
  if (!btn) throw new Error(`工具组内未找到按钮：${text}`);
  return btn;
}

describe("B2 填充数据导入/导出生命周期（三十续）", () => {
  it("设计态：填充数据组含 保存数据/读取数据/导入数据/导出数据，且四个按钮均可用", () => {
    const wrapper = mount(FormDesigner, { props: { uiConfig: { showFillDataModule: true } } });
    const group = findFillDataGroup(wrapper);
    const importBtn = buttonByText(group, "导入数据");
    const exportBtn = buttonByText(group, "导出数据");
    const loadBtn = buttonByText(group, "读取数据");
    const saveBtn = buttonByText(group, "保存数据");

    expect(importBtn.exists()).toBe(true);
    expect(loadBtn.exists()).toBe(true);
    expect(exportBtn.exists()).toBe(true);
    // 四个按钮都不限预览态（2026-09-11）：导出/保存数据在设计态采集到的是字段默认值，
    // 表单没有配置字段时导出（保存）的就是 `{}`。
    expect(importBtn.attributes("disabled")).toBeUndefined();
    expect(loadBtn.attributes("disabled")).toBeUndefined();
    expect(exportBtn.attributes("disabled")).toBeUndefined();
    expect(saveBtn.attributes("disabled")).toBeUndefined();
  });

  it("预览态：导出数据/保存数据转为可用", async () => {
    const wrapper = mount(FormDesigner, { props: { uiConfig: { showFillDataModule: true } } });
    await wrapper.find('[data-view-mode="preview"]').trigger("click");
    await vueNextTick();

    const group = findFillDataGroup(wrapper);
    expect(buttonByText(group, "导出数据").attributes("disabled")).toBeUndefined();
    expect(buttonByText(group, "保存数据").attributes("disabled")).toBeUndefined();
  });

  it("设计态：点「保存数据」写本地存储；空表单存的是 {}", async () => {
    localStorage.clear();
    const wrapper = mount(FormDesigner, { props: { uiConfig: { showFillDataModule: true } } });
    await buttonByText(findFillDataGroup(wrapper), "保存数据").trigger("click");

    const raw = localStorage.getItem(DATA_STORAGE_KEY);
    expect(raw).not.toBeNull();
    // 默认空白模板（空 page + 空根 Grid）没有配字段 → 存 `{}`，不是 null / undefined。
    expect(JSON.parse(raw as string)).toEqual({});
  });
});
