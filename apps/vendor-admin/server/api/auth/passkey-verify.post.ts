import { authRoute, authFields, strict, completeSignIn } from '../../utils/auth-route'

export default authRoute('passkey-verify', {
  path: '/v1/admin/auth/passkey/verify',
  schema: strict({ challenge_id: authFields.challengeId, response: authFields.response }),
  session: 'none',
  onSuccess: completeSignIn,
})
