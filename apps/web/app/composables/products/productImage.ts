import { PRODUCT_LIMITS, ProductImageMimetypeSchema, type ProductImage } from '@liwan/contracts'
import { fileToBase64 } from '../../utils/attachmentFile'

export const PRODUCT_IMAGE_ACCEPT = 'image/jpeg,image/png'

export type ProductImageProblem = 'type' | 'empty' | 'tooLarge'

/** What the contract allows of a chosen file, checked before it is read: a JPEG or PNG, not empty, at most the limit. */
export function productImageProblem(file: Pick<File, 'type' | 'size'>): ProductImageProblem | null {
  if (!ProductImageMimetypeSchema.safeParse(file.type).success) return 'type'
  if (file.size <= 0) return 'empty'
  return file.size > PRODUCT_LIMITS.imageBytes ? 'tooLarge' : null
}

/** The `{name, mimetype, data}` body of a file that passed `productImageProblem`; `data` is base64 text. */
export async function productImageBody(file: File): Promise<ProductImage> {
  return { name: file.name.slice(0, PRODUCT_LIMITS.imageName), mimetype: ProductImageMimetypeSchema.parse(file.type), data: await fileToBase64(file) }
}
