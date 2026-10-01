import base from './playwright.config.mjs'
export default { ...base, testMatch: ['isolation.spec.mjs', 'restore.spec.mjs', 'restored-isolation.spec.mjs'] }
