import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse_config } from './config.js';

// 与 `parse_override` 同步维护
const OVERRIDE_KEYS = [
	'enabled',
	'command',
	'installHint',
	'lombok',
	'vuePlugin',
	'args',
	'extensions',
	'languageIds',
];
const TOP_LEVEL_KEYS = ['autoDiagnostics'];

const README_PATH = fileURLToPath(new URL('../README.md', import.meta.url));

function config_section(): string {
	const readme = readFileSync(README_PATH, 'utf8');
	const start = readme.search(/^## 配置\s*$/m);
	if (start < 0) throw new Error('README.md 中找不到「## 配置」节');
	const rest = readme.slice(start + 1);
	const next = rest.search(/^## /m);
	return next < 0 ? rest : rest.slice(0, next);
}

function example_json(section: string): unknown {
	const match = /```json\n([\s\S]*?)```/.exec(section);
	if (!match) throw new Error('README「## 配置」节中找不到 ```json 代码块');
	return JSON.parse(match[1]!);
}

function table_fields(section: string): string[] {
	const rows = section.split('\n').filter((line) => line.startsWith('|'));
	const header = rows.findIndex((line) => /^\|\s*字段\s*\|/.test(line));
	if (header < 0) throw new Error('README「## 配置」节中找不到首列为「字段」的表格');
	const fields: string[] = [];
	for (const row of rows.slice(header + 2)) {
		const first = row.split('|')[1] ?? '';
		const cleaned = first.replace(/（[^）]*）/g, '');
		for (const m of cleaned.matchAll(/`([^`]+)`/g)) fields.push(m[1]!);
	}
	if (fields.length === 0) throw new Error('README 字段表首列没有任何反引号字段名');
	return fields;
}

describe('README 配置示例', () => {
	it('json 示例可被 parse_config 解析，且语言对象只用受支持的键', () => {
		const raw = example_json(config_section());
		expect(() => parse_config(raw, 'README.md')).not.toThrow();
		const languages = (raw as { languages?: Record<string, object> }).languages;
		expect(languages, '示例缺少 languages 对象').toBeTypeOf('object');
		for (const [name, value] of Object.entries(languages!)) {
			const unknown = Object.keys(value).filter((key) => !OVERRIDE_KEYS.includes(key));
			expect(unknown, `示例 languages.${name} 含 parse_override 不支持的键`).toEqual([]);
		}
	});

	it('字段表与 parse_override 支持的键一致', () => {
		const fields = table_fields(config_section());
		const allowed = [...OVERRIDE_KEYS, ...TOP_LEVEL_KEYS];
		const unknown = fields.filter((field) => !allowed.includes(field));
		expect(unknown, '字段表中存在不受支持的字段').toEqual([]);
		const missing = OVERRIDE_KEYS.filter((key) => !fields.includes(key));
		expect(missing, '字段表缺少受支持的字段').toEqual([]);
	});
});
