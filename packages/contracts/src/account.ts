import { z } from 'zod';

export const accountRoles = ['super_admin', 'editor', 'viewer'] as const;
export type AccountRole = (typeof accountRoles)[number];
export const loginMethods = ['PASSWORD', 'GOOGLE', 'BOTH'] as const;
export type LoginMethod = (typeof loginMethods)[number];
export type AccessLevel = 'VIEW' | 'EDIT';
export const normalizeGmail = (email: string): string => {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf('@');
  const domain = value.slice(at + 1);
  return ['gmail.com', 'googlemail.com'].includes(domain)
    ? `${value.slice(0, at).split('+')[0]!.replaceAll('.', '')}@gmail.com`
    : value;
};
export const isGmail = (email: string) => /@(gmail|googlemail)\.com$/i.test(email.trim());
export const accountInputSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    displayName: z.string().trim().min(2).max(100),
    role: z.enum(accountRoles),
    loginMethod: z.enum(loginMethods).default('PASSWORD'),
    password: z.string().min(8).max(128).optional(),
    workspaceIds: z.array(z.uuid()).min(1).max(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.loginMethod !== 'PASSWORD' && !isGmail(value.email))
      ctx.addIssue({
        code: 'custom',
        path: ['email'],
        message: 'Only Gmail accounts can use Google sign-in.',
      });
    if (value.loginMethod === 'GOOGLE' && value.password)
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Google-only accounts have no password.',
      });
  });
export const accountUpdateSchema = z
  .object({
    displayName: z.string().trim().min(2).max(100).optional(),
    role: z.enum(accountRoles).optional(),
    loginMethod: z.enum(loginMethods).optional(),
    isActive: z.boolean().optional(),
    password: z.string().min(8).max(128).optional(),
    workspaceIds: z.array(z.uuid()).min(1).max(100).optional(),
  })
  .strict();
export type AccountInput = z.infer<typeof accountInputSchema>;
export type AccountUpdate = z.infer<typeof accountUpdateSchema>;
export interface Account {
  id: string;
  email: string;
  displayName: string;
  role: AccountRole;
  loginMethod: LoginMethod;
  isActive: boolean;
  hasPassword: boolean;
  isOwner: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  workspaceIds: string[];
}
