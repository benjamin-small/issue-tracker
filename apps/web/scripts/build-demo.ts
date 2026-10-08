// `pnpm build:demo`: builds the self-contained browser demo into apps/web/build-demo/ (see src/demo/).
// The web app, the API server and SQLite (sql.js) all run in the page, so any static host can serve it.
import { spawnSync } from 'node:child_process';
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const routes = `${root}src/.demo-routes`;

// Hash routing rejects page options, so build from a copy of the routes without the root +layout.ts
// (its `ssr = false` is implied by hash routing anyway).
rmSync(routes, { recursive: true, force: true });
cpSync(`${root}src/routes`, routes, { recursive: true });
rmSync(`${routes}/+layout.ts`);

const result = spawnSync('pnpm', ['exec', 'vite', 'build'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, POIETIC_ISSUES_DEMO: '1' },
});
rmSync(routes, { recursive: true, force: true });
if (result.status !== 0) process.exit(result.status ?? 1);

// The fallback page links assets from the site root; the demo may be served from any path, so make them relative.
const index = `${root}build-demo/index.html`;
writeFileSync(
  index,
  readFileSync(index, 'utf8')
    .replaceAll('"/app/', '"./app/')
    .replaceAll('"/favicon.svg"', '"./favicon.svg"')
    .replace('<title>Issues</title>', '<title>Issues Demo</title>'),
);
// Some hosts reject files containing a literal U+FFFD (it looks like corrupted text); libraries use it inside
// string literals, where the escape sequence means exactly the same.
const immutable = `${root}build-demo/app/immutable`;
for (const name of readdirSync(immutable).filter((f) => f.endsWith('.js'))) {
  const file = `${immutable}/${name}`;
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll('\uFFFD', '\\uFFFD'));
}
console.log('Demo written to apps/web/build-demo/ (open index.html from any static host).');
