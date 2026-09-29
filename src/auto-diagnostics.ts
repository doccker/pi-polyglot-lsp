import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { LspDiagnostic } from './client.js';
import { load_config } from './config.js';
import type { LspServerManager } from './server-manager.js';
import { detect_language, find_workspace_root } from './servers.js';
import type { LspStatus } from './ui.js';

/** 等待诊断的上限；超过即按已收到的结果返回，不拖慢编辑 */
export const AUTO_DIAGNOSTICS_WAIT_MS = 1_500;
const MAX_ERROR_LINES = 5;
const MAX_MESSAGE_WIDTH = 160;
const EDIT_TOOLS = new Set(['edit', 'write']);

/** 追加到系统提示：告知模型编辑结果已带诊断，避免再单独调用一轮 */
export const AUTO_DIAGNOSTICS_PROMPT = `

Edits and writes to language-server-supported files are automatically followed by an "LSP diagnostics (auto)" line appended to the tool result. Treat it as the post-edit diagnostics check for that file; do not call lsp_diagnostics again for the same unchanged file. If no such line appears, the language server was still starting.`;

export function auto_diagnostics_enabled(): boolean {
	try {
		return load_config().autoDiagnostics !== false;
	} catch {
		// 配置错误在 LSP 工具调用时显式报告，这里不重复处理
		return false;
	}
}

/**
 * edit/write 成功后：语言服务器已运行则取该文件诊断并追加一行摘要；
 * 未运行则后台预热，本次不追加、不等待。追加内容控制在一行 + 至多 5 条 error。
 */
export function register_auto_diagnostics(pi: ExtensionAPI, manager: LspServerManager, status: LspStatus): void {
	pi.on('tool_result', async (event, ctx) => {
		if (!EDIT_TOOLS.has(event.toolName) || event.isError) return undefined;
		const path = event.input.path;
		if (typeof path !== 'string' || !auto_diagnostics_enabled()) return undefined;
		const abs = manager.resolve_abs(path);
		const language = safe_detect(abs);
		if (!language) return undefined;
		if (!is_server_running(manager, abs, language)) {
			// 预热失败会记入 manager.failed_servers，下次显式调用时报告
			void warm_up(manager, abs).catch(() => undefined);
			return undefined;
		}
		const id = `auto:${event.toolCallId}`;
		status.begin(id, 'lsp_diagnostics', { file: abs }, ctx);
		try {
			const diagnostics = await collect(manager, abs);
			if (!diagnostics) return undefined;
			return { content: [...event.content, { type: 'text' as const, text: format_auto_diagnostics(diagnostics) }] };
		} finally {
			status.end(id, ctx);
		}
	});
}

export function format_auto_diagnostics(diagnostics: LspDiagnostic[]): string {
	const errors = diagnostics.filter((d) => d.severity === 1);
	const warnings = diagnostics.filter((d) => d.severity === 2).length;
	if (errors.length === 0 && warnings === 0) return 'LSP diagnostics (auto): no errors';
	const parts = [];
	if (errors.length > 0) parts.push(`${errors.length} error${errors.length === 1 ? '' : 's'}`);
	if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
	const lines = [`LSP diagnostics (auto): ${parts.join(', ')}`];
	for (const d of errors.slice(0, MAX_ERROR_LINES)) {
		const message = d.message.replace(/\s+/g, ' ').trim();
		const clipped = message.length > MAX_MESSAGE_WIDTH ? `${message.slice(0, MAX_MESSAGE_WIDTH - 1)}…` : message;
		lines.push(`  ${d.range.start.line + 1}:${d.range.start.character + 1} ${clipped}`);
	}
	if (errors.length > MAX_ERROR_LINES) lines.push(`  … ${errors.length - MAX_ERROR_LINES} more errors`);
	return lines.join('\n');
}

function is_server_running(manager: LspServerManager, abs: string, language: string): boolean {
	return manager.clients_by_server.has(`${language}\u0000${find_workspace_root(abs, manager.cwd)}`);
}

async function collect(manager: LspServerManager, abs: string): Promise<LspDiagnostic[] | undefined> {
	const resolved = await manager.resolve_file_state(abs);
	if (!resolved.ok) return undefined;
	try {
		return await resolved.result.state.client.wait_for_diagnostics(resolved.result.uri, AUTO_DIAGNOSTICS_WAIT_MS);
	} catch {
		// 诊断请求失败（超时 / 服务器重启中）时不追加内容，显式 lsp_* 工具仍会报告原因
		return undefined;
	} finally {
		await manager.release_file_state(resolved.result);
	}
}

/** 不传 ctx：后台预热不弹项目二进制信任框，未信任时回退全局 PATH 二进制 */
async function warm_up(manager: LspServerManager, abs: string): Promise<void> {
	const resolved = await manager.resolve_file_state(abs);
	if (resolved.ok) await manager.release_file_state(resolved.result);
}

function safe_detect(abs: string): string | undefined {
	try {
		return detect_language(abs);
	} catch {
		return undefined;
	}
}
