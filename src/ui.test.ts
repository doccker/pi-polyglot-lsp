import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import {
	format_diagnostics,
	format_document_symbols,
	format_locations,
	format_symbol_matches,
	format_tool_error,
} from './format.js';
import { summarize_call, summarize_result } from './render-summary.js';
import type { LspServerManager } from './server-manager.js';
import { decorate_tool, DONE_LINGER_MS, LspStatus, with_lsp_ui } from './ui.js';

const loc = (line: number) => ({
	uri: 'file:///repo/a.go',
	range: { start: { line, character: 0 }, end: { line, character: 1 } },
});
const diag = (severity: number) => ({
	range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
	severity,
	message: 'boom',
});
const symbol = { name: 'NewProber', kind: 12, range: loc(0).range, selectionRange: loc(0).range };

describe('summarize_call', () => {
	it('shows 1-based positions relative to cwd', () => {
		expect(summarize_call('lsp_references', { file: '/repo/internal/a.go', line: 37, character: 5 }, '/repo')).toBe(
			'internal/a.go:38:6',
		);
		expect(summarize_call('lsp_diagnostics_many', { files: ['a', 'b'] }, '/repo')).toBe('2 files');
		expect(summarize_call('lsp_find_symbol', { file: 'a.go', query: 'New' }, '/repo')).toBe('"New" in a.go');
	});

	it('truncates long paths from the left', () => {
		const long = `${'deep/'.repeat(20)}file.go`;
		const shown = summarize_call('lsp_diagnostics', { file: long }, '/repo');
		expect(shown.startsWith('…')).toBe(true);
		expect(shown.endsWith('file.go')).toBe(true);
		expect(shown.length).toBeLessThanOrEqual(60);
	});
});

describe('summarize_result', () => {
	it('summarizes diagnostics with error counts', () => {
		expect(summarize_result('lsp_diagnostics', format_diagnostics('/a.go', []), { ok: true }).text).toBe(
			'✓ no diagnostics',
		);
		const mixed = format_diagnostics('/a.go', [diag(1), diag(1), diag(2)] as never);
		expect(summarize_result('lsp_diagnostics', mixed, { ok: true })).toEqual({
			tone: 'error',
			text: '⚠ 3 diagnostics (2 errors)',
		});
	});

	it('counts locations and symbols', () => {
		const refs = format_locations([loc(1), loc(2)] as never, 'No references found.');
		expect(summarize_result('lsp_references', refs, { ok: true }).text).toBe('✓ 2 references');
		expect(summarize_result('lsp_definition', 'No definition found.', { ok: true }).text).toBe('no definitions');
		const symbols = format_document_symbols('/a.go', [symbol] as never);
		expect(summarize_result('lsp_document_symbols', symbols, { ok: true }).text).toBe('✓ 1 symbol');
		const matches = format_symbol_matches('/a.go', 'New', [{ symbol, depth: 0 }] as never);
		expect(summarize_result('lsp_find_symbol', matches, { ok: true }).text).toBe('✓ 1 match');
	});

	it('shows the first meaningful hover line', () => {
		const hover = '```go\nfunc NewProber(store Store) *Prober\n```';
		expect(summarize_result('lsp_hover', hover, { ok: true }).text).toBe('✓ func NewProber(store Store) *Prober');
		expect(summarize_result('lsp_hover', 'No hover info.', { ok: true }).text).toBe('no hover info');
		const rust = '```rust\nwaf_rules::validate\n```\n\n```rust\npub fn validate_spec(spec: &Spec) -> Result<(), RuleError>\n```\n\nDocs';
		expect(summarize_result('lsp_hover', rust, { ok: true }).text).toBe(
			'✓ pub fn validate_spec(spec: &Spec) -> Result<(), RuleError>',
		);
		expect(summarize_result('lsp_hover', 'plain docs line\nmore', { ok: true }).text).toBe('✓ plain docs line');
	});

	it('surfaces tool errors and batch failures', () => {
		const error = { kind: 'server_start_failed' as const, file: '/a.rs', message: 'command "rust-analyzer" not found' };
		const summary = summarize_result('lsp_diagnostics', format_tool_error(error), { ok: false, error });
		expect(summary).toEqual({ tone: 'error', text: '✗ command "rust-analyzer" not found' });
		const many = summarize_result('lsp_diagnostics_many', '', { checked: 3, diagnostic_count: 0, error_count: 1 });
		expect(many).toEqual({ tone: 'error', text: '⚠ 3 files · 0 diagnostics · 1 failed' });
	});
});

describe('LspStatus and decorate_tool', () => {
	function fake_manager(running: string[] = []): LspServerManager {
		return { clients_by_server: new Map(running.map((key) => [key, {}])) } as unknown as LspServerManager;
	}
	function fake_ctx() {
		const set_status = vi.fn();
		const ctx = {
			hasUI: true,
			ui: { setStatus: set_status, theme: { fg: (_c: string, t: string) => t } },
		} as unknown as ExtensionContext;
		return { ctx, set_status };
	}

	it('shows starting for cold servers and clears after completion', async () => {
		const status = new LspStatus(fake_manager());
		const { ctx, set_status } = fake_ctx();
		let during: unknown;
		const tool = decorate_tool(
			{
				name: 'lsp_references',
				execute: async () => {
					during = set_status.mock.calls.at(-1);
					return { content: [{ type: 'text', text: 'x' }], details: {} };
				},
			} as never,
			status,
		);
		vi.useFakeTimers();
		try {
			await tool.execute('1', { file: 'a.go' }, undefined, undefined, ctx);
			expect(during).toEqual(['lsp', '◌ LSP starting gopls…']);
			expect(set_status.mock.calls.at(-1)).toEqual(['lsp', '✓ LSP gopls · references']);
			vi.advanceTimersByTime(DONE_LINGER_MS);
			expect(set_status.mock.calls.at(-1)).toEqual(['lsp', undefined]);
		} finally {
			vi.useRealTimers();
		}
	});

	it('replaces the lingering done cue when a new call starts', () => {
		const status = new LspStatus(fake_manager(['go\u0000/repo']));
		const { ctx, set_status } = fake_ctx();
		vi.useFakeTimers();
		try {
			status.begin('1', 'lsp_hover', { file: 'a.go' }, ctx);
			status.end('1', ctx);
			status.begin('2', 'lsp_definition', { file: 'a.go' }, ctx);
			vi.advanceTimersByTime(DONE_LINGER_MS);
			expect(set_status.mock.calls.at(-1)).toEqual(['lsp', '● LSP gopls · definition']);
		} finally {
			vi.useRealTimers();
		}
	});

	it('shows server and action when already running, with concurrency count', () => {
		const status = new LspStatus(fake_manager(['go\u0000/repo']));
		const { ctx } = fake_ctx();
		status.begin('1', 'lsp_references', { file: 'a.go' }, ctx);
		status.begin('2', 'lsp_hover', { file: 'b.go' }, ctx);
		expect(status.text()).toEqual({ tone: 'accent', text: '● LSP gopls · hover (+1)' });
		status.end('2', ctx);
		expect(status.text()).toEqual({ tone: 'accent', text: '● LSP gopls · references' });
		status.end('1', ctx);
		expect(status.text()).toEqual({ tone: 'muted', text: '✓ LSP gopls · references' });
	});

	it('skips status updates without a UI', () => {
		const status = new LspStatus(fake_manager());
		const set_status = vi.fn();
		status.begin('1', 'lsp_diagnostics', { file: 'a.go' }, { hasUI: false, ui: { setStatus: set_status } } as never);
		expect(set_status).not.toHaveBeenCalled();
	});

	it('only decorates registerTool and forwards other API calls', () => {
		const register = vi.fn();
		const on = vi.fn();
		const api = with_lsp_ui({ registerTool: register, on } as unknown as ExtensionAPI, fake_manager());
		api.on('session_shutdown', vi.fn());
		api.registerTool({ name: 'lsp_hover', execute: vi.fn() } as never);
		expect(on).toHaveBeenCalledOnce();
		expect(register.mock.calls[0][0]).toHaveProperty('renderCall');
		expect(register.mock.calls[0][0]).toHaveProperty('renderResult');
	});
});
