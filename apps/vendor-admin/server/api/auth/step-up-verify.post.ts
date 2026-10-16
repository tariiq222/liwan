import { authRoute, authFields, strict } from '../../utils/auth-route'

export default authRoute('step-up-verify', {
  path: '/v1/admin/auth/step-up/verify',
  schema: strict({ challenge_id: authFields.challengeId, response: authFields.response }),
  session: 'required',
})
