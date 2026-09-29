import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { format_auto_diagnostics, register_auto_diagnostics } from './auto-diagnostics.js';
import { CONFIG_FILENAME, parse_config } from './config.js';
import type { LspServerManager } from './server-manager.js';
import { LspStatus } from './ui.js';

const diag = (severity: number, line = 0, message = 'boom') => ({
	range: { start: { line, character: 4 }, end: { line, character: 5 } },
	severity,
	message,
});

describe('format_auto_diagnostics', () => {
	it('stays one line when clean and ignores info/hints', () => {
		expect(format_auto_diagnostics([])).toBe('LSP diagnostics (auto): no errors');
		expect(format_auto_diagnostics([diag(3), diag(4)] as never)).toBe('LSP diagnostics (auto): no errors');
	});

	it('lists at most five errors and only counts warnings', () => {
		const many = [...Array.from({ length: 7 }, (_, i) => diag(1, i, `err ${i}`)), diag(2)];
		const lines = format_auto_diagnostics(many as never).split('\n');
		expect(lines[0]).toBe('LSP diagnostics (auto): 7 errors, 1 warning');
		expect(lines[1]).toBe('  1:5 err 0');
		expect(lines).toHaveLength(7);
		expect(lines.at(-1)).toBe('  … 2 more errors');
	});
});

describe('register_auto_diagnostics', () => {
	let root: string;
	let file: string;
	beforeEach(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), 'auto-diag-')));
		writeFileSync(join(root, 'go.mod'), 'module x');
		file = join(root, 'a.go');
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
		rmSync(join(process.env.PI_CODING_AGENT_DIR!, CONFIG_FILENAME), { force: true });
	});

	function setup(running: boolean, diagnostics: unknown[] = []) {
		const wait = vi.fn(async () => diagnostics);
		const manager = {
			cwd: root,
			clients_by_server: new Map(running ? [[`go\u0000${root}`, {}]] : []),
			resolve_abs: (p: string) => p,
			resolve_file_state: vi.fn(async () => ({ ok: true, result: { uri: 'file:///a.go', state: { client: { wait_for_diagnostics: wait } } } })),
			release_file_state: vi.fn(async () => undefined),
		} as unknown as LspServerManager;
		let handler: Function = () => undefined;
		const pi = { on: (_name: string, fn: Function) => (handler = fn) } as unknown as ExtensionAPI;
		const set_status = vi.fn();
		const ctx = { hasUI: true, ui: { setStatus: set_status, theme: { fg: (_c: string, t: string) => t } } } as unknown as ExtensionContext;
		register_auto_diagnostics(pi, manager, new LspStatus(manager));
		const fire = (event: Record<string, unknown>) =>
			handler({ toolName: 'edit', toolCallId: 't1', isError: false, input: { path: file }, content: [{ type: 'text', text: 'ok' }], ...event }, ctx);
		return { manager, wait, fire, set_status };
	}

	it('appends one line after edits when the server is running', async () => {
		const { fire, set_status } = setup(true, [diag(1, 11, 'undefined: foo')]);
		const result = await fire({});
		expect(result.content.at(-1).text).toBe('LSP diagnostics (auto): 1 error\n  12:5 undefined: foo');
		expect(set_status.mock.calls[0]).toEqual(['lsp', '● LSP gopls · diagnostics']);
	});

	it('warms up a cold server without waiting or appending', async () => {
		const { fire, manager, wait } = setup(false);
		expect(await fire({ toolName: 'write' })).toBeUndefined();
		expect(manager.resolve_file_state).toHaveBeenCalledOnce();
		expect(wait).not.toHaveBeenCalled();
	});

	it('ignores other tools, failed edits and unsupported files', async () => {
		const { fire, manager } = setup(true);
		expect(await fire({ toolName: 'bash' })).toBeUndefined();
		expect(await fire({ isError: true })).toBeUndefined();
		expect(await fire({ input: { path: join(root, 'notes.md') } })).toBeUndefined();
		expect(manager.resolve_file_state).not.toHaveBeenCalled();
	});

	it('can be disabled via autoDiagnostics: false', async () => {
		writeFileSync(join(process.env.PI_CODING_AGENT_DIR!, CONFIG_FILENAME), '{"autoDiagnostics": false}');
		const { fire, manager } = setup(true);
		expect(await fire({})).toBeUndefined();
		expect(manager.resolve_file_state).not.toHaveBeenCalled();
	});

	it('validates the autoDiagnostics type', () => {
		expect(() => parse_config({ autoDiagnostics: 'yes' }, 'x')).toThrow(/must be a boolean/);
	});
});
