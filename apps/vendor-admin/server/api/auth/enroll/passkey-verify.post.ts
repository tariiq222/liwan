import { authRoute, authFields, strict } from '../../../utils/auth-route'
import { z } from 'zod'

export default authRoute('enroll-passkey-verify', {
  path: '/v1/admin/auth/enroll/passkey/verify',
  schema: strict({ token: authFields.token, challenge_id: authFields.challengeId, response: authFields.response, label: z.string().max(60) }),
  session: 'none',
})
