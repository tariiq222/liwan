import { z } from 'zod'
import { HrRefSchema } from './ref'

/** The employee assets area (`/api/v1/hr/assets`), over stock hr_maintenance. */
const isoDate = z.iso.date()
const relationId = z.number().int().positive().nullable().optional()
const nonEmptyTrimmedName = z.string().trim().min(1)
const requirePatchField = (value: object) => Object.keys(value).length > 0

export const HrAssetCategoryListSchema = z.object({
  items: z.array(HrRefSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const HrAssetCategoryCreateSchema = z.object({
  name: nonEmptyTrimmedName,
}).strict()

// No cost, vendor, technician, request, property or note key exists here by design.
export const HrEquipmentSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  category: HrRefSchema.nullable(),
  serial_no: z.string(),
  model: z.string(),
  employee: HrRefSchema.nullable(),
  assign_date: isoDate.nullable(),
  warranty_date: isoDate.nullable(),
  scrap_date: isoDate.nullable(),
  active: z.boolean(),
}).strict()

export const HrEquipmentListSchema = z.object({
  items: z.array(HrEquipmentSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const HrEquipmentCreateSchema = z.object({
  name: nonEmptyTrimmedName,
  category_id: relationId,
  serial_no: z.string().optional(),
  model: z.string().optional(),
  warranty_date: isoDate.optional(),
}).strict()

export const HrEquipmentPatchSchema = z.object({
  name: nonEmptyTrimmedName.optional(),
  category_id: relationId,
  serial_no: z.string().optional(),
  model: z.string().optional(),
  warranty_date: isoDate.nullable().optional(),
}).strict().refine(requirePatchField, { message: 'At least one field is required' })

export const HrEquipmentAssignSchema = z.object({
  employee_id: z.number().int().positive(),
  assign_date: isoDate.optional(),
}).strict()

export const HrEquipmentArchiveSchema = z.object({
  scrap_date: isoDate.optional(),
}).strict()

export type HrAssetCategoryList = z.infer<typeof HrAssetCategoryListSchema>
export type HrAssetCategoryCreate = z.infer<typeof HrAssetCategoryCreateSchema>
export type HrEquipment = z.infer<typeof HrEquipmentSchema>
export type HrEquipmentList = z.infer<typeof HrEquipmentListSchema>
export type HrEquipmentCreate = z.infer<typeof HrEquipmentCreateSchema>
export type HrEquipmentPatch = z.infer<typeof HrEquipmentPatchSchema>
export type HrEquipmentAssign = z.infer<typeof HrEquipmentAssignSchema>
export type HrEquipmentArchive = z.infer<typeof HrEquipmentArchiveSchema>
