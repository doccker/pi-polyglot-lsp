import { isAbsolute, relative } from 'node:path';

/** 调用行里的简短动作名（英文，国际通用） */
const ACTION_LABELS: Record<string, string> = {
	lsp_diagnostics: 'diagnostics',
	lsp_diagnostics_many: 'diagnostics',
	lsp_find_symbol: 'find symbol',
	lsp_hover: 'hover',
	lsp_definition: 'definition',
	lsp_references: 'references',
	lsp_document_symbols: 'symbols',
};

const MAX_PATH_WIDTH = 60;
const MAX_HOVER_WIDTH = 80;

export type SummaryTone = 'success' | 'warning' | 'error' | 'muted';

export interface ResultSummary {
	tone: SummaryTone;
	text: string;
}

interface ToolArgs {
	file?: string;
	files?: string[];
	line?: number;
	character?: number;
	query?: string;
}

export function action_label(tool_name: string): string {
	return ACTION_LABELS[tool_name] ?? tool_name.replace(/^lsp_/, '');
}

/** 调用目标：文件（位置转成 1-based，与编辑器一致）、文件数或查询词。 */
export function summarize_call(tool_name: string, args: ToolArgs, cwd: string): string {
	if (tool_name === 'lsp_diagnostics_many') {
		const count = args.files?.length ?? 0;
		return `${count} file${count === 1 ? '' : 's'}`;
	}
	let target = args.file ? short_path(args.file, cwd) : '';
	if (typeof args.line === 'number' && typeof args.character === 'number') {
		target += `:${args.line + 1}:${args.character + 1}`;
	}
	if (tool_name === 'lsp_find_symbol' && args.query) {
		return `"${args.query}" in ${target}`;
	}
	return target;
}

export function short_path(file: string, cwd: string): string {
	const rel = isAbsolute(file) ? relative(cwd, file) : file;
	const display = rel.startsWith('..') ? file : rel;
	return display.length > MAX_PATH_WIDTH ? `…${display.slice(-(MAX_PATH_WIDTH - 1))}` : display;
}

/** 从工具输出与 details 推导一行摘要；模型看到的内容不受影响。 */
export function summarize_result(tool_name: string, text: string, details: unknown): ResultSummary {
	const info = (details ?? {}) as Record<string, unknown>;
	if (tool_name === 'lsp_diagnostics_many') return summarize_many(info);
	if (info.ok === false) {
		const error = info.error as { message?: string } | undefined;
		return { tone: 'error', text: `✗ ${first_line(error?.message ?? text)}` };
	}
	switch (tool_name) {
		case 'lsp_diagnostics':
			return summarize_diagnostics(text);
		case 'lsp_references':
			return summarize_locations(text, 'reference');
		case 'lsp_definition':
			return summarize_locations(text, 'definition');
		case 'lsp_document_symbols':
			return count_match(text, /: (\d+) top-level symbol/, 'symbol');
		case 'lsp_find_symbol':
			return count_match(text, /: (\d+) symbol match/, 'match', 'matches');
		case 'lsp_hover':
			return summarize_hover(text);
		default:
			return { tone: 'success', text: `✓ ${first_line(text)}` };
	}
}

function summarize_many(info: Record<string, unknown>): ResultSummary {
	const checked = Number(info.checked ?? 0);
	const diagnostics = Number(info.diagnostic_count ?? 0);
	const failed = Number(info.error_count ?? 0);
	const parts = [`${checked} files`, plural(diagnostics, 'diagnostic')];
	if (failed > 0) parts.push(`${failed} failed`);
	const tone: SummaryTone = failed > 0 ? 'error' : diagnostics > 0 ? 'warning' : 'success';
	return { tone, text: `${tone === 'success' ? '✓' : '⚠'} ${parts.join(' · ')}` };
}

function summarize_diagnostics(text: string): ResultSummary {
	const match = /: (\d+) diagnostic\(s\)/.exec(text);
	if (!match) return { tone: 'success', text: '✓ no diagnostics' };
	const errors = (text.match(/^\s+\d+:\d+ error\b/gm) ?? []).length;
	const suffix = errors > 0 ? ` (${plural(errors, 'error')})` : '';
	return { tone: errors > 0 ? 'error' : 'warning', text: `⚠ ${plural(Number(match[1]), 'diagnostic')}${suffix}` };
}

function summarize_locations(text: string, noun: string): ResultSummary {
	if (/^No .* found\.$/.test(text.trim())) return { tone: 'muted', text: `no ${noun}s` };
	const count = text.split('\n').filter((line) => line.trim()).length;
	return { tone: 'success', text: `✓ ${plural(count, noun)}` };
}

function count_match(text: string, pattern: RegExp, noun: string, plural_noun?: string): ResultSummary {
	const match = pattern.exec(text);
	if (!match) return { tone: 'muted', text: `no ${plural_noun ?? `${noun}s`}` };
	return { tone: 'success', text: `✓ ${plural(Number(match[1]), noun, plural_noun)}` };
}

function summarize_hover(text: string): ResultSummary {
	if (!text.trim() || text.trim() === 'No hover info.') return { tone: 'muted', text: 'no hover info' };
	const line = pick_hover_line(text);
	const clipped = line.length > MAX_HOVER_WIDTH ? `${line.slice(0, MAX_HOVER_WIDTH - 1)}…` : line;
	return { tone: 'success', text: `✓ ${clipped}` };
}

/**
 * 优先取代码块中的签名行：rust-analyzer 首个代码块是模块路径（如 waf_rules::validate），
 * 签名在后续代码块，故跳过纯路径行；无代码块时取首个非空行。
 */
function pick_hover_line(text: string): string {
	const code: string[] = [];
	let in_fence = false;
	for (const raw of text.split('\n')) {
		const line = raw.trim();
		if (line.startsWith('```')) {
			in_fence = !in_fence;
			continue;
		}
		if (in_fence && line) code.push(line);
	}
	const signature = code.find((line) => !/^[\w$.:<>]+$/.test(line));
	return signature ?? code[0] ?? first_line(text);
}

function plural(count: number, noun: string, plural_noun = `${noun}s`): string {
	return `${count} ${count === 1 ? noun : plural_noun}`;
}

function first_line(text: string): string {
	return text.split('\n').find((line) => line.trim())?.trim() ?? '';
}
