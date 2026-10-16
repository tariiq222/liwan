import { bffHandler } from '../../../utils/errors'
import { proxyVendorRequest } from '../../../utils/proxy'

export default bffHandler('vendor-proxy', proxyVendorRequest)
