/**
 * InspectorPanel 单测（Inspector 组件化，2026-09-07 批次 2）。
 *
 * 锁两件事：① 按节点类型正确分发到对应类型子组件；② 编辑动作走传入的 `api` 对象
 * （而非逐字段 emit）——若后人改成 emit 或漏传 api，这里会立刻失败。
 */
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import InspectorPanel from "../InspectorPanel.vue";
import type { SchemaEdits } from "../composables/useSchemaEdits";
import {
  createEmptyFormSchemaV2,
  createGridNodeV2,
  createTableNodeV2,
} from "@/types";

/** 用 vi.fn() 组成 api 替身：只断言「哪个动作被调用」，不关心其实现。
 *  按 key 缓存 spy —— Proxy 若每次 get 都 new 一个 vi.fn，
 *  组件渲染时捕获的 spy 与断言时访问的 spy 不是同一实例，toHaveBeenCalled 会恒失败。 */
function mockApi(): SchemaEdits {
  const spies = new Map<string, ReturnType<typeof vi.fn>>();
  const getSpy = (key: string): ReturnType<typeof vi.fn> => {
    let spy = spies.get(key);
    if (!spy) {
      spy = vi.fn();
      spies.set(key, spy);
    }
    return spy;
  };
  return new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === "paperMarginTop") return 12;
        if (key === "paperMarginRight") return 12;
        if (key === "paperMarginBottom") return 12;
        if (key === "paperMarginLeft") return 12;
        if (typeof key === "string") return getSpy(key);
        return undefined;
      },
    },
  ) as unknown as SchemaEdits;
}

function mountPanel(options: {
  node?: unknown;
  nodeId?: string | null;
  nodeType?: string;
  issues?: { code: string; message: string; nodeId?: string }[];
}) {
  const api = mockApi();
  const wrapper = mount(InspectorPanel, {
    props: {
      node: (options.node ?? null) as never,
      nodeId: options.nodeId ?? null,
      nodeType: options.nodeType ?? "未选择",
      cellContext: null,
      cellBox: null,
      issues: (options.issues ?? []) as never,
      api,
      paperSize: "A4" as const,
      baseRowHeight: 8,
      paperMarginTop: 12,
      paperMarginRight: 12,
      paperMarginBottom: 12,
      paperMarginLeft: 12,
      paginate: true,
    },
  });
  return { wrapper, api };
}

describe("InspectorPanel", () => {
  it("未选择节点：显示占位且不渲染任何类型分支", () => {
    const { wrapper } = mountPanel({});
    expect(wrapper.text()).toContain("未选择");
    expect(wrapper.find('input[data-dimension="rows"]').exists()).toBe(false);
    expect(wrapper.find(".v2-col-table").exists()).toBe(false);
  });

  it("选中 Grid：渲染行列数 / 列宽 / 边框，改动经 api 提交", async () => {
    const grid = createGridNodeV2();
    const { wrapper, api } = mountPanel({ node: grid, nodeType: "grid" });
    const rowsInput = wrapper.find('input[data-dimension="rows"]');
    expect(rowsInput.exists()).toBe(true);
    await rowsInput.setValue(3);
    expect(api.updateGridDimensions).toHaveBeenCalled();
    expect(wrapper.find("select").exists()).toBe(true);
  });

  it("选中 Table：渲染列配置，点「+ 添加列」调用 api.addTableColumn", async () => {
    const table = createTableNodeV2();
    const { wrapper, api } = mountPanel({ node: table, nodeType: "table" });
    expect(wrapper.find('[data-table-columns="true"]').exists()).toBe(true);
    await wrapper.find(".v2-add-col").trigger("click");
    expect(api.addTableColumn).toHaveBeenCalledTimes(1);
  });

  it("通用「额外属性」表：任何选中节点都渲染（params 挂在 SchemaNodeBaseV2 上），点「+ 添加属性」调 api", async () => {
    const grid = createGridNodeV2();
    const { wrapper, api } = mountPanel({ node: grid, nodeType: "grid" });
    expect(wrapper.find('[data-node-params="true"]').exists()).toBe(true);
    await wrapper.find('[data-param-add="true"]').trigger("click");
    expect(api.addSelectedParam).toHaveBeenCalledTimes(1);
  });

  it("选中 Page：分页开关双向绑定（update:paginate）", async () => {
    const page = createEmptyFormSchemaV2().pages[0];
    const { wrapper } = mountPanel({ node: page, nodeType: "page" });
    const toggle = wrapper.find('[data-paginate="true"]');
    expect(toggle.exists()).toBe(true);
    await toggle.setValue(false);
    expect(wrapper.emitted("update:paginate")?.[0]).toEqual([false]);
  });

  it("校验问题：条目渲染并可点击，向宿主 emit selectIssue", async () => {
    const issue = { code: "INVALID_GRID_ROWS", message: "行数非法", nodeId: "grid-1" };
    const { wrapper } = mountPanel({ issues: [issue] });
    const items = wrapper.findAll(".v2-issue");
    expect(items).toHaveLength(1);
    expect(items[0].text()).toContain("行数非法");
    // 面向普通用户：问题条目只显示中文 message，不再露出内部 code
    expect(items[0].text()).not.toContain("INVALID_GRID_ROWS");
    await items[0].trigger("click");
    expect(wrapper.emitted("selectIssue")?.[0]?.[0]).toMatchObject(issue);
  });
});
