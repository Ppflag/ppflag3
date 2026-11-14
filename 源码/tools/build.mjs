// tools/build.mjs —— 生成带内容哈希的前端资源
// 用法：node tools/build.mjs
//
// 为什么需要它：页面引用的是 app.<hash>.js / engine.<hash>.js / styles.<hash>.css，
// 这样 CDN 不会缓存旧文件。改动 app.js / engine.js / styles.css 之后必须跑一次，
// 否则浏览器加载的还是旧的哈希文件。

import { readFile, writeFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(dir, '..', 'public');

const hash = (s) => createHash('md5').update(s).digest('hex').slice(0, 8);

const appSrc = await readFile(path.join(pub, 'app.js'), 'utf8');
const engineSrc = await readFile(path.join(pub, 'engine.js'), 'utf8');
const cssSrc = await readFile(path.join(pub, 'styles.css'), 'utf8');

// engine 和 app 用同一个 tag，改动任一都会换名
const jsTag = hash(appSrc + engineSrc);
const cssTag = hash(cssSrc);

const appName = `app.${jsTag}.js`;
const engineName = `engine.${jsTag}.js`;
const cssName = `styles.${cssTag}.css`;

await writeFile(path.join(pub, appName), appSrc.replace("from './engine.js'", `from './${engineName}'`), 'utf8');
await writeFile(path.join(pub, engineName), engineSrc, 'utf8');
await writeFile(path.join(pub, cssName), cssSrc, 'utf8');

// 改写 index.html 的引用
let html = await readFile(path.join(pub, 'index.html'), 'utf8');
html = html.replace(/src="\.\/app[^"]*\.js"/g, `src="./${appName}"`);
html = html.replace(/href="\.\/styles[^"]*\.css"/g, `href="./${cssName}"`);
await writeFile(path.join(pub, 'index.html'), html, 'utf8');

// 清掉上一代哈希文件
const fs = await import('node:fs/promises');
for (const f of await fs.readdir(pub)) {
  const staleJs = /^app\.[0-9a-f]{8}\.js$/.test(f) && f !== appName;
  const staleEngine = /^engine\.[0-9a-f]{8}\.js$/.test(f) && f !== engineName;
  const staleCss = /^styles\.[0-9a-f]{8}\.css$/.test(f) && f !== cssName;
  if (staleJs || staleEngine || staleCss) await unlink(path.join(pub, f));
}

console.log('前端资源已生成：');
console.log('  public/' + appName);
console.log('  public/' + engineName);
console.log('  public/' + cssName);
