# Changelog

## 0.1.2

- 底栏常驻空闲标识 `○ LSP`：插件加载即显示，调用时切换为 starting / 执行中，完成提示停留 5 秒后回到空闲

## 0.1.1

- 工具调用紧凑渲染：调用行 `LSP references path:line:col`，结果默认一行摘要（引用数、诊断数/错误数、hover 签名、失败原因），展开可看完整输出
- 底栏状态：冷启动 `◌ LSP starting <server>…`，执行中 `● LSP <server> · <action>`，结束后 `✓ …` 停留 5 秒
- `publishConfig.registry` 固定为 npmjs 官方源，避免误发到镜像
- 仅影响 TUI 显示，返回给模型的内容不变

## 0.1.0

- 基于 `@spences10/pi-lsp` 0.0.47（spences10/my-pi@fbee2bf6ad88）fork
- 新增用户级配置 `~/.pi/agent/polyglot-lsp.json`：覆盖、禁用、新增语言服务器
- 新增 Vue SFC 支持（`@vue/typescript-plugin` 自动探测）
- 新增 Java Lombok 自动注入（`jdtls --jvm-arg=-javaagent`）
- 改为直接发布 TypeScript 源码，测试迁移到 vitest
