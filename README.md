# pi-polyglot-lsp

给 [Pi](https://pi.dev) 编码助手提供 LSP 工具：诊断、hover、跳转定义、查找引用、文档符号。面向 Go / Rust / Java / TypeScript / Vue 多语言项目，语言服务器可配置。

fork 自 [@spences10/pi-lsp](https://github.com/spences10/my-pi/tree/main/packages/pi-lsp)（MIT），在其基础上增加：

- **可配置语言服务器**：用户级 `~/.pi/agent/polyglot-lsp.json` 覆盖命令/参数/扩展名，禁用或新增语言
- **Vue SFC**：`typescript-language-server` + `@vue/typescript-plugin`，支持 `.vue` 的诊断、定义、引用
- **Java + Lombok**：项目声明 Lombok 时自动给 `jdtls` 注入 `-javaagent`，消除 `builder() undefined` 类误报

## 安装

```bash
pi install npm:pi-polyglot-lsp
# 或 git 源
pi install git:github.com/doccker/pi-polyglot-lsp@v0.1.0
# 单次试用
pi -e npm:pi-polyglot-lsp
```

语言服务器需自行安装并在 `PATH` 上：

| 语言 | 服务器 | 安装 |
|---|---|---|
| Go | `gopls` | `go install golang.org/x/tools/gopls@latest` |
| Rust | `rust-analyzer` | `rustup component add rust-analyzer`（仅有 rustup 代理不够） |
| Java | `jdtls` | `brew install jdtls` 或 Eclipse JDT LS 发行包 |
| TS / JS | `typescript-language-server` | `npm i -g typescript typescript-language-server` |
| Vue | 上面的 TS 服务器 + `@vue/typescript-plugin` | `npm i -g @vue/language-server`（自带插件）或项目内安装插件 |
| Python / Ruby / Lua / Svelte | 同上游 | 见上游说明 |

项目内 TypeScript 7（无 `lib/tsserver.js`）时会改用原生 `tsc --lsp --stdio`；原生 LSP 不支持 tsserver 插件，此时 `.vue` 不可用。

## 工具与命令

工具：`lsp_diagnostics`、`lsp_diagnostics_many`、`lsp_find_symbol`、`lsp_hover`、`lsp_definition`、`lsp_references`、`lsp_document_symbols`。

```text
/lsp status          查看服务器、后端与完整命令
/lsp list
/lsp restart all | <language>
```

扩展会注入一段简短系统提示，提醒模型在改完代码后用 LSP 诊断校验。

### 界面提示

交互 TUI 中每次 LSP 调用显示为两行，默认折叠，展开可看完整输出（只影响显示，模型拿到的内容不变）：

```text
LSP references crates/waf-rules/src/validate.rs:16:11
✓ 15 references
LSP diagnostics src/main/java/com/trade/common/ApiResponse.java
⚠ 3 diagnostics (2 errors)
```

底栏（需 footer 显示扩展状态，如 `pi-open-tui` 的 `extensionStatuses: true`）：

| 阶段 | 显示 |
|---|---|
| 语言服务器冷启动 | `◌ LSP starting rust-analyzer…` |
| 执行中 | `● LSP gopls · references`，并发时追加 `(+N)` |
| 结束后 5 秒 | `✓ LSP gopls · references` |

使用 `@zgltyq/pi-provider-claude` 等会把工具名改写为 `mcp__pi__*` 的 provider 时，对话区工具块按改写后的名字匹配不到自定义渲染，会退回 pi 默认样式（工具名 + JSON 参数）；底栏状态不受影响。

## 配置

`~/.pi/agent/polyglot-lsp.json`（可用 `PI_CODING_AGENT_DIR` 改变目录），不存在时使用内置默认值；格式错误会在工具调用时直接报错，不静默回退。

```json
{
	"languages": {
		"java": { "lombok": "auto" },
		"typescript": { "vuePlugin": "auto" },
		"ruby": { "enabled": false },
		"kotlin": {
			"command": "kotlin-language-server",
			"extensions": [".kt", ".kts"],
			"installHint": "brew install kotlin-language-server"
		}
	}
}
```

| 字段 | 说明 |
|---|---|
| `enabled` | `false` 禁用该语言 |
| `command` / `args` | 覆盖启动命令与参数；新增语言时 `command` 与 `extensions` 必填 |
| `extensions` | 该语言处理的扩展名，需以 `.` 开头 |
| `languageIds` | 扩展名 → LSP `languageId`，如 `{ ".vue": "vue" }` |
| `installHint` | 启动失败时展示的安装提示 |
| `lombok`（java） | `auto`（默认）/ `off` / jar 绝对路径 |
| `vuePlugin`（typescript） | `auto`（默认）/ `off` / 插件目录绝对路径 |

**安全边界**：只读取用户级配置，不读取项目级配置，仓库无法借此声明任意可执行命令。`node_modules/.bin` 下的项目内服务器二进制默认不受信任，交互会话会弹确认，无界面会话回退到 `PATH` 上的全局二进制（`MY_PI_LSP_PROJECT_BINARY=allow|trust` 可放行）。

### 自动探测规则

- **Lombok**：`auto` 时，从 workspace 向上（到 `.git` 为止）查找 `pom.xml` / `build.gradle(.kts)`，任一包含 `lombok` 即启用；jar 取 `~/.m2` 与 `~/.gradle` 缓存中的最高版本；只对命令名为 `jdtls` 的启动脚本注入 `--jvm-arg=-javaagent:<jar>`，自定义命令请自行写入 `args`。
- **Vue**：`auto` 时，从 workspace 向上查找声明了 `vue` 依赖的 `package.json`；插件依次查找项目 `node_modules/@vue/typescript-plugin`、`PATH` 上 `vue-language-server` 所属全局包内的插件。Vue 项目找不到插件时，`.vue` 文件返回明确错误和安装提示，`.ts` 文件不受影响。

## 环境变量

| 变量 | 说明 |
|---|---|
| `MY_PI_LSP_PROJECT_BINARY` | `allow` / `trust`：无界面会话放行项目内服务器二进制 |
| `MY_PI_LSP_ENV_ALLOWLIST` | 逗号分隔，额外透传给语言服务器的环境变量（默认受限环境） |
| `MY_PI_LSP_IDLE_TIMEOUT_MS` | 空闲停止超时，默认 5 分钟，`0` 表示不停止 |

变量名沿用上游，便于从 `@spences10/pi-lsp` 迁移。

## 已知限制

- Vue SFC 的 `lsp_document_symbols` 返回空（TS 插件不提供 SFC 符号），用 `lsp_find_symbol` 或读文件代替
- `rust-analyzer` / `jdtls` 首次建索引期间可能返回 `-32801 content modified` 或空结果（no hover info / no references），稍后重试即可
- 不要与 `@spences10/pi-lsp` 同时启用，两者注册同名工具

## 开发

```bash
npm install
npm run check   # tsc --noEmit
npm test        # vitest
pi -e .         # 本地加载试用
```

## License

MIT，见 [LICENSE](./LICENSE) 与 [NOTICE](./NOTICE)。
