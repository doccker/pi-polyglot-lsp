import { type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { register_lsp_command } from './commands.js';
import {
	build_lsp_section,
	LSP_SECTION_NAME,
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
			// 不返回 systemPrompt：forced prompt 会击穿前缀缓存与 preserved thinking
			event.systemPromptOptions.sections[LSP_SECTION_NAME] =
				build_lsp_section(
					auto_diagnostics_enabled() ? AUTO_DIAGNOSTICS_PROMPT : '',
				);
			return {};
		});

		register_lsp_command(pi, manager);

		pi.on('session_shutdown', async () => {
			await manager.clear_language_state();
		});
	};
}

export default create_lsp_extension();
