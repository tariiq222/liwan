// Shared credential resolution for the k6 scenarios.
//
// The kit runs against whatever BASE points at, so a literal fallback could sign in
// with a default account on a shared or live host. Both variables are therefore
// required, and a missing one aborts the run in the k6 init context.
export function requiredEnv(name) {
  const value = __ENV[name];
  if (!value) throw new Error(`loadtest: ${name} is required (export ${name}=...)`);
  return value;
}

export const LOGIN = requiredEnv('LOGIN');
export const PASSWORD = requiredEnv('PASSWORD');
