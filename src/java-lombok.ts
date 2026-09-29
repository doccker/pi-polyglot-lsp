import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { default_config_path, PolyglotConfigError, type AutoSetting } from './config.js';

const BUILD_FILES = ['pom.xml', 'build.gradle', 'build.gradle.kts'];

export interface LombokOptions {
	setting?: AutoSetting;
	home_dir?: string;
}

/**
 * 返回需要追加给 jdtls 的参数。
 * auto 模式只在 workspace（或其上层多模块父工程）的构建文件声明了 lombok 时生效，
 * 且仅对 jdtls 启动脚本注入（它支持 --jvm-arg）；自定义命令请自行在 args 中配置。
 */
export function lombok_args(
	command: string,
	workspace_root: string,
	options: LombokOptions = {},
): string[] {
	const setting = options.setting ?? 'auto';
	if (setting === 'off') return [];
	if (setting !== 'auto') {
		if (!existsSync(setting)) {
			throw new PolyglotConfigError(default_config_path(), `languages.java.lombok not found: ${setting}`);
		}
		return [javaagent_arg(setting)];
	}
	if (basename(command) !== 'jdtls') return [];
	if (!project_uses_lombok(workspace_root)) return [];
	const jar = find_lombok_jar(options.home_dir ?? homedir());
	return jar ? [javaagent_arg(jar)] : [];
}

function javaagent_arg(jar: string): string {
	return `--jvm-arg=-javaagent:${jar}`;
}

export function project_uses_lombok(workspace_root: string): boolean {
	let current = resolve(workspace_root);
	while (true) {
		for (const file of BUILD_FILES) {
			const path = join(current, file);
			if (existsSync(path) && /lombok/i.test(readFileSync(path, 'utf8'))) return true;
		}
		if (existsSync(join(current, '.git'))) return false;
		const parent = dirname(current);
		if (parent === current) return false;
		current = parent;
	}
}

/** 在 Maven 本地仓库与 Gradle 缓存中查找最高版本的 lombok jar。 */
export function find_lombok_jar(home_dir: string): string | undefined {
	const candidates: Array<{ version: string; path: string }> = [];
	const maven_root = join(home_dir, '.m2', 'repository', 'org', 'projectlombok', 'lombok');
	for (const version of list_versions(maven_root)) {
		const jar = join(maven_root, version, `lombok-${version}.jar`);
		if (existsSync(jar)) candidates.push({ version, path: jar });
	}
	const gradle_root = join(home_dir, '.gradle', 'caches', 'modules-2', 'files-2.1', 'org.projectlombok', 'lombok');
	for (const version of list_versions(gradle_root)) {
		for (const hash of safe_readdir(join(gradle_root, version))) {
			const jar = join(gradle_root, version, hash, `lombok-${version}.jar`);
			if (existsSync(jar)) candidates.push({ version, path: jar });
		}
	}
	candidates.sort((a, b) => compare_versions(b.version, a.version));
	return candidates[0]?.path;
}

function list_versions(dir: string): string[] {
	return safe_readdir(dir).filter((name) => /^\d+(\.\d+)*$/.test(name));
}

function safe_readdir(dir: string): string[] {
	return existsSync(dir) ? readdirSync(dir) : [];
}

export function compare_versions(a: string, b: string): number {
	const pa = a.split('.').map(Number);
	const pb = b.split('.').map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}
