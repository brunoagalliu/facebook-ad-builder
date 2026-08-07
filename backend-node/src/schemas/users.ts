import { z } from "zod";

export const userUpdateSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().nullish(),
  password: z.string().optional(),
  is_active: z.boolean().optional(),
});
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

export const userRoleUpdateSchema = z.object({
  role_ids: z.array(z.string()),
});
export type UserRoleUpdateInput = z.infer<typeof userRoleUpdateSchema>;

export const roleCreateSchema = z.object({
  name: z.string(),
  description: z.string().nullish(),
});
export type RoleCreateInput = z.infer<typeof roleCreateSchema>;

export const permissionCreateSchema = z.object({
  name: z.string(),
  description: z.string().nullish(),
});
export type PermissionCreateInput = z.infer<typeof permissionCreateSchema>;

// The Python route takes a raw JSON array body (List[str]), not an object.
export const permissionIdsSchema = z.array(z.string());
export type PermissionIdsInput = z.infer<typeof permissionIdsSchema>;
