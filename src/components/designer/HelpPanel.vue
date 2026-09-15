<script setup lang="ts">
/**
 * 应用内帮助面板（2026-09-08）：把《普通用户操作指南》（docs/user-guide.md）
 * 浓缩为工具栏「帮助」按钮触发的浮层，普通用户不翻文档即可查阅。
 *
 * - 仅展示层：`open` 由宿主（FormDesigner 工具栏）控制，关闭经 `close` 事件回传；
 *   面板自身不持有全局状态。首次使用默认弹出（localStorage 已读标记）同样由宿主决定。
 * - 关闭途径：右上 ✕、点击遮罩、Esc 键（open 时挂 window 监听，关闭即摘除）。
 * - 内容与 docs/user-guide.md 同源同口径；文档为准，改口径两处同步。
 * - 打印兜底：`@media print` 下整层隐藏，帮助面板绝不进打印流。
 */
import { onUnmounted, watch } from "vue";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") emit("close");
}

watch(
  () => props.open,
  (open) => {
    if (open) window.addEventListener("keydown", onKeydown);
    else window.removeEventListener("keydown", onKeydown);
  },
  // immediate：兼容「初始即 open」的消费方，否则首挂载时 Esc 监听永远挂不上。
  { immediate: true },
);

onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div v-if="open" class="v2-help" @click.self="emit('close')">
    <div class="v2-help__panel" role="dialog" aria-label="操作指南">
      <header class="v2-help__head">
        <h2>操作指南</h2>
        <button
          type="button"
          class="v2-help__close"
          title="关闭帮助"
          @click="emit('close')"
        >
          ✕
        </button>
      </header>

      <div class="v2-help__body">
        <h3>这个工具是做什么的</h3>
        <p>
          用来<b>设计固定版式的工作票表单</b>：设计好一次「模板」，以后每次作业直接填写、打印不同的票。
        </p>
        <ul>
          <li>
            <b>模板</b>＝空的表单版式（有哪些格子、哪些输入框、标题写什么）。
          </li>
          <li>
            <b>填写数据</b
            >＝某次作业填进输入框的具体内容（如「工作负责人：张三」）。
          </li>
        </ul>

        <h3>界面五大区域</h3>
        <table>
          <tbody>
            <tr>
              <th>顶部工具栏</th>
              <td>新建、保存、预览、打印、导入导出</td>
            </tr>
            <tr>
              <th>左侧栏</th>
              <td>组件「零件库」＋ 整张表的结构树</td>
            </tr>
            <tr>
              <th>中间画布</th>
              <td>
                纸张，在这里摆组件、看效果.
                <strong>按住空格键，拖拽可平移纸张</strong>
              </td>
            </tr>
            <tr>
              <th>右侧属性面板</th>
              <td>选中某个东西后，在这里改它的设置</td>
            </tr>
            <tr>
              <th>底部状态栏</th>
              <td>共几页、有没有问题、会打印几张</td>
            </tr>
          </tbody>
        </table>

        <h3>两个模式：设计 / 预览</h3>
        <ul>
          <li>
            <b>设计态</b
            >（默认）：搭模板、改结构、调属性，可随意增删组件、拖动位置。
          </li>
          <li>
            <b>预览态</b
            >：点「预览」进入（再点变「退出预览」），输入框<b>直接打字填写</b>，检查版式。刚进入时输入框是<b>空的</b>，内容靠填写或「导入数据
            / 读取数据」载入。
          </li>
        </ul>
        <p class="v2-help__tip">
          记不住就记住一句：<b>设计时搭架子，预览时填内容。</b>
        </p>

        <h3>模板 与 填写数据（一定要分清）</h3>
        <ul>
          <li>
            模板 → 工具栏「模板」组的
            <b>保存模板 / 读取模板 / 导出文件 / 导入文件</b>。
          </li>
          <li>
            填写数据 → 工具栏「填充数据」组的
            <b>保存数据 / 读取数据 / 导入数据 / 导出数据</b
            >（这组不限预览态，随时都能点）。
          </li>
        </ul>
        <p class="v2-help__tip">
          <b>导出数据 / 保存数据</b>随时可点：它们扫一遍画布上的输入框，把「字段 → 值」
          采集出来（没配输入框时就是空对象）。导出<b>文件</b>与导出<b>数据</b>还会把同一份
          JSON 打印到浏览器控制台，方便对接系统时直接复制。
        </p>

        <h3>从零设计一张票（标准流程）</h3>
        <ol>
          <li><b>新建空白</b>：得到一张空纸。</li>
          <li>
            <b>搭大框</b
            >：从左侧「布局组件」拖一个<b>网格</b>到画布（按行列分成若干<b>格子</b>）。
          </li>
          <li>
            <b>放内容</b>：把 文本 / 输入框 / 图片 / 表格 / HTML 模块
            拖进某个格子（或点组件按钮放进当前选中的格子）。
          </li>
          <li><b>改属性</b>：点画布上的组件，右侧面板修改设置。</li>
          <li>
            <b>保存 / 导出</b>：本机接着改用「保存模板 / 读取模板」；备份或发人用「导出文件
            / 导入文件」（.json）。
          </li>
        </ol>
        <p>左上角「● 未保存 / 已保存」：改了没保存会提示，关页面前记得保存。</p>

        <h3>组件说明（左侧零件库）</h3>
        <p>左侧分两组：<b>基础组件</b>（往表里填内容的）和 <b>布局组件</b>（用来排版定位的）。</p>
        <table>
          <tbody>
            <tr>
              <th>文本</th>
              <td>固定不变的文字，不能填。用于标题、栏目标题、说明文字。</td>
            </tr>
            <tr>
              <th>输入框</th>
              <td>可填写的字段。凡作业时要手写的地方。</td>
            </tr>
            <tr>
              <th>图片</th>
              <td>图片占位框。用于盖章区、示意图、签名扫描件。</td>
            </tr>
            <tr>
              <th>HTML 模块</th>
              <td>自由排版的自定义块。不懂 HTML 不用管它。</td>
            </tr>
            <tr>
              <th>表格</th>
              <td>多行多列的表，格子可直接填写。用于设备清单、措施列表等。</td>
            </tr>
            <tr>
              <th>网格</th>
              <td>按行列划分的布局区，把票分成若干区块（布局组件）。</td>
            </tr>
          </tbody>
        </table>
        <p>
          <b>右侧属性面板</b
          >（选中后显示）：页面＝纸张/边距/页眉页脚/分页；网格＝列数/边框/间距/行数；格子＝撑满/内边距/对齐；文本＝文字/字号/加粗/对齐；输入框＝字段名/前后标签/点击触发/宽度/默认值/内边框；图片＝地址/填充方式/尺寸；表格＝最小行数/边框/表头/列配置。底部还有<b>额外属性</b>（自定义键值对，会作为 HTML 属性输出，含义由消费系统识别；属性名会被系统忽略时标红提示）。顶部会显示当前选中（如「格子
          1-2」）。
        </p>

        <h3>结构树（左侧下半部分）</h3>
        <ul>
          <li>把整张表从大到小列出：页面 → 网格 → 格子 → 组件。</li>
          <li>
            点树里的项＝选中它（比在画布上找小字方便）；反向也成立：点画布上的组件，树里会同步高亮并滚动到
            它，折叠着的层级会自动展开。
          </li>
          <li>
            「删除」删掉选中的组件（页面和格子不能删）；「折叠全部 / 展开全部」收起或展开整棵树。
          </li>
        </ul>

        <h3>填写与打印</h3>
        <ul>
          <li>点「预览」→ 在输入框直接打字 → 「保存数据 / 导出数据」留存。</li>
          <li>
            「打印」在预览态或设计态都能点，<b>自动按纸张分页</b>，方向由纸张尺寸决定（A4
            竖打、A3 横打）。
          </li>
          <li>
            打出来的<b>只有票面本身</b>：系统菜单、工具栏、页面其他区域都不会跟着打出来。
          </li>
        </ul>
        <p>
          没配置地址的图片：屏幕显示占位灰框方便选中编辑，<b>打印时不占位置</b>。
        </p>
        <p>
          输入框默认的下划线（表示「这里可填写」）<b>打印时不显示</b>；只有勾选了「显示内部边框」的字段，逐行实线边框才会打印出来。
        </p>

        <h3>快捷键（设计时可用）</h3>
        <p>在输入框里打字时，快捷键让位给输入，不会触发下面的操作。</p>
        <table>
          <tbody>
            <tr>
              <th>Space 空格键</th>
              <td>按住，拖拽可平移纸张</td>
            </tr>
            <tr>
              <th>Ctrl/Cmd + Z</th>
              <td>撤销</td>
            </tr>
            <tr>
              <th>Ctrl/Cmd + Shift + Z 或 Ctrl/Cmd + Y</th>
              <td>重做</td>
            </tr>
            <tr>
              <th>Ctrl/Cmd + S</th>
              <td>保存模板（本机）</td>
            </tr>
            <tr>
              <th>Ctrl/Cmd + C / X / V</th>
              <td>复制 / 剪切 / 粘贴选中的组件</td>
            </tr>
            <tr>
              <th>Ctrl/Cmd + D</th>
              <td>原地复制一份选中的组件</td>
            </tr>
            <tr>
              <th>Delete / Backspace</th>
              <td>删除选中的组件（仅设计态）</td>
            </tr>
          </tbody>
        </table>

        <h3>常见问题</h3>
        <p>
          <b>拖了组件但放不进去？</b
          >先点一下网格里的空位选中某个格子，再拖或点组件按钮。组件必须落在格子里。
        </p>
        <p><b>预览里能改结构吗？</b>不能。点「退出预览」回设计态再改。</p>
        <p>
          <b>导出的文件是什么？</b>模板和填写数据都是 .json
          文本备份，可导入还原、发给同事。
        </p>
        <p>
          <b>怎么知道有没有排版问题？</b
          >看底部状态栏「待处理问题」数量，点右侧面板里的提示可跳到对应位置。
        </p>

        <h3>术语速查</h3>
        <table>
          <tbody>
            <tr>
              <th>模板</th>
              <td>空表单版式（设计一次，反复用）</td>
            </tr>
            <tr>
              <th>填写数据</th>
              <td>某次作业填进表里的具体内容</td>
            </tr>
            <tr>
              <th>网格</th>
              <td>按行列划分的布局容器</td>
            </tr>
            <tr>
              <th>格子</th>
              <td>网格里的小格，组件就放在里面</td>
            </tr>
            <tr>
              <th>输入框 / 文本</th>
              <td>可填写的字段 / 固定不可填的文字</td>
            </tr>
            <tr>
              <th>设计态 / 预览态</th>
              <td>搭模板改结构 / 像最终用户一样填写检查</td>
            </tr>
            <tr>
              <th>分页</th>
              <td>一页放不下时自动分到下一页</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.v2-help {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(15 23 42 / 45%);
}

.v2-help__panel {
  display: flex;
  flex-direction: column;
  width: min(760px, calc(100vw - 48px));
  max-height: min(86vh, 900px);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 20px 60px rgb(15 23 42 / 25%);
  overflow: hidden;
}

.v2-help__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  padding: 12px 18px;
  border-bottom: 1px solid #e2e8f0;
}

.v2-help__head h2 {
  margin: 0;
  color: #1e293b;
  font-size: 15px;
  font-weight: 700;
}

.v2-help__close {
  padding: 2px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  color: #475569;
  background: #f8fafc;
  font-size: 13px;
  line-height: 1.4;
  cursor: pointer;
}

.v2-help__close:hover {
  background: #eef2f7;
}

.v2-help__body {
  padding: 6px 18px 18px;
  overflow-y: auto;
  color: #334155;
  font-size: 13px;
  line-height: 1.7;
}

.v2-help__body h3 {
  margin: 16px 0 6px;
  padding-left: 8px;
  border-left: 3px solid #2563eb;
  color: #1e293b;
  font-size: 13px;
  font-weight: 700;
}

.v2-help__body p {
  margin: 4px 0;
}

.v2-help__body ul,
.v2-help__body ol {
  margin: 4px 0;
  padding-left: 20px;
}

.v2-help__body li {
  margin: 2px 0;
}

.v2-help__body table {
  width: 100%;
  margin: 6px 0;
  border: 1px solid #e2e8f0;
  border-collapse: collapse;
}

.v2-help__body th,
.v2-help__body td {
  padding: 4px 8px;
  border: 1px solid #e2e8f0;
  text-align: left;
  vertical-align: top;
  font-weight: 400;
}

.v2-help__body th {
  width: 34%;
  color: #1e293b;
  background: #f8fafc;
  font-weight: 600;
  white-space: nowrap;
}

.v2-help__tip {
  margin-top: 6px !important;
  padding: 6px 10px;
  border-radius: 4px;
  background: #eff6ff;
}

/* 打印兜底：帮助面板绝不进打印流。 */
@media print {
  .v2-help {
    display: none !important;
  }
}
</style>
