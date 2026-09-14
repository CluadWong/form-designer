import type { Messages } from "./types";

/**
 * 简体中文文案（默认语言）。key 与工具栏当前中文文案逐字对齐，
 * 保证默认语言下设计页行为与国际化前完全一致。
 */
export const zhCN: Messages = {
  "toolbar.dirty": "● 未保存",
  "toolbar.saved": "已保存",
  "toolbar.newBlank": "新建空白",
  "toolbar.loadSamplePrefix": "载入",
  "toolbar.undo": "撤销",
  "toolbar.redo": "重做",
  "toolbar.module.template": "模板",
  "toolbar.saveTemplate": "保存模板",
  "toolbar.loadTemplate": "读取模板",
  "toolbar.exportTemplate": "导出文件",
  "toolbar.importTemplate": "导入文件",
  "toolbar.module.fillData": "填充数据",
  "toolbar.importFillData": "导入数据",
  "toolbar.exportFillData": "导出数据",
  "toolbar.loadFillData": "读取数据",
  "toolbar.saveFillData": "保存数据",
  "toolbar.preview": "预览",
  "toolbar.exitPreview": "退出预览",
  "toolbar.print": "打印",
  "toolbar.help": "帮助",
  "toolbar.importFillDataTip": "选择填写数据 JSON 文件并进入预览态",
  "toolbar.exportFillDataTip":
    "导出表单当前的字段与值 JSON（设计态 / 预览态均可，无字段则为空对象）",
  "toolbar.loadFillDataTip": "读取本地已保存的填写数据并进入预览态",
  "toolbar.saveFillDataTip": "保存表单当前的字段与值到本机（设计态 / 预览态均可，无字段则为空对象）",
  "toolbar.previewTip":
    "查看表单的实际填写效果；预览中可直接输入内容，并可导出为填写数据",
  "toolbar.helpTip": "查看使用说明",
};
