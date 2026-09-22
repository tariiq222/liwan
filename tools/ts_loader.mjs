// Node resolve hook: lets Node 24 import the contracts TypeScript sources
// directly, whose relative imports are written without file extensions
// (bundler-style). Used only by tools/contracts_jsonschema.mjs.
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.')) {
    try {
      return await next(specifier, context);
    } catch (error) {
      const cleaned = specifier.replace(/\.js$/, '');
      for (const candidate of [`${cleaned}.ts`, `${cleaned}/index.ts`]) {
        try {
          return await next(candidate, context);
        } catch {
          continue;
        }
      }
      throw error;
    }
  }
  return next(specifier, context);
}
