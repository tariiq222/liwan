// Harvest every exported Zod schema from @nasq/contracts as JSON Schema.
// Zod v4 converts natively via z.toJSONSchema — no extra dependency.
// Output: one JSON object { "<export name>": <json schema> } on stdout.
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

register('./ts_loader.mjs', import.meta.url);

const barrelPath = fileURLToPath(new URL('../packages/contracts/src/index.ts', import.meta.url));
const contracts = await import(pathToFileURL(barrelPath).href);
const { z } = await import('zod');

const schemas = {};
for (const [name, value] of Object.entries(contracts)) {
  // Duck-type Zod schemas instead of instanceof so a duplicated zod copy
  // anywhere in the workspace tree cannot silently drop every schema.
  if (value && typeof value.safeParse === 'function' && value.def !== undefined) {
    schemas[name] = z.toJSONSchema(value, { io: 'output', cycles: 'ref', reused: 'inline', unrepresentable: 'any' });
  }
}
process.stdout.write(JSON.stringify(schemas, null, 2));
