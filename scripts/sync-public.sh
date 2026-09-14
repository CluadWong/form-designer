#!/usr/bin/env bash
# scripts/sync-public.sh —— 把 dev（开发主线）的迭代同步到 release（对外发布分支）
#
# 为什么不能直接 `git merge dev`：
#   dev 上刻意不存在任何对外发布资产（发布脚本 / 对外 README / 发布指南 / 包名与协议等
#   发布身份字段）。merge 时 dev 的「这些文件不存在」会被当成删除应用掉，所以合并后
#   必须从「合并前的 release」（脚本内记作 REL_PREV）逐个恢复。反向地，只属于 dev 的
#   开发主线资产（本脚本自身）要从 release 移除，不能随发布分支出去。
#
# 另一个坑：本脚本只存在于 dev。切到 release 后它在工作树里就没了，而 bash 是按偏移
#   逐行读脚本文件的 —— 内容被替换或删除会执行到错误的东西（2026-09-10 在 promote
#   上踩过：脚本运行中自我替换，实际执行的仍是旧逻辑）。所以开头先自复制到临时目录
#   再 exec，之后读的是副本。
#
# 用法：
#   npm run sync                  # 合并 → 恢复发布资产 → 验证 → 本地提交
#   npm run sync -- --push        # 额外推 public（release + dev）
#   npm run sync -- --no-verify   # 跳过 vitest / vue-tsc
#   npm run sync -- --dry-run     # 仅打印步骤，不改动
#
# 前置：在 dev 分支、工作树干净、已配置 public remote。
# 发版请用 release 分支上的 `npm run release`。
set -euo pipefail

DO_PUSH=0
DO_VERIFY=1
DRY=0
for a in "$@"; do
  case "$a" in
    --push) DO_PUSH=1 ;;
    --no-verify) DO_VERIFY=0 ;;
    --dry-run) DRY=1 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "未知参数: $a" >&2; exit 2 ;;
  esac
done

# ---- 自复制后 exec：切分支后原文件可能消失 ----
if [ -z "${TD_SYNC_SELF:-}" ]; then
  TD_SYNC_SELF=1
  export TD_SYNC_SELF
  _self_dir="$(mktemp -d)"
  cp "$0" "$_self_dir/sync-public.sh"
  exec bash "$_self_dir/sync-public.sh" "$@"
fi

c_reset=$'\033[0m'; c_bold=$'\033[1m'; c_green=$'\033[32m'; c_yellow=$'\033[33m'
info() { printf '%s[sync]%s %s\n' "$c_green" "$c_reset" "$*"; }
warn() { printf '%s[sync]%s %s\n' "$c_yellow" "$c_reset" "$*"; }
run() { if [ $DRY -eq 1 ]; then printf '%s[dry-run]%s %s\n' "$c_bold" "$c_reset" "$*"; else "$@"; fi; }

# ---- 守卫 ----
[ "$(git rev-parse --abbrev-ref HEAD)" = "dev" ] \
  || { echo "请先切到 dev 分支（当前：$(git rev-parse --abbrev-ref HEAD)）" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] \
  || { echo "工作树不干净，请先提交或暂存改动" >&2; exit 1; }
git remote get-url public >/dev/null 2>&1 \
  || { echo "未配置 public remote（git remote add public <公开仓库地址>）" >&2; exit 1; }

# ---- 1. 拉取远端 release ----
info "1/7 拉取 public release 最新状态"
run git fetch public release || warn "  远端尚无 release 分支，跳过"

# ---- 2. 切到 release ----
info "2/7 切到 release"
run git checkout release

# release 侧权威的 package.json 先备份（合并后按字段恢复发布身份）
REL_PKG="$(mktemp)"
if [ $DRY -eq 0 ]; then cp package.json "$REL_PKG"; fi
# 记录合并前 release 的位置。**不能用 release@{1}** —— git checkout 会往分支 reflog
# 写一条同值条目，合并后 release@{1} 可能落到更早一代，把上一代的发布资产恢复出来
# （2026-09-14 实测：README / release.sh 回退成旧的 @scope 包名版本）。
REL_PREV="$(git rev-parse HEAD)"

# ---- 3. 合并 dev ----
info "3/7 合并 dev（冲突取 dev 侧 -X theirs）"
if ! run git merge --no-edit --allow-unrelated-histories -X theirs dev; then
  echo "合并产生需人工解决的冲突。" >&2
  echo "  解决后执行：git commit；确认无误再 git checkout dev" >&2
  echo "  放弃本次同步：git merge --abort && git checkout dev" >&2
  exit 1
fi

# ---- 4. 恢复 release 侧发布资产（dev 上没有，merge 会当成删除） ----
info "4/7 恢复 release 侧发布资产"
PUBLIC_ASSETS=(
  scripts/release.sh
  scripts/merge-package-json.mjs
  scripts/publish-assets
  docs/publish-npm.md
  README.md
  LICENSE
)
for p in "${PUBLIC_ASSETS[@]}"; do
  if git cat-file -e "$REL_PREV:$p" 2>/dev/null; then
    run git checkout "$REL_PREV" -- "$p"
  else
    warn "  跳过（合并前的 release 无此路径）：$p"
  fi
done

# ---- 4b. 移除只属于 dev 的开发主线资产（不该出现在对外发布分支） ----
info "4b 移除 release 侧不该有的开发主线资产"
DEV_ONLY_ASSETS=(
  scripts/sync-public.sh
)
for p in "${DEV_ONLY_ASSETS[@]}"; do
  if [ -e "$p" ]; then
    run git rm --cached -q -- "$p"
    if [ $DRY -eq 0 ]; then rm -f "$p"; fi
    info "  已移除：$p"
  fi
done

# ---- 5. 恢复发布身份字段（按字段，不整体覆盖） ----
info "5/7 恢复发布身份字段（包名 / 协议 / 仓库地址）"
run node scripts/merge-package-json.mjs package.json "$REL_PKG"
run git add package.json
rm -f "$REL_PKG" 2>/dev/null || true

# ---- 6. 验证 ----
if [ $DO_VERIFY -eq 1 ]; then
  info "6/7 验证 vitest + vue-tsc"
  if [ $DRY -eq 0 ]; then
    node_modules/.bin/vitest run || { echo "vitest 未通过，已停在 release 分支" >&2; exit 1; }
    node_modules/vue-tsc/bin/vue-tsc.js --noEmit || { echo "vue-tsc 未通过，已停在 release 分支" >&2; exit 1; }
  else
    info "  [dry-run] 跳过"
  fi
else
  info "6/7 跳过验证（--no-verify）"
fi

# ---- 7. 提交 / 推送 / 切回 ----
info "7/7 提交并推送"
if [ -z "$(git status --porcelain)" ]; then
  info "无变更（dev 已全部并入 release），无需提交"
else
  MSG="sync: 合并 dev 到 release（恢复发布资产与发布身份字段）"
  if [ $DRY -eq 0 ]; then
    run git commit -q -m "$MSG"
    info "已提交 $(git rev-parse --short HEAD)"
  else
    info "  [dry-run] 将提交：$MSG"
  fi
fi

if [ $DO_PUSH -eq 1 ]; then
  run git push public release
  info "已推 public：release"
else
  info "未推送（加 --push 可推 public 的 release）"
fi

run git checkout dev
info "已切回 dev。发版：git checkout release && npm run release"
