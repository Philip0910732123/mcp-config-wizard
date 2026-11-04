#!/usr/bin/env bash

# mcp-config-wizard · Copyright 2026 hupan · SPDX-License-Identifier: Apache-2.0
# https://github.com/Philip0910732123/mcp-config-wizard
# 再分发或更名分发须保留本声明与仓库地址（见 LICENSE / NOTICE）。
# fingerprint: MCPWIZ-FP-2026-HUPAN-7C41
# =============================================================================
# release.sh — 一键发版（本地内容 → GitHub tag/Release → skillhub.cn）
#
# 为什么需要它：发版链路有 6 个动作、3 处版本号、2 个平台，手工做每次都可能漏，
# 过去真实踩过的坑都在这里被固化成"前置校验"，不满足就直接停，不产生半成品：
#   ① 平台拒收 .gitignore           → 打包由 publish.js 排除，本脚本直接调它
#   ② SKILL.md / manifest 版本不一致 → 前置校验，不一致即停
#   ③ CHANGELOG 没写对应版本段      → 前置校验，没有段落即停（避免空 changelog 上线）
#   ④ tag 已存在 / 版本已发布        → 前置校验，重复版本即停
#   ⑤ 先提交后发布，发布失败留脏状态 → 顺序改为"先发布成功，再提交打 tag"
#   ⑥ 发了平台忘了推 tag             → 脚本内一次性完成，末尾回验远端
#
# 用法：
#   bash scripts/release.sh                 # 版本自动取 SKILL.md，需交互确认
#   bash scripts/release.sh 1.5.0           # 指定版本
#   bash scripts/release.sh --dry-run       # 只跑校验与预演，不做任何写操作
#   bash scripts/release.sh --yes           # 免确认（CI / 让助手代跑）
#   bash scripts/release.sh 1.5.0 --skip-github    # 本机没装 gh 时
#   bash scripts/release.sh 1.5.0 --skip-platform  # 只发 GitHub
#
# 退出码：0 成功；1 校验或执行失败；2 用户取消
# =============================================================================
set -uo pipefail

# Git Bash 在部分环境的 PATH 里缺 coreutils，先兜一层（不存在也无害）
case ":$PATH:" in
  *":/usr/bin:"*) ;;
  *) [ -d /usr/bin ] && PATH="/usr/bin:/bin:$PATH" ;;
esac
export PATH

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT" || { echo "无法进入技能目录: $ROOT" >&2; exit 1; }

# ---------- 输出 ----------
if [ -t 1 ]; then
  B=$'\033[1m'; R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; D=$'\033[2m'; N=$'\033[0m'
else
  B=''; R=''; G=''; Y=''; D=''; N=''
fi
info() { printf '%s\n' "$*"; }
step() { printf '\n%s\n' "${B}=== $* ===${N}"; }
ok()   { printf '%s\n' "${G}✓${N} $*"; }
warn() { printf '%s\n' "${Y}⚠${N} $*"; }
die()  { printf '%s\n' "${R}✗${N} $*" >&2; exit 1; }

# ---------- 参数 ----------
VERSION=""
DRY_RUN=0
ASSUME_YES=0
SKIP_GITHUB=0
SKIP_PLATFORM=0
BRANCH=""
for arg in "$@"; do
  case "$arg" in
    --dry-run)        DRY_RUN=1 ;;
    --yes|-y)         ASSUME_YES=1 ;;
    --skip-github)    SKIP_GITHUB=1 ;;
    --skip-platform)  SKIP_PLATFORM=1 ;;
    --branch=*)       BRANCH="${arg#*=}" ;;
    -h|--help)        sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)               die "未知参数：$arg（--help 查看用法）" ;;
    *)                VERSION="$arg" ;;
  esac
done

# ---------- 0. 环境 ----------
step "0. 环境检查"
command -v git >/dev/null 2>&1 || die "找不到 git"
git rev-parse --git-dir >/dev/null 2>&1 || die "$ROOT 不是 git 仓库"

NODE=""
if command -v node >/dev/null 2>&1; then
  NODE="node"
else
  for p in "$HOME"/.workbuddy/binaries/node/versions/*/node.exe "$HOME"/.workbuddy/binaries/node/versions/*/bin/node; do
    [ -x "$p" ] && NODE="$p"
  done
fi
[ -n "$NODE" ] || die "找不到 node（发版脚本依赖它调 skillhub CLI 与查平台状态）"
ok "node: $("$NODE" -v 2>/dev/null)"

[ -n "$BRANCH" ] || BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" != "HEAD" ] || die "当前处于 detached HEAD，请先切到分支"
case "$BRANCH" in master|main) ;; *) warn "当前分支是 $BRANCH（不是 master/main），确认无误再继续" ;; esac
ok "分支: $BRANCH"

# Git Bash 在「嵌套执行」（被 CI / 助手 / 其它脚本调用）时会丢掉 USERPROFILE 与 TEMP，
# 而 Windows 上的 Python 取家目录只认 USERPROFILE、不认 MSYS 风格的 HOME，
# 缺了就会让 skillhub CLI 崩在 "Could not determine home directory"。这里补齐。
if [ -z "${USERPROFILE:-}" ] && [ -n "${HOME:-}" ]; then
  case "$HOME" in
    /?*) USERPROFILE="$(cygpath -w "$HOME" 2>/dev/null || printf '%s' "$HOME")" ;;
    *)   USERPROFILE="$HOME" ;;
  esac
  [ -n "${USERPROFILE:-}" ] && export USERPROFILE
fi
if [ -z "${TEMP:-}" ]; then
  if [ -n "${TMPDIR:-}" ]; then TEMP="$TMPDIR"
  elif [ -n "${USERPROFILE:-}" ]; then TEMP="$USERPROFILE\\AppData\\Local\\Temp"
  fi
fi
[ -n "${TEMP:-}" ] && { export TEMP; export TMP="$TEMP"; }

# gh 在 Windows 上把凭据存在 %APPDATA%\GitHub CLI，缺了 APPDATA 会被判成"未登录"
if [ -z "${APPDATA:-}" ] && [ -n "${USERPROFILE:-}" ]; then
  APPDATA="$USERPROFILE\\AppData\\Roaming"; export APPDATA
fi
if [ -z "${LOCALAPPDATA:-}" ] && [ -n "${USERPROFILE:-}" ]; then
  LOCALAPPDATA="$USERPROFILE\\AppData\\Local"; export LOCALAPPDATA
fi

# ---------- 1. 版本号三处一致 ----------
step "1. 版本一致性"
if [ -z "$VERSION" ]; then
  VERSION="$(sed -n 's/^version:[[:space:]]*["'\'']\{0,1\}\([0-9][0-9.]*\)["'\'']\{0,1\}[[:space:]]*$/\1/p' SKILL.md | head -n1)"
fi
[ -n "$VERSION" ] || die "无法确定版本号：SKILL.md front matter 缺少 version，或命令行未指定"
printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || die "版本号格式应为 x.y.z，实际：$VERSION"

FILE_VER="$(sed -n 's/^version:[[:space:]]*["'\'']\{0,1\}\([0-9][0-9.]*\)["'\'']\{0,1\}[[:space:]]*$/\1/p' SKILL.md | head -n1)"
MAN_VER="$("$NODE" -e 'try{process.stdout.write(String(require("./skill.manifest.json").version||""))}catch(e){}' 2>/dev/null)"
info "  SKILL.md         ${FILE_VER:-（缺失）}"
info "  skill.manifest   ${MAN_VER:-（缺失）}"
info "  本次发布         ${VERSION}"

[ -n "$FILE_VER" ] || die "SKILL.md 里没有 version"
[ "$FILE_VER" = "$VERSION" ] || die "版本不一致：SKILL.md=$FILE_VER，本次=$VERSION。先改 SKILL.md 再发版"
if [ -n "$MAN_VER" ]; then
  [ "$MAN_VER" = "$VERSION" ] || die "版本不一致：skill.manifest.json=$MAN_VER，本次=$VERSION。先改 manifest 再发版"
else
  warn "skill.manifest.json 无 version 字段（跳过该项校验）"
fi
ok "三处版本一致：$VERSION"

# ---------- 2. CHANGELOG 必须有对应段落 ----------
step "2. 变更记录"
grep -q "^## \[${VERSION}\]" CHANGELOG.md 2>/dev/null \
  || die "CHANGELOG.md 里没有 '## [${VERSION}]' 段落。先补一条变更记录（这是 changelog 与 GitHub Release 的唯一来源）"
ok "CHANGELOG.md 含 [${VERSION}] 段落"
if grep -q '^## \[Unreleased\]' CHANGELOG.md; then
  warn "CHANGELOG.md 还有 [Unreleased] 段落，注意把本版内容归到 [${VERSION}] 下再发"
fi

# 本节 markdown（给 GitHub Release 用）与一句话摘要（给 commit/tag 用）
# 注：不用 mktemp —— Windows 下它返回的 /tmp 未必可写，改为仓库内 *.tmp（已被 .gitignore 覆盖）
NOTES_FILE="$ROOT/.release-notes.$$.tmp"
trap 'rm -f "$NOTES_FILE"' EXIT
: > "$NOTES_FILE" || die "无法创建临时文件：$NOTES_FILE"
awk -v ver="$VERSION" '
  $0 ~ ("^## \\[" ver "\\]") { f=1; next }
  f && /^## / { exit }
  f { print }
' CHANGELOG.md > "$NOTES_FILE"
[ -s "$NOTES_FILE" ] || die "无法提取 [${VERSION}] 段落正文"
SUMMARY="$(grep -v '^[[:space:]]*$' "$NOTES_FILE" | head -n1 | sed 's/^\*\*//; s/\*\*$//; s/[。；]$//')"
[ -n "$SUMMARY" ] || SUMMARY="release v$VERSION"
ok "摘要：$SUMMARY"

# ---------- 3. 代码语法门禁 ----------
step "3. 脚本语法"
JS_FAIL=0
for f in scripts/*.js; do
  [ -f "$f" ] || continue
  if "$NODE" --check "$f" >/dev/null 2>&1; then
    printf '  %s\n' "${D:-}$f${N:-}"; printf '    %s\n' "${G}✓${N}"
  else
    printf '  %s\n' "$f"; printf '    %s\n' "${R}✗ 语法错误${N}"; JS_FAIL=1
  fi
done
[ "$JS_FAIL" -eq 0 ] || die "有脚本未通过语法检查，先修好再发版"
ok "全部 JS 脚本语法通过"

# ---------- 4. 重复发布检查 ----------
step "4. 重复发布检查"
if git rev-parse --verify --quiet "refs/tags/v${VERSION}" >/dev/null; then
  die "本地已存在 tag v${VERSION}。版本号必须递增：先升版本再发（或删错 tag 后重来）"
fi
if command -v git >/dev/null 2>&1; then
  if GIT_TERMINAL_PROMPT=0 git ls-remote --tags origin "refs/tags/v${VERSION}" 2>/dev/null | grep -q .; then
    die "远端已存在 tag v${VERSION}，不能重复发版"
  fi
fi
ok "tag v${VERSION} 未被占用"

PLATFORM_VER="$("$NODE" -e '
  (async () => {
    try {
      const r = await fetch("https://api.skillhub.cn/api/v1/skills/mcp-config-wizard");
      const j = await r.json();
      const d = j.data || j;
      const v = (d.latestVersion && d.latestVersion.version) || "";
      process.stdout.write(v);
    } catch { process.stdout.write(""); }
  })();
' 2>/dev/null)"
if [ -n "$PLATFORM_VER" ]; then
  info "  平台当前版本：$PLATFORM_VER"
  if [ "$PLATFORM_VER" = "$VERSION" ]; then
    if [ "$SKIP_PLATFORM" -eq 1 ]; then
      warn "平台已是 $VERSION（本次跳过平台发布，继续）"
    else
      die "平台已是 $VERSION，无需重复发布"
    fi
  fi
else
  warn "查不到平台当前版本（网络或接口变动），跳过该检查"
fi

# ---------- 5. 打包预检（会打印待上传文件） ----------
step "5. 打包预检"
"$NODE" scripts/publish.js --version "$VERSION" --dry-run || die "打包预检失败（看上面的报错）"
ok "打包预检通过"

# 展示计划
step "6. 将要执行"
cat <<EOF
  1) 发布 ${VERSION} 到 skillhub.cn
  2) git commit -m "feat: v${VERSION} — ${SUMMARY}"
  3) git tag v${VERSION}
  4) git push origin ${BRANCH} --tags
EOF
if [ "$SKIP_GITHUB" -eq 1 ]; then
  info "  5) （已跳过 GitHub Release）"
else
  info "  5) gh release create v${VERSION}"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  printf '\n%s\n' "${Y}--dry-run${N}：以上为预演，未做任何写操作。"
  rm -f "$NOTES_FILE"
  exit 0
fi

if [ "$ASSUME_YES" -eq 0 ] && [ -t 0 ]; then
  printf '\n继续执行？[y/N] '
  read -r ans
  case "$ans" in y|Y|yes|YES) ;; *) info "已取消"; rm -f "$NOTES_FILE"; exit 2 ;; esac
fi

# ---------- 6. 发布到平台（先发布，成功后才动 git） ----------
if [ "$SKIP_PLATFORM" -eq 1 ]; then
  step "7. 平台发布（已跳过）"
else
  step "7. 发布到 skillhub.cn"
  "$NODE" scripts/publish.js --version "$VERSION" || die "平台发布失败。git 未做任何改动，修好问题后可原样重跑"
  ok "平台已接受 $VERSION（仍需平台审核后才会替换线上 latestVersion）"
fi

# ---------- 7. 提交 + 打 tag ----------
step "8. 提交并打 tag"
if [ -z "$(git status --porcelain)" ]; then
  warn "没有需要提交的改动（版本号与 CHANGELOG 之前已提交？）"
else
  git add -A || die "git add 失败"
  {
    printf 'feat: v%s — %s\n\n' "$VERSION" "$SUMMARY"
    cat "$NOTES_FILE"
  } | git commit -F - || die "git commit 失败"
  ok "已提交：$(git log -1 --oneline)"
fi
git tag "v${VERSION}" || die "打 tag 失败"
ok "已打 tag v${VERSION}"

# ---------- 8. 推送 ----------
step "9. 推送到 GitHub"
GIT_TERMINAL_PROMPT=0 git push origin "$BRANCH" || die "推送分支失败（检查凭据/网络）"
GIT_TERMINAL_PROMPT=0 git push origin "v${VERSION}" || die "推送 tag 失败"
ok "分支与 tag 均已推送"

# ---------- 9. GitHub Release ----------
if [ "$SKIP_GITHUB" -eq 1 ]; then
  step "10. GitHub Release（已跳过）"
elif ! command -v gh >/dev/null 2>&1; then
  warn "未安装 gh CLI，跳过 Release。可手动执行："
  info "  gh release create v${VERSION} --title \"v${VERSION} — ${SUMMARY}\" --notes-file <notes>"
elif ! gh auth status >/dev/null 2>&1; then
  warn "gh 未登录，跳过 Release。可执行 gh auth login 后手动补：gh release create v${VERSION} --notes-file <notes>"
else
  step "10. GitHub Release"
  gh release create "v${VERSION}" --title "v${VERSION} — ${SUMMARY}" --notes-file "$NOTES_FILE" --latest \
    || warn "Release 创建失败（tag 已推送，可稍后手动补）"
  command -v gh >/dev/null 2>&1 && ok "Release: $(gh release view "v${VERSION}" --json url -q .url 2>/dev/null)"
fi

# ---------- 10. 回验 ----------
step "11. 回验"
LOCAL_TAG="$(git rev-parse --short "v${VERSION}" 2>/dev/null)"
REMOTE_TAG="$(GIT_TERMINAL_PROMPT=0 git ls-remote --tags origin "refs/tags/v${VERSION}" 2>/dev/null | awk '{print substr($1,1,7)}')"
info "  本地 tag ${LOCAL_TAG:-?} ／ 远端 tag ${REMOTE_TAG:-未推送}"
[ -n "$REMOTE_TAG" ] || warn "远端仍未见 tag，稍后手动确认"
if [ "$SKIP_PLATFORM" -eq 0 ]; then
  NEW_PLATFORM_VER="$("$NODE" -e '
  (async () => {
    try {
      const r = await fetch("https://api.skillhub.cn/api/v1/skills/mcp-config-wizard");
      const j = await r.json();
      const d = j.data || j;
      process.stdout.write((d.latestVersion && d.latestVersion.version) || "");
    } catch { process.stdout.write(""); }
  })();
' 2>/dev/null)"
  info "  平台 latestVersion：${NEW_PLATFORM_VER:-（查询失败）}"
  if [ -n "$NEW_PLATFORM_VER" ] && [ "$NEW_PLATFORM_VER" != "$VERSION" ]; then
    warn "平台仍显示 ${NEW_PLATFORM_VER} —— 新版本一般处于审核中，通过后自动替换"
  fi
else
  info "  平台发布已跳过，不做平台回验"
fi

rm -f "$NOTES_FILE"
step "完成"
ok "v${VERSION} 发版流程结束"
info ""
info "  ${D}GitHub：${N}https://github.com/Philip0910732123/mcp-config-wizard"
info "  ${D}发布日志：${N}git log -1"
