import { authRoute, authFields, strict, completeSignIn } from '../../utils/auth-route'
import { z } from 'zod'

export default authRoute('recovery', {
  path: '/v1/admin/auth/recovery',
  schema: strict({ email: authFields.email, password: authFields.password, recovery_code: z.string().length(14) }),
  session: 'none',
  onSuccess: completeSignIn,
})
