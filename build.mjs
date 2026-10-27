// Builds two targets:
//  dist/duck-and-cover.html  — single file, three.js from the jsDelivr CDN (artifact + quick hosting)
//  dist/offline/            — self-contained installable web app (three.js bundled, manifest, service worker)
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const THREE_VERSION = '0.170.0';
const minify = !process.argv.includes('--dev');
const root = path.dirname(new URL(import.meta.url).pathname);
const tpl = fs.readFileSync(path.join(root, 'src/template.html'), 'utf8');
fs.mkdirSync(path.join(root, 'dist/offline'), { recursive: true });

async function bundle(external) {
  const r = await esbuild.build({
    entryPoints: [path.join(root, 'src/main.js')],
    bundle: true, format: 'esm', target: ['chrome100', 'safari15', 'firefox100'],
    minify, write: false, external: external ? ['three'] : [], legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  return r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
}

const wrap = (body) => `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

// 1) CDN build: artifact fragment + full hosted page
{
  const js = await bundle(true);
  const importMap = `<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.min.js"}}</script>`;
  // replacer functions: minified code can contain `$&`, which a replacement string would expand
  const html = tpl.replace('<!--__HEAD__-->', () => '').replace('<!--__SCRIPTS__-->', () => `${importMap}\n<script type="module">\n${js}\n</script>`);
  fs.writeFileSync(path.join(root, 'dist/artifact.html'), html);
  fs.writeFileSync(path.join(root, 'dist/duck-and-cover.html'), wrap(html));
  console.log('cdn build', (html.length / 1024).toFixed(0), 'KB');
}

// 2) Offline / installable build
{
  const js = await bundle(false);
  const head = `<link rel="manifest" href="manifest.webmanifest">\n<meta name="theme-color" content="#0f1815">\n<link rel="icon" href="icon-192.png">`;
  const sw = `<script>if ('serviceWorker' in navigator && location.protocol === 'https:') { navigator.serviceWorker.register('sw.js').catch(() => {}); }</script>`;
  const html = tpl.replace('<!--__HEAD__-->', () => head).replace('<!--__SCRIPTS__-->', () => `<script type="module">\n${js}\n</script>\n${sw}`);
  const doc = wrap(html);
  fs.writeFileSync(path.join(root, 'dist/offline/index.html'), doc);
  for (const f of ['manifest.webmanifest', 'sw.js', 'icon-192.png', 'icon-512.png', 'README.md']) fs.copyFileSync(path.join(root, 'static', f), path.join(root, 'dist/offline', f));
  console.log('offline build', (doc.length / 1024).toFixed(0), 'KB');
}
