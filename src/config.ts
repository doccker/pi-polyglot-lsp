import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';

/** 用户级配置文件名，位于 pi agent 目录（默认 ~/.pi/agent/）。 */
export const CONFIG_FILENAME = 'polyglot-lsp.json';

/** auto：按项目自动探测；off：关闭；其它字符串视为绝对路径。 */
export type AutoSetting = 'auto' | 'off' | (string & {});

export interface LanguageOverride {
	enabled?: boolean;
	command?: string;
	args?: string[];
	extensions?: string[];
	/** 扩展名 → LSP languageId，例如 { ".vue": "vue" } */
	languageIds?: Record<string, string>;
	installHint?: string;
	/** 仅 java：Lombok javaagent jar */
	lombok?: AutoSetting;
	/** 仅 typescript：@vue/typescript-plugin 目录 */
	vuePlugin?: AutoSetting;
}

export interface PolyglotLspConfig {
	languages: Record<string, LanguageOverride>;
}

export class PolyglotConfigError extends Error {
	constructor(path: string, reason: string) {
		super(`Invalid ${CONFIG_FILENAME} at ${path}: ${reason}`);
		this.name = 'PolyglotConfigError';
	}
}

const EMPTY: PolyglotLspConfig = { languages: {} };
let cache: { path: string; mtime: number; config: PolyglotLspConfig } | undefined;

export function default_config_path(): string {
	return join(getAgentDir(), CONFIG_FILENAME);
}

/**
 * 读取用户级配置。刻意不读取项目级配置：项目仓库不能借此声明任意可执行命令。
 * 文件不存在返回空配置；格式错误直接抛错，不静默回退默认值。
 */
export function load_config(path: string = default_config_path()): PolyglotLspConfig {
	if (!existsSync(path)) return EMPTY;
	const mtime = statSync(path).mtimeMs;
	if (cache && cache.path === path && cache.mtime === mtime) return cache.config;
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		throw new PolyglotConfigError(path, error instanceof Error ? error.message : String(error));
	}
	const config = parse_config(raw, path);
	cache = { path, mtime, config };
	return config;
}

export function parse_config(raw: unknown, path: string): PolyglotLspConfig {
	if (!is_record(raw)) throw new PolyglotConfigError(path, 'root must be an object');
	const languages = raw.languages ?? {};
	if (!is_record(languages)) throw new PolyglotConfigError(path, '"languages" must be an object');
	const result: Record<string, LanguageOverride> = {};
	for (const [name, value] of Object.entries(languages)) {
		result[name] = parse_override(value, `languages.${name}`, path);
	}
	return { languages: result };
}

function parse_override(value: unknown, at: string, path: string): LanguageOverride {
	const fail = (reason: string): never => {
		throw new PolyglotConfigError(path, `${at}${reason}`);
	};
	if (!is_record(value)) fail(' must be an object');
	const v = value as Record<string, unknown>;
	const out: LanguageOverride = {};
	if (v.enabled !== undefined) {
		if (typeof v.enabled !== 'boolean') fail('.enabled must be a boolean');
		out.enabled = v.enabled as boolean;
	}
	for (const key of ['command', 'installHint', 'lombok', 'vuePlugin'] as const) {
		if (v[key] === undefined) continue;
		if (typeof v[key] !== 'string' || v[key] === '') fail(`.${key} must be a non-empty string`);
		out[key] = v[key] as string;
	}
	for (const key of ['args', 'extensions'] as const) {
		if (v[key] === undefined) continue;
		if (!is_string_array(v[key])) fail(`.${key} must be a string array`);
		out[key] = v[key] as string[];
	}
	if (out.extensions?.some((ext) => !ext.startsWith('.'))) {
		fail('.extensions entries must start with "."');
	}
	if (v.languageIds !== undefined) {
		const ids = v.languageIds;
		if (!is_record(ids) || !Object.values(ids).every((id) => typeof id === 'string')) {
			fail('.languageIds must map extensions to strings');
		}
		out.languageIds = ids as Record<string, string>;
	}
	return out;
}

function is_record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function is_string_array(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
