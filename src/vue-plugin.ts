import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, dirname, extname, join, resolve } from 'node:path';
import { default_config_path, PolyglotConfigError, type AutoSetting } from './config.js';
import { get_registry } from './registry.js';

const PLUGIN_NAME = '@vue/typescript-plugin';
const SERVER_PACKAGE = '@vue/language-server';

export const VUE_INSTALL_HINT =
	'Vue support needs @vue/typescript-plugin: npm i -g @vue/language-server (or add @vue/typescript-plugin to the project), ' +
	'or set languages.typescript.vuePlugin in polyglot-lsp.json.';

export interface VuePluginOptions {
	setting?: AutoSetting;
	/** 覆盖 PATH，便于测试 */
	path_env?: string;
}

export function is_vue_file(file_path: string): boolean {
	return extname(file_path).toLowerCase() === '.vue';
}

/** .vue 文件在缺少插件时返回错误说明；否则返回 undefined。 */
export function vue_support_error(file_path: string, workspace_root: string): string | undefined {
	if (!is_vue_file(file_path)) return undefined;
	const setting = get_registry().overrides.typescript?.vuePlugin;
	if (setting === 'off') return `Vue support is disabled (languages.typescript.vuePlugin = "off"): ${file_path}`;
	if (resolve_vue_plugin(workspace_root, { setting })) return undefined;
	return `Vue language support unavailable for ${file_path}: @vue/typescript-plugin not found`;
}

/**
 * 为 typescript-language-server 生成加载 Vue 插件的 initializationOptions。
 * 原生 TS 7 LSP（tsc --lsp）不支持 tsserver 插件，此时返回 undefined。
 */
export function vue_initialization_options(
	workspace_root: string,
	backend: string | undefined,
	options: VuePluginOptions = {},
): unknown {
	if (backend === 'typescript-native') return undefined;
	const setting = options.setting ?? 'auto';
	if (setting === 'off') return undefined;
	if (setting === 'auto' && !is_vue_project(workspace_root)) return undefined;
	const location = resolve_vue_plugin(workspace_root, options);
	if (!location) return undefined;
	return {
		plugins: [{ name: PLUGIN_NAME, location, languages: ['vue'] }],
	};
}

export function resolve_vue_plugin(
	workspace_root: string,
	options: VuePluginOptions = {},
): string | undefined {
	const setting = options.setting ?? 'auto';
	if (setting === 'off') return undefined;
	if (setting !== 'auto') {
		if (!existsSync(setting)) {
			throw new PolyglotConfigError(default_config_path(), `languages.typescript.vuePlugin not found: ${setting}`);
		}
		return setting;
	}
	for (const dir of ancestors(workspace_root)) {
		const local = join(dir, 'node_modules', '@vue', 'typescript-plugin');
		if (existsSync(join(local, 'package.json'))) return local;
	}
	return find_global_plugin(options.path_env ?? process.env.PATH ?? '');
}

export function is_vue_project(workspace_root: string): boolean {
	for (const dir of ancestors(workspace_root)) {
		const manifest = join(dir, 'package.json');
		if (existsSync(manifest) && declares_vue(manifest)) return true;
		if (existsSync(join(dir, '.git'))) return false;
	}
	return false;
}

function declares_vue(manifest: string): boolean {
	try {
		const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>;
		return ['dependencies', 'devDependencies', 'peerDependencies'].some((field) => {
			const deps = pkg[field];
			return typeof deps === 'object' && deps !== null && 'vue' in deps;
		});
	} catch {
		return false;
	}
}

/** 通过 PATH 上的 vue-language-server 反查全局安装目录中的插件。 */
function find_global_plugin(path_env: string): string | undefined {
	for (const dir of path_env.split(delimiter).filter(Boolean)) {
		const bin = join(dir, 'vue-language-server');
		if (!existsSync(bin)) continue;
		const package_dir = find_package_dir(realpathSync(bin), SERVER_PACKAGE);
		if (!package_dir) continue;
		const candidates = [
			join(package_dir, 'node_modules', '@vue', 'typescript-plugin'),
			join(dirname(package_dir), 'typescript-plugin'),
		];
		const found = candidates.find((candidate) => existsSync(join(candidate, 'package.json')));
		if (found) return found;
	}
	return undefined;
}

function find_package_dir(start: string, name: string): string | undefined {
	for (const dir of ancestors(dirname(start))) {
		const manifest = join(dir, 'package.json');
		if (!existsSync(manifest)) continue;
		try {
			if ((JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name === name) return dir;
		} catch {
			continue;
		}
	}
	return undefined;
}

function ancestors(start: string): string[] {
	const dirs: string[] = [];
	let current = resolve(start);
	while (true) {
		dirs.push(current);
		const parent = dirname(current);
		if (parent === current) return dirs;
		current = parent;
	}
}
