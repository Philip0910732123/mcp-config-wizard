#!/usr/bin/env bash

# mcp-config-wizard · Copyright 2026 hupan · SPDX-License-Identifier: Apache-2.0
# https://github.com/Philip0910732123/mcp-config-wizard
# 再分发或更名分发须保留本声明与仓库地址（见 LICENSE.txt / NOTICE.txt）。
# fingerprint: MCPWIZ-FP-2026-HUPAN-7C41
# stress_test.sh — mcp-config-wizard 脚本回归压测（一键）
#
# 用途：
#   每次改完 scaffold_mcp.js / verify_mcp.js 后，一键跑 14 个边界用例，确认行为未退化。
#   这是 skill 的「机械层」验证（脚本契约的回归），不含 SKILL.md 决策树/路由的
#   LLM 角色扮演验收（那层需人工或对话驱动）。
#
# 用法：
#   bash scripts/stress_test.sh            # 跑完自动清理夹具
#   bash scripts/stress_test.sh --keep     # 保留夹具（位于 $ROOT）便于排查
#
# 环境：夹具默认落在系统临时目录，且统一转成正斜杠路径——脚本后面会把 $ROOT
#   拼进 JSON 夹具，Windows 的反斜杠路径在 JSON 里会变成 \U 之类的非法转义。
#   改位置用 MCP_STRESS_ROOT 覆盖：MCP_STRESS_ROOT=/tmp/foo bash scripts/stress_test.sh

set -u

# Git Bash 下 coreutils 不全时补上网关路径；其它系统该目录不存在，自动跳过
if [ -d /d/Git/usr/bin ]; then export PATH="/d/Git/usr/bin:/d/Git/cmd:$PATH"; fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SC="$SCRIPT_DIR/scaffold_mcp.js"
VR="$SCRIPT_DIR/verify_mcp.js"

# 夹具根目录：优先 MCP_STRESS_ROOT；否则取 Node 的 os.tmpdir()，再退回 shell 的临时目录。
# 用 Node 解析是为了与脚本内部 Node 看到的是同一个位置（bash 与 node 对 /tmp 的解析常不一致）。
ROOT="${MCP_STRESS_ROOT:-}"
if [ -z "$ROOT" ]; then
  _tmp="$(node -e 'process.stdout.write(require("os").tmpdir())' 2>/dev/null | tr '\\' '/')"
  [ -n "$_tmp" ] || _tmp="${TMPDIR:-${TMP:-/tmp}}"
  ROOT="$_tmp/mcp_stress"
fi
MJ="$ROOT/out.json"

KEEP=0
for a in "$@"; do [[ "$a" == "--keep" ]] && KEEP=1; done

# ---- 生成夹具（自包含，无需预置）----
setup() {
  rm -rf "$ROOT"
  mkdir -p "$ROOT/fixture_nodeps" "$ROOT/fixture_withdeps/node_modules" "$ROOT/existing_dir"
  cat > "$ROOT/fixture_nodeps/package.json" <<'EOF'
{ "name": "nodeps", "version": "1.0.0", "main": "index.js" }
EOF
  cat > "$ROOT/fixture_withdeps/package.json" <<'EOF'
{ "name": "withdeps", "version": "1.0.0", "main": "index.js" }
EOF
  cat > "$ROOT/lonely_index.js" <<'EOF'
// 孤立 index.js（附近无 node_modules），仅用于 --index 邻近依赖告警测试
console.log('hello from lonely index');
EOF
  cat > "$ROOT/mock_server.js" <<'EOF'
// 最小 MCP stdio 模拟服务器：正确响应 initialize 与 tools/list，用于验证握手成功路径
let buf = '';
process.stdin.on('data', d => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.method === 'initialize') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'mock', version: '1.0.0' } } }) + '\n');
    } else if (m.method === 'tools/list') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'ping' }, { name: 'echo' }] } }) + '\n');
    }
  }
});
EOF
  printf '{\n  "mcpServers": {\n    "present": {"type":"streamableHttp","url":"https://example.com/mcp","disabled":false},\n    "cloudentry": {"type":"streamableHttp","url":"https://example.com/cloud","disabled":false},\n    "mock": {"command":"node","args":["%s/mock_server.js"],"disabled":false}\n  }\n}\n' "$ROOT" > "$ROOT/mcp_test.json"
}

PASS=0
TOTAL=0

# run_test <描述> <期望: OK | ERR:子串> <必须包含: 可为空> -- node <参数...>
run_test() {
  local desc="$1" expect="$2" must="$3"; shift 3
  local out rc
  out=$("$@" 2>&1); rc=$?
  local ok=0
  if [[ "$expect" == OK ]]; then
    if [[ $rc -eq 0 ]] && { [[ -z "$must" ]] || [[ "$out" == *"$must"* ]]; }; then ok=1; fi
  else
    local sub="${expect#ERR:}"
    if [[ $rc -ne 0 ]] && [[ "$out" == *"$sub"* ]]; then ok=1; fi
  fi
  TOTAL=$((TOTAL + 1))
  if [[ $ok -eq 1 ]]; then PASS=$((PASS + 1)); echo "  ✅ $desc"; else echo "  ❌ $desc"; echo "     >> $out"; fi
}

main() {
  setup
  echo "scaffold_mcp.js 压测："
  run_test "T1 非 mcpServers JSON 且无 --name" "ERR:不是 mcpServers JSON" "" node "$SC" --from-json '{"foo":1}' --mcp-json "$MJ"
  run_test "T2 URL 含占位符但无 --api-key" "ERR:URL 含密钥占位符" "" node "$SC" --from-url 'https://x.com/mcp?key=YOUR_API_KEY' --name t2 --mcp-json "$MJ"
  run_test "T3 URL+key 替换成功且 dry-run 输出脱敏" "OK" "key=***" node "$SC" --from-url 'https://x.com/mcp?key=YOUR_API_KEY' --name t3 --api-key SECRET123 --dry-run --mcp-json "$MJ"
  run_test "T3b 落盘仍写明文 key（脱敏只作用于输出）" "OK" "" bash -c "node \"$SC\" --from-url 'https://x.com/mcp?key=YOUR_API_KEY' --name t3b --api-key SECRET123 --mcp-json '$ROOT/t3b.json' >/dev/null && grep -q SECRET123 '$ROOT/t3b.json' && echo wrote-plaintext"
  run_test "T4 from-json 含 mcpServers 识别" "OK" "streamableHttp" node "$SC" --from-json '{"mcpServers":{"s1":{"url":"https://x/mcp","disabled":false}}}' --dry-run --mcp-json "$MJ"
  run_test "T5 from-dir 无 node_modules 告警" "OK" "无 node_modules" node "$SC" --from-dir "$ROOT/fixture_nodeps" --name t5 --dry-run --mcp-json "$MJ"
  run_test "T6 from-dir 有 node_modules" "OK" "已含 node_modules" node "$SC" --from-dir "$ROOT/fixture_withdeps" --name t6 --dry-run --mcp-json "$MJ"
  run_test "T7 安装目录已存在且无 --overwrite" "ERR:安装目录已存在" "" node "$SC" --from-dir "$ROOT/fixture_nodeps" --name t7 --install-dir "$ROOT/existing_dir" --mcp-json "$MJ"
  run_test "T8 --index 邻近无 node_modules 告警" "OK" "附近无 node_modules" node "$SC" --index "$ROOT/lonely_index.js" --name t8 --dry-run --mcp-json "$MJ"
  run_test "T9 --pkg npx 远程包" "OK" "npx" node "$SC" --pkg @some/scope-pkg --name t9 --dry-run --mcp-json "$MJ"
  run_test "T10 from-dir 指向文件（非目录）" "ERR:找不到任何可识别的 MCP 包标记" "" node "$SC" --from-dir "$ROOT/fixture_nodeps/package.json" --name t10 --dry-run --mcp-json "$MJ"

  echo "verify_mcp.js 压测："
  run_test "V1a mcp.json 路径不存在" "ERR:mcp.json 不存在" "" node "$VR" --name mock --mcp-json "$ROOT/nope.json"
  run_test "V1b mcp.json 存在但名字不存在" "ERR:找不到" "" node "$VR" --name notexist --mcp-json "$ROOT/mcp_test.json"
  run_test "V2 条目非 stdio（无 command）" "ERR:不是 stdio 类型" "" node "$VR" --name cloudentry --mcp-json "$ROOT/mcp_test.json"
  run_test "V3 命令立即退出（超时）" "ERR:超时" "" node "$VR" --command node --args '-e process.exit(1)' --timeout 2500 --mcp-json "$MJ"
  run_test "V4 真实模拟服务器握手" "OK" "ping, echo" node "$VR" --name mock --mcp-json "$ROOT/mcp_test.json"

  echo "----------------------------------------"
  echo "结果：$PASS / $TOTAL 通过"
  [[ $KEEP -eq 0 ]] && rm -rf "$ROOT"
  [[ $PASS -eq $TOTAL ]]
}

main
