// Writes the OpenAPI document to docs/openapi.json (committed; CI checks it is up to date).
// Usage: node apps/server/src/scripts/gen-openapi.ts [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateOpenApiDocument } from '../app.ts';

const target = fileURLToPath(new URL('../../../../docs/openapi.json', import.meta.url));
const content = `${JSON.stringify(generateOpenApiDocument(), null, 2)}\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    // missing file counts as out of date
  }
  if (current !== content) {
    console.error(
      'docs/openapi.json is out of date. Run `pnpm openapi:gen` and commit the result.',
    );
    process.exit(1);
  }
  console.log('docs/openapi.json is up to date.');
} else {
  writeFileSync(target, content);
  console.log(`Wrote ${target}`);
}
