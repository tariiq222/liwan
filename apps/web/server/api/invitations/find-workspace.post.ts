import { forwardWorkspaceLookup } from '../../utils/customer-commercial'

// Public, common host only: a manager who lost the invitation asks for the address of their workspace. The answer is {ok:true}
// whether or not the typed address manages one; the control plane mails the address it holds on record. No cookie is read or
// forwarded. Never log or echo the address.
export default defineEventHandler(forwardWorkspaceLookup)
