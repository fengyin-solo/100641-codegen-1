// 测试启动器：用 esbuild 的 Node API 把自测脚本连同业务代码一起打包，再用 node 执行。
// 绕开本机 esbuild 可执行文件格式不对的问题（直接调用其 JS API）。
import { mkdirSync } from 'node:fs'
import { build } from 'esbuild'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = join('node_modules', '.cache')
mkdirSync(outDir, { recursive: true })
const outfile = join(outDir, 'access-test.mjs')

await build({
  entryPoints: ['scripts/access-test.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  absWorkingDir: process.cwd(),
  // esbuild 自身与 Node 内置模块保持外链，运行时从 node_modules 正常 require。
  packages: 'external',
})

await import(pathToFileURL(outfile).href)
