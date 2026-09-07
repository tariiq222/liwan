// Focused script-unit check without generating Nuxt runtime state in this worktree.
export default {
  esbuild: { tsconfigRaw: '{"compilerOptions":{"target":"ES2022"}}' },
  test: { include: ['apps/web/app/components/project/templates/__tests__/ProjectTemplateEditor.test.ts'] },
}
