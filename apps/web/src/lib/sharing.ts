import { z } from 'zod';

export const vaultRoleSchema = z.enum(['owner', 'admin', 'editor', 'commenter', 'viewer']);
export type VaultRole = z.infer<typeof vaultRoleSchema>;
export const memberRoleSchema = z.enum(['admin', 'editor', 'commenter', 'viewer']);
export type MemberRole = z.infer<typeof memberRoleSchema>;

export function canEdit(role: VaultRole | null): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor';
}
export function canManage(role: VaultRole | null): boolean {
  return role === 'owner' || role === 'admin';
}
export function canComment(role: VaultRole | null): boolean {
  return canEdit(role) || role === 'commenter';
}
