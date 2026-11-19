import { forwardPublicContact } from '../../../utils/customer-commercial'

// Public, common host only: the marketing site's contact form. The control plane stores it and tells the owner. Never log or echo the body.
export default defineEventHandler(forwardPublicContact)
