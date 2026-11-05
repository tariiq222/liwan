import { tenantConfig } from '../../../utils/ai/config'

export default defineEventHandler(event => tenantConfig(event, 'GET', '/v1/tenant/config'))
