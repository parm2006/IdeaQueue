import { readFile, writeFile, readdir, mkdir, cp } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { build } from 'esbuild';

// Embed the existing React assets in the Worker ESM artifact. No asset binding needed.
const root = resolve('dist');
const assets = {};
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = resolve(directory, entry.name);
    if (entry.isDirectory()) await collect(filename);
    else {
      const key = '/' + relative(root, filename).replaceAll('\\', '/');
      let content = await readFile(filename);
      if (key === '/index.html') content = Buffer.from(content.toString().replace('<head>', '<head><script>window.__IDEAQUEUE_HOSTED__=true</script>'));
      assets[key] = { body: content.toString('base64'), type: types[extname(filename)] ?? 'application/octet-stream' };
    }
  }
}
await collect(root);
await writeFile('worker/assets.generated.json', JSON.stringify(assets));
await mkdir('dist/server', { recursive: true });
await build({ entryPoints: ['worker/index.ts'], outfile: 'dist/server/index.js', bundle: true, format: 'esm', target: 'es2022', platform: 'browser', minify: true });
await mkdir('dist/.openai', { recursive: true });
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await cp('drizzle', 'dist/.openai/drizzle', { recursive: true });
const source = await readFile('dist/server/index.js', 'utf8');
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
if (typeof worker?.fetch !== 'function') throw new Error('Worker must export default.fetch');
console.log('Worker artifact validated; private database migrations included.');
