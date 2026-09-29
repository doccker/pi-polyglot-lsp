# Changelog

## 0.1.0

- 基于 `@spences10/pi-lsp` 0.0.47（spences10/my-pi@fbee2bf6ad88）fork
- 新增用户级配置 `~/.pi/agent/polyglot-lsp.json`：覆盖、禁用、新增语言服务器
- 新增 Vue SFC 支持（`@vue/typescript-plugin` 自动探测）
- 新增 Java Lombok 自动注入（`jdtls --jvm-arg=-javaagent`）
- 改为直接发布 TypeScript 源码，测试迁移到 vitest
