import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { load_config, parse_config, PolyglotConfigError } from './config.js';
import { compare_versions, find_lombok_jar, lombok_args } from './java-lombok.js';
import { get_registry } from './registry.js';
import { get_server_config } from './servers.js';
import {
	is_vue_project,
	resolve_vue_plugin,
	vue_initialization_options,
	vue_support_error,
} from './vue-plugin.js';

const dirs: string[] = [];
function tmp(): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), 'polyglot-')));
	dirs.push(dir);
	return dir;
}
function write(path: string, content = ''): string {
	mkdirSync(join(path, '..'), { recursive: true });
	writeFileSync(path, content);
	return path;
}
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('config', () => {
	it('returns empty config when file is missing', () => {
		expect(load_config(join(tmp(), 'none.json'))).toEqual({ languages: {} });
	});

	it('rejects invalid JSON and wrong field types loudly', () => {
		const path = write(join(tmp(), 'bad.json'), '{oops');
		expect(() => load_config(path)).toThrow(PolyglotConfigError);
		expect(() => parse_config({ languages: { go: { args: 'serve' } } }, 'x')).toThrow(/args must be a string array/);
		expect(() => parse_config({ languages: { kt: { extensions: ['kt'] } } }, 'x')).toThrow(/must start with/);
	});
});

describe('registry', () => {
	it('maps .vue to the typescript server with vue languageId', () => {
		const registry = get_registry({ languages: {} });
		expect(registry.extension_languages['.vue']).toBe('typescript');
		expect(registry.language_ids['.vue']).toBe('vue');
	});

	it('supports overriding, disabling and adding languages', () => {
		const registry = get_registry({
			languages: {
				go: { args: ['serve', '-rpc.trace'] },
				ruby: { enabled: false },
				kotlin: { command: 'kotlin-language-server', extensions: ['.kt'] },
			},
		});
		expect(registry.servers.go.args).toEqual(['serve', '-rpc.trace']);
		expect(registry.servers.ruby).toBeUndefined();
		expect(registry.extension_languages['.rb']).toBeUndefined();
		expect(registry.extension_languages['.kt']).toBe('kotlin');
	});

	it('requires command and extensions for new languages', () => {
		expect(() => get_registry({ languages: { kotlin: { command: 'kls' } } })).toThrow(/required/);
	});
});

describe('java lombok', () => {
	function maven_home(versions: string[]): string {
		const home = tmp();
		for (const v of versions) {
			write(join(home, '.m2/repository/org/projectlombok/lombok', v, `lombok-${v}.jar`));
		}
		return home;
	}

	it('picks the highest version jar', () => {
		const home = maven_home(['1.18.30', '1.18.44', '1.18.9']);
		expect(find_lombok_jar(home)).toContain('lombok-1.18.44.jar');
		expect(compare_versions('1.18.44', '1.18.9')).toBeGreaterThan(0);
	});

	it('injects javaagent only when the project declares lombok', () => {
		const home = maven_home(['1.18.44']);
		const plain = tmp();
		write(join(plain, 'pom.xml'), '<project></project>');
		expect(lombok_args('jdtls', plain, { home_dir: home })).toEqual([]);

		const parent = tmp();
		mkdirSync(join(parent, '.git'));
		write(join(parent, 'pom.xml'), '<artifactId>lombok</artifactId>');
		const module_dir = join(parent, 'service');
		write(join(module_dir, 'pom.xml'), '<project></project>');
		expect(lombok_args('jdtls', module_dir, { home_dir: home })[0]).toMatch(/^--jvm-arg=-javaagent:.*lombok-1\.18\.44\.jar$/);
		expect(lombok_args('/opt/custom-java-ls', module_dir, { home_dir: home })).toEqual([]);
		expect(lombok_args('jdtls', module_dir, { home_dir: home, setting: 'off' })).toEqual([]);
	});

	it('flows into get_server_config for java', () => {
		const home = maven_home(['1.18.44']);
		const project = tmp();
		write(join(project, 'build.gradle'), "compileOnly 'org.projectlombok:lombok'");
		const config = get_server_config('java', project, { config: { languages: {} }, home_dir: home });
		expect(config?.args.some((arg) => arg.includes('lombok-1.18.44.jar'))).toBe(true);
	});

	it('fails loudly when an explicit jar path is missing', () => {
		expect(() => lombok_args('jdtls', tmp(), { setting: '/nope/lombok.jar' })).toThrow(PolyglotConfigError);
	});
});

describe('vue plugin', () => {
	function vue_project(): string {
		const root = tmp();
		mkdirSync(join(root, '.git'));
		write(join(root, 'package.json'), JSON.stringify({ dependencies: { vue: '^3.5.0' } }));
		return root;
	}

	it('detects vue projects from package.json', () => {
		expect(is_vue_project(vue_project())).toBe(true);
		const other = tmp();
		mkdirSync(join(other, '.git'));
		write(join(other, 'package.json'), JSON.stringify({ dependencies: { react: '19' } }));
		expect(is_vue_project(other)).toBe(false);
	});

	it('prefers project-local plugin', () => {
		const root = vue_project();
		const local = join(root, 'node_modules/@vue/typescript-plugin');
		write(join(local, 'package.json'), '{}');
		expect(resolve_vue_plugin(root, { path_env: '' })).toBe(local);
		expect(vue_initialization_options(root, 'typescript-language-server', { path_env: '' })).toEqual({
			plugins: [{ name: '@vue/typescript-plugin', location: local, languages: ['vue'] }],
		});
		expect(vue_initialization_options(root, 'typescript-native', { path_env: '' })).toBeUndefined();
	});

	it('finds the plugin bundled with a global vue-language-server', () => {
		const global = tmp();
		const pkg = join(global, 'lib/node_modules/@vue/language-server');
		write(join(pkg, 'package.json'), JSON.stringify({ name: '@vue/language-server' }));
		write(join(pkg, 'bin/vue-language-server.js'));
		const plugin = join(pkg, 'node_modules/@vue/typescript-plugin');
		write(join(plugin, 'package.json'), '{}');
		mkdirSync(join(global, 'bin'));
		symlinkSync(join(pkg, 'bin/vue-language-server.js'), join(global, 'bin/vue-language-server'));
		expect(resolve_vue_plugin(vue_project(), { path_env: join(global, 'bin') })).toBe(plugin);
	});

	it('skips non-vue projects and respects off', () => {
		const root = tmp();
		mkdirSync(join(root, '.git'));
		expect(vue_initialization_options(root, undefined, { path_env: '' })).toBeUndefined();
		expect(vue_initialization_options(vue_project(), undefined, { setting: 'off' })).toBeUndefined();
	});

	it('reports a clear error for .vue files when the plugin is missing', () => {
		const root = vue_project();
		const saved = process.env.PATH;
		process.env.PATH = '';
		try {
			expect(vue_support_error(join(root, 'src/App.vue'), root)).toMatch(/@vue\/typescript-plugin not found/);
			expect(vue_support_error(join(root, 'src/main.ts'), root)).toBeUndefined();
		} finally {
			process.env.PATH = saved;
		}
	});
});
