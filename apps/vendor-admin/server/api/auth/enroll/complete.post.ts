import { authRoute, authFields, strict, completeSignIn } from '../../../utils/auth-route'
import { z } from 'zod'

export default authRoute('enroll-complete', {
  path: '/v1/admin/auth/enroll/complete',
  schema: strict({ token: authFields.token, password: authFields.password, totp_code: authFields.totpCode, totp_box: z.string().regex(/^[A-Za-z0-9+/]+=*$/).max(200) }),
  session: 'none',
  onSuccess: completeSignIn,
})
