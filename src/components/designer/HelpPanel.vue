<script setup lang="ts">
/**
 * 应用内操作指南（2026-10-28 重做）。
 *
 * 上一版把整份《普通用户操作指南》平铺进一个可滚动浮层：10 个三级标题连排、
 * 无目录无搜索、电子签名等高级用例与「三步上手」同级，找一条规则要滚四屏。
 *
 * 现在按「速查手册」组织：
 * - 左侧常驻目录（点击跳转到小节并展开），右侧按小节折叠；
 * - 首屏只展开「三步搭出第一张票」，其余按需展开；
 * - 顶部搜索对每节 DOM 文本做子串匹配（命中自动展开、未命中隐藏），不维护第二份索引；
 * - 正文按「一条规则一行、术语只解释一次、并列配置改表格」重写。
 *
 * 上下文帮助：宿主（FormDesigner）提供 `openHelp(section)`，属性面板里的 `HelpLink`
 * 点「?」时打开本面板并定位到对应小节（`section` prop）。
 *
 * 契约：关闭态不渲染任何 DOM；✕ / 遮罩 / Esc 三条关闭途径不变；内容摘要是
 * `docs/user-guide.md` 的精简版，细节以文档为准（改口径两处同步）。
 */
import { computed, nextTick, onUnmounted, ref, watch } from "vue";

const props = defineProps<{ open: boolean; section?: string | null }>();
const emit = defineEmits<{ (e: "close"): void }>();

/**
 * 小节清单（顺序即目录顺序）。`id` 同时是 DOM 锚点与 `HelpLink` 的定位目标，
 * 增删小节时两边一起改。
 */
const HELP_SECTIONS: { id: string; title: string }[] = [
  { id: "start", title: "三步上手" },
  { id: "ui", title: "界面与模式" },
  { id: "components", title: "组件速查" },
  { id: "attr", title: "额外属性" },
  { id: "sign", title: "电子签名" },
  { id: "multi", title: "多人签名" },
  { id: "border", title: "边框与下划线" },
  { id: "clear", title: "清空按钮" },
  { id: "keys", title: "快捷键" },
  { id: "faq", title: "常见问题" },
  { id: "terms", title: "术语速查" },
];

/** 展开态：只有首节默认展开，其余收起（首屏留给"怎么开始"）。 */
const openMap = ref<Record<string, boolean>>({ start: true });
/** 目录高亮：点击 / 定位时更新；不做滚动跟随（锚点式跳转，实现保持无状态）。 */
const activeId = ref<string>("start");

/** 搜索词：非空时只保留命中节并强制展开。 */
const query = ref("");
const matched = ref<Set<string> | null>(null);

const searchEl = ref<HTMLInputElement | null>(null);
const sectionEls = new Map<string, HTMLElement>();

function setSectionEl(id: string, el: unknown): void {
  if (el instanceof HTMLElement) sectionEls.set(id, el);
  else sectionEls.delete(id);
}

function isOpen(id: string): boolean {
  return openMap.value[id] === true;
}

/** `<details>` 的原生展开/收起回流到状态，保证再次渲染不会把用户的选择覆盖掉。 */
function onToggle(id: string, event: Event): void {
  const open = (event.target as HTMLDetailsElement).open;
  if (openMap.value[id] !== open) openMap.value = { ...openMap.value, [id]: open };
  if (open) activeId.value = id;
}

function hidden(id: string): boolean {
  return matched.value != null && !matched.value.has(id);
}

const noMatch = computed(() => matched.value != null && matched.value.size === 0);

/** 跳到某节：展开 + 滚动到顶 + 目录高亮（不依赖 scrollspy）。 */
function jump(id: string): void {
  activeId.value = id;
  openMap.value = { ...openMap.value, [id]: true };
  void nextTick(() => {
    sectionEls.get(id)?.scrollIntoView?.({ block: "start" });
  });
}

/** 搜索：直接读各节的已渲染文本，省掉一份手写索引（也避免文案改了索引忘改）。 */
watch(query, (raw) => {
  const q = raw.trim().toLowerCase();
  if (!q) {
    matched.value = null;
    return;
  }
  const hit = new Set<string>();
  for (const { id } of HELP_SECTIONS) {
    const text = sectionEls.get(id)?.textContent?.toLowerCase() ?? "";
    if (text.includes(q)) hit.add(id);
  }
  matched.value = hit;
  if (hit.size) {
    const next = { ...openMap.value };
    hit.forEach((id) => (next[id] = true));
    openMap.value = next;
  }
});

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") emit("close");
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      window.addEventListener("keydown", onKeydown);
      query.value = "";
      matched.value = null;
      if (props.section) jump(props.section);
      void nextTick(() => searchEl.value?.focus());
    } else {
      window.removeEventListener("keydown", onKeydown);
    }
  },
  // immediate：兼容「初始即 open」的消费方，否则首挂载时 Esc 监听永远挂不上。
  { immediate: true },
);

/** 面板已开着时再点别处的「?」：open 不变、只有 section 变，需单独接管。 */
watch(
  () => props.section,
  (section) => {
    if (props.open && section) jump(section);
  },
);

onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div v-if="open" class="v2-help" @click.self="emit('close')">
    <div class="v2-help__panel" role="dialog" aria-modal="true" aria-label="操作指南">
      <header class="v2-help__head">
        <h2>操作指南</h2>
        <div class="v2-help__tools">
          <input
            ref="searchEl"
            v-model="query"
            class="v2-help__search"
            type="search"
            placeholder="搜索：签名、清空、快捷键…"
            aria-label="搜索操作指南"
            data-help-search="true"
          />
          <button
            type="button"
            class="v2-help__close"
            title="关闭帮助"
            @click="emit('close')"
          >
            ✕
          </button>
        </div>
      </header>

      <div class="v2-help__main">
        <nav class="v2-help__nav" aria-label="章节目录">
          <button
            v-for="sectionItem in HELP_SECTIONS"
            :key="sectionItem.id"
            type="button"
            class="v2-help__navitem"
            :class="{ 'is-active': activeId === sectionItem.id }"
            :data-help-nav="sectionItem.id"
            @click="jump(sectionItem.id)"
          >
            {{ sectionItem.title }}
          </button>
        </nav>

        <div class="v2-help__body" data-help-body="true">
          <p v-if="noMatch" class="v2-help__empty">
            没有匹配「{{ query.trim() }}」的内容，换个词试试（如「签名」「清空」「表格」）。
          </p>

          <details
            :ref="(el) => setSectionEl('start', el)"
            class="v2-help__sec"
            :class="{ 'is-hidden': hidden('start') }"
            :open="isOpen('start')"
            :data-help-section="'start'"
            @toggle="onToggle('start', $event)"
          >
            <summary>三步搭出第一张票</summary>
            <ol class="v2-help__steps">
              <li><b>新建空白</b>：得到一张空纸。</li>
              <li><b>拖一个网格</b>到纸上：把票分成几块格子。</li>
              <li>
                <b>把组件拖进格子</b>：文本 / 输入框 / 表格 / 图片列表都行。点组件按钮
                也可以，会放进当前选中的格子。
              </li>
            </ol>
            <p>
              落在格子外也不会丢：自动在当前页末尾新建一个网格，把组件放进它的第一个格子。
            </p>
            <table>
              <tbody>
                <tr>
                  <th>模板</th>
                  <td>
                    空表单版式，设计一次反复用。工具栏「模板」组：保存 / 读取模板、导出 / 导入文件。
                  </td>
                </tr>
                <tr>
                  <th>填写数据</th>
                  <td>
                    某次作业填进去的内容。「填充数据」组：保存 / 读取 / 导入 / 导出数据，随时可点。
                  </td>
                </tr>
              </tbody>
            </table>
            <p class="v2-help__tip"><b>设计时搭架子，预览时填内容。</b></p>
          </details>

          <details
            :ref="(el) => setSectionEl('ui', el)"
            class="v2-help__sec"
            :class="{ 'is-hidden': hidden('ui') }"
            :open="isOpen('ui')"
            :data-help-section="'ui'"
            @toggle="onToggle('ui', $event)"
          >
            <summary>界面与模式</summary>
            <table>
              <tbody>
                <tr>
                  <th>顶部工具栏</th>
                  <td>新建、保存、预览、打印、导入导出</td>
                </tr>
                <tr>
                  <th>左侧栏</th>
                  <td>组件「零件库」+ 整张表的结构树</td>
                </tr>
                <tr>
                  <th>中间画布</th>
                  <td>纸张。<b>按住空格键拖动可平移</b></td>
                </tr>
                <tr>
                  <th>右侧面板</th>
                  <td>选中某个东西后，在这里改它的设置</td>
                </tr>
                <tr>
                  <th>底部状态栏</th>
                  <td>共几页、有没有问题、会打印几张</td>
                </tr>
              </tbody>
            </table>
            <ul>
              <li><b>设计态</b>（默认）：搭模板、改结构、调属性。</li>
              <li>
                <b>预览态</b>：点「预览」进入，输入框直接打字检查版式；刚进入是空的，内容靠填写
                或「导入数据」载入。结构改不了，退出预览再改。
              </li>
              <li>
                <b>结构树</b>：点树里的项等于选中它；点画布上的组件，树会同步高亮并滚动过去。
              </li>
            </ul>
          </details>

          <details
            :ref="(el) => setSectionEl('components', el)"
            class="v2-help__sec"
            :class="{ 'is-hidden': hidden('components') }"
            :open="isOpen('components')"
            :data-help-section="'components'"
            @toggle="onToggle('components', $event)"
          >
            <summary>组件速查</summary>
            <table>
              <tbody>
                <tr>
                  <th>文本</th>
                  <td>固定文字，不能填</td>
                  <td>内容、字号、对齐</td>
                </tr>
                <tr>
                  <th>输入框</th>
                  <td>可填写的字段</td>
                  <td>字段名、前后标签、值类型、宽度、默认内容</td>
                </tr>
                <tr>
                  <th>图片列表</th>
                  <td>一组图片（盖章区、示意图、现场照片）</td>
                  <td>布局方式、对齐、默认宽高、每条的名称地址尺寸</td>
                </tr>
                <tr>
                  <th>表格</th>
                  <td>多行多列的表，格子可直接填</td>
                  <td>最小行数、边框、表头与列</td>
                </tr>
                <tr>
                  <th>网格</th>
                  <td>把票分成几块（布局组件）</td>
                  <td>行列数、列宽、边框、间距</td>
                </tr>
                <tr>
                  <th>HTML 模块</th>
                  <td>自由排版块，不懂 HTML 不用管</td>
                  <td>片段、样式</td>
                </tr>
              </tbody>
            </table>
            <ul>
              <li><b>页面</b>：纸张类型、四边距、行高、基础字号、分页显示、页眉页脚。</li>
              <li><b>格子</b>：撑满、内边距、对齐、合并与拆分（拆分＝整张网格加一列）。</li>
              <li>
                <b>表格的「表头与列」</b>：点表头格改标题（下方有整宽输入框），用 − / + 合并或拆分，
                再在「列」清单里改字段名与宽度。
              </li>
            </ul>
          </details>

          <details
            :ref="(el) => setSectionEl('attr', el)"
            class="v2-help__sec"
            :class="{ 'is-hidden': hidden('attr') }"
            :open="isOpen('attr')"
            :data-help-section="'attr'"
            @toggle="onToggle('attr', $event)"
          >
            <summary>额外属性</summary>
            <p>
              所有组件底部都有「额外属性」：写下的键值对会作为 HTML 属性输出到该组件的标签上，
              含义<b>由消费系统识别</b>，设计器不解释。
            </p>
            <table>
              <tbody>
                <tr>
                  <th>action = signature</th>
                  <td>标记成签名栏，宿主据此弹签名框、回填签名图</td>
                </tr>
                <tr>
                  <th>date-format = {YYYY}年{MM}月{DD}</th>
                  <td>日期字段的显示格式</td>
                </tr>
              </tbody>
            </table>
            <p>属性名会被系统忽略时输入框标红，其余照常输出。</p>
          </details>

          <details
            :ref="(el) => setSectionEl('sign', el)"
            class="v2-help__sec"
            :class="{ 'is-hidden': hidden('sign') }"
            :open="isOpen('sign')"
            :data-help-section="'sign'"
            @toggle="onToggle('sign', $event)"
          >
            <summary>电子签名</summary>
            <p>签名栏用一个输入框就够，不必拼「文字 + 图片」：</p>
            <ol class="v2-help__steps">
              <li>「前标签」写 <b>负责人签名：</b>（新建输入框自带下划线）。</li>
              <li>「值类型」选 <b>图片（电子签名）</b>。</li>
              <li>「额外属性」里配 <b>action = signature</b>。</li>
            </ol>
            <p>
              <b>图片高度留空即可</b>：签名图默认与标签等高、贴着下划线排成一小条，要更大的签名条
              才填（如 10mm）。空白时票面显示「负责人签名：______」，签名后图贴在<b>那条下划线上</b>，
              空态与已签名两态的下划线位置一致。
            </p>
          </details>

          <details
            :ref="(el) => setSectionEl('multi', el)"
            class="v2-help__sec"
            :class="{ 'is-hidden': hidden('multi') }"
            :open="isOpen('multi')"
            :data-help-section="'multi'"
            @toggle="onToggle('multi', $event)"
          >
            <summary>多人签名</summary>
            <p>
              配置与单人签名<b>完全一样</b>，差别只在宿主回填的数据是数组：
              <code>{"多人签名":["a.png","b.png"]}</code>。传单个字符串就是单人签名。
            </p>
            <ul>
              <li>放不下自动换行，换行后末行仍压在下划线上。</li>
              <li>可设<b>多图间距</b>（单位 mm，留空为默认）与<b>数量上限</b>（多出的不显示也不采集）。</li>
              <li>换行位置取决于图自身宽高比，设计时算不出，所以分页按「一张占一行」保守预估。</li>
            </ul>
          </details>

          <details
            :ref="(el) => setSectionEl('border', el)"
            class="v2-help__sec"
            :class="{ 'is-hidden': hidden('border') }"
            :open="isOpen('border')"
            :data-help-section="'border'"
            @toggle="onToggle('border', $event)"
          >
            <summary>边框与下划线</summary>
            <ul>
              <li>输入框默认的下划线<b>打印时不出</b>，屏幕上只是「这里可填写」的提示。</li>
              <li>
                勾了「内部边框」：逐行实线边框会打印出来，屏幕上的下划线<b>自动隐藏</b>
                （否则末行会叠成两条底边）。没勾的字段照旧。
              </li>
              <li>没配地址的图片：屏幕显示灰色占位框便于选中，<b>打印时不占位置</b>。</li>
            </ul>
          </details>

          <details
            :ref="(el) => setSectionEl('clear', el)"
            class="v2-help__sec"
            :class="{ 'is-hidden': hidden('clear') }"
            :open="isOpen('clear')"
            :data-help-section="'clear'"
            @toggle="onToggle('clear', $event)"
          >
            <summary>清空按钮</summary>
            <ul>
              <li>填写态鼠标移到输入框上，右侧浮出一个小 <b>×</b>，点一下清空并<b>恢复默认值</b>。</li>
              <li>只要该字段屏幕上不是空的就出现（显示默认值的字段也能点到）。</li>
              <li>
                设计态、只读回显、脱敏字段没有；打印不输出；图片与电子签名字段也没有
                （签名图用图上的删除角标）。
              </li>
            </ul>
          </details>

          <details
            :ref="(el) => setSectionEl('keys', el)"
            class="v2-help__sec"
            :class="{ 'is-hidden': hidden('keys') }"
            :open="isOpen('keys')"
            :data-help-section="'keys'"
            @toggle="onToggle('keys', $event)"
          >
            <summary>快捷键（设计时可用）</summary>
            <table>
              <tbody>
                <tr>
                  <th>Space</th>
                  <td>按住，拖拽平移纸张</td>
                </tr>
                <tr>
                  <th>Ctrl/Cmd + S</th>
                  <td>保存模板（本机）</td>
                </tr>
                <tr>
                  <th>Ctrl/Cmd + Z</th>
                  <td>撤销</td>
                </tr>
                <tr>
                  <th>Ctrl/Cmd + Shift + Z / Y</th>
                  <td>重做</td>
                </tr>
                <tr>
                  <th>Ctrl/Cmd + C / X / V</th>
                  <td>复制 / 剪切 / 粘贴选中的组件</td>
                </tr>
                <tr>
                  <th>Ctrl/Cmd + D</th>
                  <td>原地复制一份（选中网格则克隆到它后面）</td>
                </tr>
                <tr>
                  <th>Delete / Backspace</th>
                  <td>删除选中的组件</td>
                </tr>
              </tbody>
            </table>
            <p>
              在输入框里打字时快捷键让位。粘贴落点：选中网格时把源网格内部<b>整块照搬</b>过来；
              什么都没选中时追加到页面最后。
            </p>
          </details>

          <details
            :ref="(el) => setSectionEl('faq', el)"
            class="v2-help__sec"
            :class="{ 'is-hidden': hidden('faq') }"
            :open="isOpen('faq')"
            :data-help-section="'faq'"
            @toggle="onToggle('faq', $event)"
          >
            <summary>常见问题</summary>
            <p>
              <b>拖了组件放不进去？</b>先点网格里的空位选中一个格子再拖。落在格子外也不会丢，
              会自动新建网格兜住（撤销一次即整步回退）。
            </p>
            <p><b>导出的文件是什么？</b>模板和填写数据都是 .json 文本备份，可导入还原、发给同事。</p>
            <p>
              <b>怎么知道有没有排版问题？</b>看底部状态栏的问题数量，点右侧面板里的提示可跳到对应位置。
            </p>
            <p>
              <b>分页不准？</b>点「打印」以实际分页为准；设计态的「分页显示」只是预演，
              页面属性里的「基础字号」「行高」会直接影响每页能放多少。
            </p>
          </details>

          <details
            :ref="(el) => setSectionEl('terms', el)"
            class="v2-help__sec"
            :class="{ 'is-hidden': hidden('terms') }"
            :open="isOpen('terms')"
            :data-help-section="'terms'"
            @toggle="onToggle('terms', $event)"
          >
            <summary>术语速查</summary>
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
                  <th>网格 / 格子</th>
                  <td>按行列划分的布局容器 / 它里面的小格</td>
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
            <p class="v2-help__foot">
              这是精简版；完整说明见项目文档 <code>docs/user-guide.md</code>。
            </p>
          </details>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 遮罩与面板：沿用设计器既有的浅色面与单一强调色（#2563eb），不加第二套配色。 */
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
  width: min(800px, calc(100vw - 48px));
  max-height: min(86vh, 880px);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 20px 60px rgb(15 23 42 / 25%);
  overflow: hidden;
}

.v2-help__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
  padding: 10px 16px;
  border-bottom: 1px solid #e2e8f0;
}

.v2-help__head h2 {
  margin: 0;
  color: #1e293b;
  font-size: 14px;
  font-weight: 600;
}

.v2-help__tools {
  display: flex;
  align-items: center;
  gap: 8px;
}

.v2-help__search {
  width: 220px;
  height: 28px;
  padding: 0 9px;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  color: #0f172a;
  background: #fff;
  font-family: inherit;
  font-size: 12px;
}

.v2-help__search:focus {
  outline: none;
  border-color: #93c5fd;
  box-shadow: 0 0 0 2px rgb(37 99 235 / 12%);
}

.v2-help__close {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  color: #475569;
  background: #f8fafc;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.v2-help__close:hover {
  background: #eef2f7;
}

/* 两栏：左目录固定 168px，右正文独立滚动（各自滚动条互不影响） */
.v2-help__main {
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr);
  min-height: 0;
  flex: 1;
}

.v2-help__nav {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 10px 8px;
  border-right: 1px solid #eef2f7;
  background: #fbfcfe;
  overflow-y: auto;
}

.v2-help__navitem {
  padding: 6px 9px;
  border: 0;
  border-radius: 4px;
  color: #475569;
  background: transparent;
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.v2-help__navitem:hover {
  background: #eef2f7;
}

/* 当前节：左侧 2px 蓝条 + 淡蓝底，与右侧属性面板的选中态同一语言 */
.v2-help__navitem.is-active {
  background: #eff6ff;
  box-shadow: inset 2px 0 0 #2563eb;
  color: #1d4ed8;
  font-weight: 500;
}

.v2-help__body {
  padding: 6px 18px 20px;
  overflow-y: auto;
  color: #334155;
  font-size: 13px;
  line-height: 1.7;
}

.v2-help__sec {
  border-bottom: 1px solid #f1f5f9;
}

.v2-help__sec.is-hidden {
  display: none;
}

.v2-help__sec > summary {
  padding: 10px 2px;
  color: #1e293b;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  list-style: none;
}

.v2-help__sec > summary::-webkit-details-marker {
  display: none;
}

/* caret：收起时朝右，展开时朝下 */
.v2-help__sec > summary::before {
  content: "▸";
  display: inline-block;
  width: 14px;
  color: #94a3b8;
  font-size: 10px;
  transform: translateY(-1px);
}

.v2-help__sec[open] > summary::before {
  content: "▾";
}

.v2-help__sec > summary:focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: 2px;
  border-radius: 3px;
}

.v2-help__body > .v2-help__sec > *:not(summary) {
  margin-bottom: 8px;
}

.v2-help__body p {
  margin: 4px 0 8px;
}

.v2-help__body ul,
.v2-help__steps {
  margin: 4px 0 8px;
  padding-left: 20px;
}

.v2-help__steps {
  padding-left: 22px;
}

.v2-help__body li {
  margin: 2px 0;
}

/* 表格：去掉外框，只留行线——四张全框表在浮层里太吵 */
.v2-help__body table {
  width: 100%;
  margin: 4px 0 10px;
  border-collapse: collapse;
}

.v2-help__body th,
.v2-help__body td {
  padding: 5px 8px;
  border-bottom: 1px solid #f1f5f9;
  text-align: left;
  vertical-align: top;
  font-weight: 400;
}

.v2-help__body th {
  width: 30%;
  color: #1e293b;
  font-weight: 500;
  white-space: nowrap;
}

.v2-help__body code {
  padding: 1px 4px;
  border-radius: 3px;
  background: #f1f5f9;
  font-size: 12px;
}

.v2-help__tip {
  margin-top: 6px !important;
  padding: 6px 10px;
  border-radius: 4px;
  background: #eff6ff;
}

.v2-help__empty {
  margin: 18px 2px;
  color: #64748b;
}

.v2-help__foot {
  margin-top: 10px !important;
  color: #94a3b8;
  font-size: 12px;
}

/* 打印兜底：帮助面板绝不进打印流。 */
@media print {
  .v2-help {
    display: none !important;
  }
}
</style>
