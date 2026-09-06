import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOperations, renderOperations, renderSchemas } from './build';
import type { OpenApiDoc } from './openapi.types';

const OUT_DIR = join(__dirname, '..', 'generated');
const DEFAULT_SOURCE = 'http://localhost:3000/openapi.json';

async function main(): Promise<void> {
  const source = process.env.CYB_OPENAPI_URL ?? DEFAULT_SOURCE;
  const res = await fetch(source);
  if (!res.ok) {
    throw new Error(
      `GET ${source} returned ${res.status}. ` +
        `Start the API with OPENAPI_ENABLED=true, or set CYB_OPENAPI_URL.`,
    );
  }
  const doc = (await res.json()) as OpenApiDoc;

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(OUT_DIR, 'openapi.json'),
    `${JSON.stringify(doc, null, 2)}\n`,
  );
  writeFileSync(
    join(OUT_DIR, 'operations.ts'),
    renderOperations(buildOperations(doc)),
  );
  writeFileSync(join(OUT_DIR, 'schemas.ts'), renderSchemas(doc));

  process.stdout.write(`Generated from ${source}\n`);
}

main().catch((err: Error) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
