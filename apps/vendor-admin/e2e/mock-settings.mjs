// Shared by the mock control service, the Playwright config and the specs. Test values only.
export const MOCK_PORT = Number(process.env.MOCK_CONTROL_PORT ?? 4711)
export const SERVICE_KEY = 'e2e-service-key-e2e-service-key-0123456789'
export const INSTALLATION_ID = 'vendor-admin-e2e'
export const PROD_PORT = Number(process.env.E2E_PROD_PORT ?? 3113)
export const DEV_PORT = Number(process.env.E2E_DEV_PORT ?? 3110)
export const ADMIN_PASSWORD = 'correct horse battery'
export const TOTP_CODE = '123456'
export const OWNER_EMAIL = 'owner@example.test'
export const SUPPORT_EMAIL = 'support@example.test'
