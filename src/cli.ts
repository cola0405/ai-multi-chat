/**
 * 桥接文件：让 src/sites/*.ts 的 `import '../cli.js'` 在源码目录下也能解析
 */
export * from './shared/cli.js';
