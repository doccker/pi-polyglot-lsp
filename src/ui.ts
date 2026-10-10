import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { basename } from 'node:path';
import { get_registry } from './registry.js';
import {
	action_label,
	summarize_call,
	summarize_result,
} from './render-summary.js';
import type { LspServerManager } from './server-manager.js';
import { detect_language } from './servers.js';

const STATUS_KEY = 'lsp';
const MAX_EXPANDED_LINES = 40;
/** 调用结束后完成提示在底栏停留的时长；极快的调用（几十毫秒）否则来不及被看到 */
export const DONE_LINGER_MS = 5_000;
/** 空闲标识：插件已加载、当前无 LSP 调用（语言服务器按需启动） */
export const IDLE_TEXT = '○ LSP';

type AnyTool = ToolDefinition<any, any, any>;
type ToolRenderers = Pick<AnyTool, 'renderCall' | 'renderResult'>;
type ToolRendererResolver = (tool_name: string, next: () => ToolRenderers | undefined) => ToolRenderers | undefined;
/** 本仓库锁定的 pi 类型尚无 registerToolRenderer，按新版 pi 的公开签名声明 */
type RendererApi = { registerToolRenderer?: (resolver: ToolRendererResolver) => void };

/**
 * `@zgltyq/pi-provider-claude` 发请求时把扩展工具改名为 `mcp__pi__<名字>`，到 message_end 才改回；
 * pi 在流式阶段就按改写后的名字解析渲染器，所以需要为别名额外提供渲染器。
 */
export const CLAUDE_ALIAS_PREFIX = 'mcp__pi__';

/**
 * 包装 ExtensionAPI：对经由它注册的 LSP 工具追加紧凑渲染与底栏状态，
 * 不改变工具参数、执行逻辑和返回给模型的内容。
 */
export function with_lsp_ui(pi: ExtensionAPI, status: LspStatus): ExtensionAPI {
	pi.on('session_start', async (_event, ctx) => status.idle(ctx));
	const aliases = register_alias_renderers(pi);
	return new Proxy(pi, {
		get(target, prop, receiver) {
			if (prop === 'registerTool') {
				return (tool: AnyTool) => {
					const decorated = decorate_tool(tool, status);
					aliases?.set(`${CLAUDE_ALIAS_PREFIX}${tool.name}`, {
						renderCall: decorated.renderCall,
						renderResult: decorated.renderResult,
					});
					target.registerTool(decorated);
				};
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
}

/** 只注册一个 resolver，内部按别名查表；老版本 pi 没有该 API 时返回 undefined 并跳过。 */
function register_alias_renderers(pi: ExtensionAPI): Map<string, ToolRenderers> | undefined {
	const api = pi as unknown as RendererApi;
	if (typeof api.registerToolRenderer !== 'function') return undefined;
	const renderers = new Map<string, ToolRenderers>();
	api.registerToolRenderer((tool_name, next) => renderers.get(tool_name) ?? next());
	return renderers;
}

export function decorate_tool(tool: AnyTool, status: LspStatus): AnyTool {
	return {
		...tool,
		execute: async (id, params, signal, on_update, ctx) => {
			status.begin(id, tool.name, params, ctx);
			try {
				return await tool.execute(id, params, signal, on_update, ctx);
			} finally {
				status.end(id, ctx);
			}
		},
		renderCall: (args, theme, context) => {
			const title = theme.fg('toolTitle', theme.bold(`LSP ${action_label(tool.name)}`));
			const target = summarize_call(tool.name, args ?? {}, context.cwd);
			return new Text(target ? `${title} ${theme.fg('accent', target)}` : title, 0, 0);
		},
		renderResult: (result, { expanded, isPartial }, theme) => {
			if (isPartial) return new Text(theme.fg('warning', 'running…'), 0, 0);
			const content = result.content.find((block) => block.type === 'text');
			const text = content?.type === 'text' ? content.text : '';
			const summary = summarize_result(tool.name, text, result.details);
			let output = theme.fg(summary.tone, summary.text);
			if (expanded) output += expanded_body(text, theme);
			return new Text(output, 0, 0);
		},
	};
}

function expanded_body(text: string, theme: Theme): string {
	const lines = text.split('\n');
	let body = lines
		.slice(0, MAX_EXPANDED_LINES)
		.map((line) => `\n${theme.fg('dim', line)}`)
		.join('');
	if (lines.length > MAX_EXPANDED_LINES) {
		body += `\n${theme.fg('muted', `… ${lines.length - MAX_EXPANDED_LINES} more lines`)}`;
	}
	return body;
}

interface ActiveCall {
	server: string;
	action: string;
	starting: boolean;
}

/**
 * 底栏状态：冷启动显示 starting，执行中显示 server · action；
 * 全部结束后保留完成提示 DONE_LINGER_MS，再回到空闲标识。
 */
export class LspStatus {
	readonly #manager: LspServerManager;
	readonly #active = new Map<string, ActiveCall>();
	#done: ActiveCall | undefined;
	#linger: ReturnType<typeof setTimeout> | undefined;

	constructor(manager: LspServerManager) {
		this.#manager = manager;
	}

	begin(id: string, tool_name: string, params: unknown, ctx?: ExtensionContext): void {
		const { file: single, files } = (params ?? {}) as { file?: string; files?: string[] };
		const file = single ?? files?.[0];
		const language = file ? detect_language_safe(file) : undefined;
		this.#clear_linger();
		this.#active.set(id, {
			server: language ? server_name(language) : 'LSP',
			action: action_label(tool_name),
			starting: language ? !this.#has_running(language) : false,
		});
		this.#render(ctx);
	}

	end(id: string, ctx?: ExtensionContext): void {
		const call = this.#active.get(id);
		this.#active.delete(id);
		if (call && this.#active.size === 0) {
			this.#done = call;
			this.#linger = setTimeout(() => {
				this.#done = undefined;
				this.#linger = undefined;
				this.#render(ctx);
			}, DONE_LINGER_MS);
			this.#linger.unref?.();
		}
		this.#render(ctx);
	}

	/** 会话开始时显示空闲标识。 */
	idle(ctx?: ExtensionContext): void {
		this.#render(ctx);
	}

	/** 当前状态文本（不含颜色），供测试与渲染使用。 */
	text(): { tone: 'warning' | 'accent' | 'muted'; text: string } {
		const calls = [...this.#active.values()];
		const latest = calls.at(-1);
		if (!latest) {
			return this.#done
				? { tone: 'muted', text: `✓ LSP ${this.#done.server} · ${this.#done.action}` }
				: { tone: 'muted', text: IDLE_TEXT };
		}
		const more = calls.length > 1 ? ` (+${calls.length - 1})` : '';
		return latest.starting
			? { tone: 'warning', text: `◌ LSP starting ${latest.server}…${more}` }
			: { tone: 'accent', text: `● LSP ${latest.server} · ${latest.action}${more}` };
	}

	#clear_linger(): void {
		if (this.#linger) clearTimeout(this.#linger);
		this.#linger = undefined;
		this.#done = undefined;
	}

	#has_running(language: string): boolean {
		return [...this.#manager.clients_by_server.keys()].some((key) => key.startsWith(`${language}\u0000`));
	}

	#render(ctx?: ExtensionContext): void {
		if (!ctx?.hasUI) return;
		const current = this.text();
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(current.tone, current.text));
	}
}

function detect_language_safe(file: string): string | undefined {
	try {
		return detect_language(file);
	} catch {
		// 配置错误由工具执行路径报告，状态栏不重复处理
		return undefined;
	}
}

function server_name(language: string): string {
	try {
		const command = get_registry().servers[language]?.command;
		return command ? basename(command) : language;
	} catch {
		return language;
	}
}
