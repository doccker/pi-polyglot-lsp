import {
	default_config_path,
	load_config,
	PolyglotConfigError,
	type LanguageOverride,
	type PolyglotLspConfig,
} from './config.js';

export interface LspServerConfig {
	language: string;
	command: string;
	args: string[];
	backend?: string;
	install_hint?: string;
	is_project_local?: boolean;
	/** 透传给 LSP initialize 请求的 initializationOptions */
	initialization_options?: unknown;
}

interface LanguageDefinition {
	server: LspServerConfig;
	extensions: string[];
	language_ids?: Record<string, string>;
}

const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue'];

function define(
	language: string,
	command: string,
	args: string[],
	extensions: string[],
	install_hint: string,
	extra: Partial<LanguageDefinition> & { backend?: string } = {},
): LanguageDefinition {
	const { backend, ...rest } = extra;
	return {
		server: { language, command, args, install_hint, ...(backend ? { backend } : {}) },
		extensions,
		...rest,
	};
}

export const DEFAULT_LANGUAGES: Record<string, LanguageDefinition> = {
	typescript: define(
		'typescript',
		'typescript-language-server',
		['--stdio'],
		TS_EXTENSIONS,
		'Install TypeScript LSP with: pnpm add -D typescript typescript-language-server',
		{ backend: 'typescript-language-server', language_ids: { '.vue': 'vue' } },
	),
	python: define('python', 'pylsp', [], ['.py'], 'Install Python LSP with: pip install python-lsp-server'),
	rust: define(
		'rust',
		'rust-analyzer',
		[],
		['.rs'],
		'Install Rust Analyzer with: rustup component add rust-analyzer',
	),
	go: define('go', 'gopls', ['serve'], ['.go'], 'Install Go LSP with: go install golang.org/x/tools/gopls@latest'),
	ruby: define('ruby', 'solargraph', ['stdio'], ['.rb'], 'Install Ruby LSP with: gem install solargraph'),
	java: define(
		'java',
		'jdtls',
		[],
		['.java'],
		'Install Eclipse JDT Language Server (e.g. brew install jdtls) and ensure jdtls is on PATH.',
	),
	lua: define(
		'lua',
		'lua-language-server',
		[],
		['.lua'],
		'Install Lua LSP and ensure the lua-language-server binary is on PATH.',
	),
	svelte: define(
		'svelte',
		'svelteserver',
		['--stdio'],
		['.svelte'],
		'Install Svelte LSP with: pnpm add -D svelte-language-server (or volta install svelte-language-server)',
	),
};

export interface Registry {
	servers: Record<string, LspServerConfig>;
	extension_languages: Record<string, string>;
	language_ids: Record<string, string>;
	overrides: Record<string, LanguageOverride>;
}

/** 合并内置语言表与用户配置；config 参数用于测试注入。 */
export function get_registry(config: PolyglotLspConfig = load_config()): Registry {
	const registry: Registry = {
		servers: {},
		extension_languages: {},
		language_ids: {},
		overrides: config.languages,
	};
	const names = new Set([...Object.keys(DEFAULT_LANGUAGES), ...Object.keys(config.languages)]);
	for (const language of names) {
		const definition = merge_language(language, DEFAULT_LANGUAGES[language], config.languages[language]);
		if (!definition) continue;
		registry.servers[language] = definition.server;
		for (const ext of definition.extensions) {
			registry.extension_languages[ext.toLowerCase()] = language;
		}
		for (const [ext, id] of Object.entries(definition.language_ids ?? {})) {
			registry.language_ids[ext.toLowerCase()] = id;
		}
	}
	return registry;
}

function merge_language(
	language: string,
	base: LanguageDefinition | undefined,
	override: LanguageOverride | undefined,
): LanguageDefinition | undefined {
	if (override?.enabled === false) return undefined;
	if (!override) return base;
	if (!base && (!override.command || !override.extensions?.length)) {
		throw new PolyglotConfigError(
			default_config_path(),
			`languages.${language} is not built in, so "command" and "extensions" are required`,
		);
	}
	const server: LspServerConfig = {
		...(base?.server ?? { language, command: '', args: [] }),
		...(override.command ? { command: override.command } : {}),
		...(override.args ? { args: override.args } : {}),
		...(override.installHint ? { install_hint: override.installHint } : {}),
	};
	return {
		server,
		extensions: override.extensions ?? base?.extensions ?? [],
		language_ids: { ...base?.language_ids, ...override.languageIds },
	};
}
