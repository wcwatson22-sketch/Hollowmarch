// Assemble the shippable web root for Capacitor.
//
// There is no bundler here on purpose: the game is plain ES modules with no build step,
// which is why `npm start` is a 30-line static server. Capacitor still needs a single
// directory to copy into the native project, so this is that directory -- a clean copy
// of exactly what ships, and nothing else. Tools, the dev server and the README stay out
// of the app bundle.
//
//   node tools/build-www.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'www');

/** Everything the game needs at runtime, and nothing it does not. */
const INCLUDE = ['index.html', 'css', 'js', 'assets'];

function copy(from, to) {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from)) copy(path.join(from, entry), path.join(to, entry));
    return 0;
  }
  fs.copyFileSync(from, to);
  return 1;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let files = 0;
for (const name of INCLUDE) {
  const src = path.join(ROOT, name);
  if (!fs.existsSync(src)) continue;
  const before = files;
  copy(src, path.join(OUT, name));
  // Count leaves for the report rather than threading a counter through the recursion.
  const count = (p) => (fs.statSync(p).isDirectory()
    ? fs.readdirSync(p).reduce((n, e) => n + count(path.join(p, e)), 0)
    : 1);
  files = before + count(src);
}

// A missing index.html produces a white screen in the simulator with no error anywhere,
// which is a miserable thing to debug on a build machine. Fail loudly here instead.
if (!fs.existsSync(path.join(OUT, 'index.html'))) {
  throw new Error('www/index.html is missing -- the app would launch to a blank screen');
}

console.log(`www/ built: ${files} files`);
