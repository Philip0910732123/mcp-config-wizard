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

## 版本管理（GitHub ↔ SkillHub 对齐）

- 版本号用 SemVer（`MAJOR.MINOR.PATCH`）。
- **GitHub tag（`vX.Y.Z`）是权威版本源**；仓库的 [CHANGELOG.md](CHANGELOG.md) 记录每次变更。
- 发布到 **SkillHub** 时，`SKILL.md` frontmatter 的 `version` 必须与 GitHub tag 相同，保证两边一致。
- 发版流程：① 在 `CHANGELOG.md` 加一条并改 `SKILL.md` / `skill.manifest.json` 的版本号 → ② `git tag vX.Y.Z` + `git push --tags` → ③ `skillhub publish <目录> --changelog "..."` 以同一 `X.Y.Z` 发布 / 更新。
- 注意：SkillHub 不会自动从 GitHub 拉取版本，两边需手动对齐。

### SkillHub 发布的两个硬约束

1. **不能带 VCS 元文件**。`.gitattributes` / `.gitignore` 会被服务端以「不允许的文件类型」拒绝，需先把白名单文件复制到暂存目录再发布（CLI 会自动跳过 `.git/`）。
2. **不能有无扩展名文件**。`LICENSE`、`NOTICE` 这类无后缀文件名同样被拒，故统一用 `LICENSE.txt` / `NOTICE.txt`。

`skillhub publish <目录> --dry-run` 只校验 frontmatter 与打包，**不校验服务端类型白名单**，预检通过不代表能发布成功。

## 许可与署名

本项目以 **Apache License 2.0** 授权，著作权人 hupan。

- 原仓库：<https://github.com/Philip0910732123/mcp-config-wizard>
- 许可全文：[LICENSE.txt](LICENSE.txt)
- 归属声明要求：[NOTICE.txt](NOTICE.txt)
- 文件指纹：`MCPWIZ-FP-2026-HUPAN-7C41`

可以自由使用、修改、再分发（含商业用途）。**再分发时须保留 LICENSE.txt 与 NOTICE.txt 中的归属声明；修改过的文件须显著标注"已被修改"。**

更名后再发布是允许的，但更名属于修改，因此更名版本必须同时标明它基于 `mcp-config-wizard` 修改，并保留原作者署名与原仓库地址。**只改名、抹掉署名**，同时违反 Apache-2.0 第 4(b)、4(d) 条，可依许可主张违约并向发布平台投诉。

