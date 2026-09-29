import { type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { register_lsp_command } from './commands.js';
import {
	append_lsp_system_prompt,
	should_inject_lsp_prompt,
} from './prompt.js';
import {
	LspServerManager,
	type CreateLspServerManagerOptions,
} from './server-manager.js';
import {
	AUTO_DIAGNOSTICS_PROMPT,
	auto_diagnostics_enabled,
	register_auto_diagnostics,
} from './auto-diagnostics.js';
import { register_lsp_tools } from './tools.js';
import { LspStatus, with_lsp_ui } from './ui.js';

export { should_inject_lsp_prompt } from './prompt.js';
export type { LspClientLike } from './server-manager.js';

export interface CreateLspExtensionOptions extends CreateLspServerManagerOptions {}

export function create_lsp_extension(
	options: CreateLspExtensionOptions = {},
) {
	return async function lsp(pi: ExtensionAPI) {
		const manager = new LspServerManager(options);

		const status = new LspStatus(manager);
		register_lsp_tools(with_lsp_ui(pi, status), manager);
		register_auto_diagnostics(pi, manager, status);

		pi.on('before_agent_start', async (event) => {
			if (!should_inject_lsp_prompt(event)) return {};
			const prompt = append_lsp_system_prompt(event.systemPrompt);
			return {
				systemPrompt: auto_diagnostics_enabled()
					? prompt + AUTO_DIAGNOSTICS_PROMPT
					: prompt,
			};
		});

		register_lsp_command(pi, manager);

		pi.on('session_shutdown', async () => {
			await manager.clear_language_state();
		});
	};
}

export default create_lsp_extension();
