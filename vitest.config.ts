import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

// 隔离 agent 目录：测试不读取本机 ~/.pi/agent 下的 polyglot-lsp.json 与信任库
export default defineConfig({
	test: {
		env: {
			PI_CODING_AGENT_DIR: mkdtempSync(join(tmpdir(), 'polyglot-lsp-agent-')),
		},
	},
});
