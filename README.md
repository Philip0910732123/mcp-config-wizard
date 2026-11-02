# mcp-config-wizard

WorkBuddy 技能（skill）：把第三方 MCP 服务一键配置进 `~/.workbuddy/mcp.json`，覆盖
stdio / streamableHttp / SSE 三种传输，含编译、握手自检与跨平台加固。

## 安装到 WorkBuddy

将本仓库内容放入 `~/.workbuddy/skills/mcp-config-wizard/` 即可，WorkBuddy 启动时会自动加载。

```bash
git clone <this-repo> ~/.workbuddy/skills/mcp-config-wizard
```

## 功能

- 从**本地 zip / npm 包 / 远端 git URL** 生成 `mcp.json` 条目
- 自动 `npm install` + 编译（Node 包）；`uv` 处理（Python/FastMCP 包）
- **两端都有协议级实测**：
  - stdio → `verify_mcp.js`（handshake / `capabilities.experimental` 检测与自愈 / 强制 GBK 编码探测）
  - streamableHttp → `probe_mcp_http.js`（鉴权形态识别 → 真对照 → session → `tools/list` → 真实调用）
- 远端**四种鉴权形态**自动识别：URL 参数 / Bearer 头 / 自定义头 / env 转发头
- **跨平台可移植**：默认裸 `node`（PATH 解析），可选绝对路径单机加固
- curated 补丁注册表（如 openpharma fda-mcp-server 的 experimental 广播修复）

## 目录

- `SKILL.md` —— 完整使用说明与排错表（权威文档）
- `scripts/` —— `scaffold_mcp.js`（生成/编译/自检）、`verify_mcp.js`（stdio 验证）、`probe_mcp_http.js`（远端深验）、`lib.js` / `lang.js`（共享工具）
- `templates/` —— 生成用模板
- `known_patches.json` —— 已知包的预置补丁

详见 [SKILL.md](SKILL.md)。

## 版本管理（GitHub ↔ 技能中心 对齐）

- 版本号用 SemVer（`MAJOR.MINOR.PATCH`）。
- **GitHub tag（`vX.Y.Z`）是权威版本源**；仓库的 [CHANGELOG.md](CHANGELOG.md) 记录每次变更。
- 发布到 WorkBuddy **技能中心**时，**填写与 GitHub tag 相同的版本号**，保证两边一致。
- 发版流程：① 在 `CHANGELOG.md` 加一条 → ② `git tag vX.Y.Z` + `git push --tags` → ③ 在技能中心后台以同一 `X.Y.Z` 发布 / 更新。
- 注意：技能中心不会自动从 GitHub 拉取版本，两边需手动对齐（Hub 版本在后台发布时填写，不从本仓库读取）。
