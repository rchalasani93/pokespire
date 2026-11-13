// Builds the deployable site into dist/: one bundled, minified and obfuscated script, no source files,
// no source maps, and a strict Content Security Policy.
// Usage: node scripts/build-site.mjs   (npm run build)
import { build } from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const OUT = 'dist';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Everything except the readable source modules
cpSync('public', OUT, { recursive: true, filter: src => !/^public[\\/](js([\\/]|$)|config\.example\.js$)/.test(src) });

// Bundle: the Supabase client comes from npm instead of the CDN, so no outside script is loaded
const supabaseCdn = {
  name: 'supabase-from-npm',
  setup(b) {
    b.onResolve({ filter: /^https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/ }, () => ({ path: 'supabase-js', namespace: 'npm-alias' }));
    // Tests can point this at a local stand-in for Supabase
    const target = process.env.SUPABASE_STUB || '@supabase/supabase-js';
    b.onLoad({ filter: /.*/, namespace: 'npm-alias' }, () => ({ contents: `export * from ${JSON.stringify(target)};`, resolveDir: process.cwd() }));
  },
};
const result = await build({
  entryPoints: ['public/js/main.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2022',
  write: false,
  sourcemap: false,
  legalComments: 'none',
  plugins: [supabaseCdn],
});
const bundled = result.outputFiles[0].text;

// Obfuscate the game code so it's hard to read or change in the browser
const obfuscated = JavaScriptObfuscator.obfuscate(bundled, {
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  splitStrings: true,
  splitStringsChunkLength: 12,
  selfDefending: true,
  debugProtection: true,
  disableConsoleOutput: true,
  controlFlowFlattening: false, // keeps the game fast
  deadCodeInjection: false,
  numbersToExpressions: true,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  sourceMap: false,
}).getObfuscatedCode();
mkdirSync(`${OUT}/js`, { recursive: true });
writeFileSync(`${OUT}/js/app.js`, obfuscated);

// index.html: load the bundle and lock down what the page may load or run
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://raw.githubusercontent.com https://play.pokemonshowdown.com",
  "media-src 'self' https://raw.githubusercontent.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
let html = readFileSync('public/index.html', 'utf8');
html = html
  .replace('<script type="module" src="js/main.js"></script>', '<script src="js/app.js" defer></script>')
  .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${csp}">\n  <meta name="referrer" content="strict-origin-when-cross-origin">`);
if (!html.includes('js/app.js')) throw new Error('index.html script tag not found');
writeFileSync(`${OUT}/index.html`, html);
if (!existsSync(`${OUT}/data/pokedex.json`)) throw new Error('data files missing');
console.log(`Built ${OUT}/ (app.js ${(obfuscated.length / 1024).toFixed(0)} KB)`);
