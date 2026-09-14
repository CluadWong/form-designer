import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import DesignerToolbar from "@/components/designer/DesignerToolbar.vue";
import FormDesigner from "@/components/designer/FormDesigner.vue";
import {
  collectFormData,
  normalizeIncomingSchema,
  serializeFormDataJson,
  serializeSchemaJson,
  type FormDesignerExposed,
} from "@/components/designer/export-api";
import { createEmptyFormSchemaV2 } from "@/types";
import type { FormSchemaV2 } from "@/types";
import { makeYunlvSecondTicketFirstFiveRowsSchema } from "@/dev/yunlv-second-ticket-first-five-rows";

/** 构造一段离屏 DOM 作为 `collectFormData` 的采集根。 */
function domFixture(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe("collectFormData（字段与值口径）", () => {
  it("采集 [data-field] 元素的文本，构成 { 字段名: 值 }", () => {
    const root = domFixture(
      '<p data-field="单位">运输队</p><p data-field="编号">A-001</p>',
    );
    expect(collectFormData(root)).toEqual({ 单位: "运输队", 编号: "A-001" });
  });

  it("没有字段元素时返回 {}（不是 undefined / null）", () => {
    expect(collectFormData(domFixture("<p>固定文本</p>"))).toEqual({});
    expect(collectFormData(domFixture("<div></div>"))).toEqual({});
  });

  it("root 为空（画布未挂载）时返回 {}", () => {
    expect(collectFormData(null)).toEqual({});
    expect(collectFormData(undefined)).toEqual({});
  });

  it("root 自身即字段时也纳入（不只看后代）", () => {
    const root = domFixture("");
    root.setAttribute("data-field", "班组");
    root.textContent = "甲班";
    expect(collectFormData(root)).toEqual({ 班组: "甲班" });
  });
});

describe("schema / 表单数据序列化", () => {
  it("serializeSchemaJson 出可被 JSON.parse 还原的 schema", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    expect(JSON.parse(serializeSchemaJson(schema))).toEqual(
      JSON.parse(JSON.stringify(schema)),
    );
    expect(serializeSchemaJson(schema, false)).not.toContain("\n");
  });

  it("serializeFormDataJson 支持缩进与压缩两档", () => {
    const data = { 单位: "", 编号: "A-001" };
    expect(JSON.parse(serializeFormDataJson(data))).toEqual(data);
    expect(serializeFormDataJson(data, false)).toBe(
      JSON.stringify(data),
    );
  });

  it("normalizeIncomingSchema：字符串走严格解析，对象深拷贝隔离", () => {
    const schema = makeYunlvSecondTicketFirstFiveRowsSchema();
    expect(normalizeIncomingSchema(serializeSchemaJson(schema))).toEqual(
      JSON.parse(JSON.stringify(schema)),
    );
    const incoming = JSON.parse(JSON.stringify(schema)) as FormSchemaV2;
    const normalized = normalizeIncomingSchema(incoming);
    incoming.baseRowHeight = 999;
    expect(normalized.baseRowHeight).not.toBe(999);
  });
});

describe("FormDesigner 交付 API（defineExpose）", () => {
  function mountDesigner(schema: FormSchemaV2 = makeYunlvSecondTicketFirstFiveRowsSchema()) {
    return mount(FormDesigner, { props: { initialSchema: schema } });
  }

  function apiOf(wrapper: ReturnType<typeof mountDesigner>): FormDesignerExposed {
    // 宿主经 template ref 拿到的是 `defineExpose` 的 exposed 代理；VTU 的 `wrapper.vm`
    // 走的是 setupState，这里显式取 exposed，保证测到的就是宿主实际能调的契约。
    const exposed = (wrapper.vm as unknown as { $?: { exposed?: FormDesignerExposed } }).$
      ?.exposed;
    return exposed ?? (wrapper.vm as unknown as FormDesignerExposed);
  }

  it("getFormData 采集渲染 DOM 的字段与值（设计态即可调用）", () => {
    const data = apiOf(mountDesigner()).getFormData();
    expect(typeof data).toBe("object");
    expect(Object.keys(data).length).toBeGreaterThan(0);
    expect(data).toHaveProperty("单位");
  });

  it("表单没有配置字段时 getFormData 返回 {}", () => {
    const api = apiOf(mountDesigner(createEmptyFormSchemaV2()));
    expect(api.getFormData()).toEqual({});
  });

  it("getSchema 返回内部状态的深拷贝（改它不污染设计器）", () => {
    const api = apiOf(mountDesigner());
    const snapshot = api.getSchema();
    snapshot.baseRowHeight = 999;
    expect(api.getSchema().baseRowHeight).not.toBe(999);
  });

  it("exportSchemaFile 走同一 API 并在控制台打印 schema JSON", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      apiOf(mountDesigner()).exportSchemaFile();
      expect(logSpy).toHaveBeenCalled();
      const [label, json] = logSpy.mock.calls[0];
      expect(String(label)).toContain("schema");
      expect(() => JSON.parse(String(json))).not.toThrow();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("exportFillDataFile 在设计态即可调用并打印表单数据 JSON", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      apiOf(mountDesigner()).exportFillDataFile();
      expect(logSpy).toHaveBeenCalled();
      const [label, json] = logSpy.mock.calls[0];
      expect(String(label)).toContain("表单数据");
      expect(JSON.parse(String(json))).toEqual(apiOf(mountDesigner()).getFormData());
    } finally {
      logSpy.mockRestore();
    }
  });

  it("setSchema 载入新文档并清空未保存标记", () => {
    const wrapper = mountDesigner();
    const api = apiOf(wrapper);
    const vm = wrapper.vm as unknown as {
      dirty: boolean;
      commit: (next: FormSchemaV2) => void;
    };
    // 先制造一次真实改动（走文档 commit），dirty 应被置起
    vm.commit({ ...api.getSchema(), baseRowHeight: 3 });
    expect(vm.dirty).toBe(true);

    api.setSchema({ ...api.getSchema(), baseRowHeight: 7 });
    expect(api.getSchema().baseRowHeight).toBe(7);
    expect(vm.dirty).toBe(false);
  });

  it("setSchema 接受 JSON 文本（宿主从接口拿到的字符串直接回灌）", () => {
    const api = apiOf(mountDesigner());
    const incoming = JSON.parse(serializeSchemaJson(api.getSchema(), false)) as FormSchemaV2;
    incoming.baseRowHeight = 7;
    api.setSchema(JSON.stringify(incoming));
    expect(api.getSchema().baseRowHeight).toBe(7);
  });
});

describe("工具栏导出按钮", () => {
  function mountToolbar(uiConfig: Record<string, unknown> = {}, previewMode = false) {
    return mount(DesignerToolbar, {
      props: {
        dirty: false,
        canUndo: true,
        canRedo: true,
        previewMode,
        samples: [],
        uiConfig,
      },
    });
  }

  it("「空值表」按钮已撤回（模板组只剩保存模板 / 读取模板 / 导出文件 / 导入文件）", () => {
    const wrapper = mountToolbar();
    expect(wrapper.find("[data-export-field-values]").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("空值表");
  });

  it("「导出数据」在非预览态不再禁用，点击仍上抛 export-fill-data", async () => {
    const wrapper = mountToolbar({ showFillDataModule: true });
    const button = wrapper.find("[data-export-fill-data]");
    expect(button.exists()).toBe(true);
    expect(button.attributes("disabled")).toBeUndefined();
    await button.trigger("click");
    expect(wrapper.emitted("export-fill-data")).toHaveLength(1);
  });

  it("填充数据组四个按钮在非预览态均可用（导出 / 保存都不再禁用）", () => {
    const wrapper = mountToolbar({ showFillDataModule: true });
    const group = wrapper
      .findAll(".v2-toolbar__group")
      .find((g) => g.text().includes("填充数据"));
    expect(group).toBeTruthy();
    const disabled = group!
      .findAll("button")
      .filter((b) => b.attributes("disabled") !== undefined);
    expect(disabled.map((b) => b.text())).toEqual([]);
  });
});
