import { describe, expect, it } from 'vitest';
import {
	create_mock_client,
	create_test_lsp_extension,
} from '../test/support.js';
import { should_inject_lsp_prompt } from './index.js';

describe('lsp prompt guidance', () => {
	it('injects LSP workflow guidance when LSP tools are active', async () => {
		const { events } = await create_test_lsp_extension({
			create_client: () => create_mock_client(),
			read_file: async () => 'export const value = 1;\n',
			cwd: () => '/repo',
		});

		const sections: Record<string, string> = {};
		const result = await events.get('before_agent_start')({
			systemPrompt: 'base prompt',
			systemPromptOptions: {
				selectedTools: ['lsp_diagnostics'],
				sections,
			},
		});

		expect(result).toEqual({});
		expect(result).not.toHaveProperty('systemPrompt');
		expect(sections.lsp).toContain(
			'Language server support via LSP tools',
		);
		expect(sections.lsp).toContain(
			'check changed files with LSP diagnostics before reporting completion or committing',
		);
		expect(sections.lsp).toContain(
			'Prefer LSP diagnostics over guessing from build output',
		);
		expect(sections.lsp).toBe(sections.lsp.trim());
	});

	it('does not touch sections when no LSP tool is selected', async () => {
		const { events } = await create_test_lsp_extension({
			create_client: () => create_mock_client(),
			read_file: async () => '',
			cwd: () => '/repo',
		});
		const sections: Record<string, string> = {};
		const result = await events.get('before_agent_start')({
			systemPrompt: 'base prompt',
			systemPromptOptions: { selectedTools: ['bash'], sections },
		});

		expect(result).toEqual({});
		expect(sections).toEqual({});
	});

	it('only injects LSP workflow guidance when relevant tools are available', () => {
		expect(
			should_inject_lsp_prompt({
				systemPromptOptions: undefined,
			}),
		).toBe(true);
		expect(
			should_inject_lsp_prompt({
				systemPromptOptions: { selectedTools: ['lsp_hover'] },
			}),
		).toBe(true);
		expect(
			should_inject_lsp_prompt({
				systemPromptOptions: {
					selectedTools: ['bash', 'read'],
				},
			}),
		).toBe(false);
	});
});
