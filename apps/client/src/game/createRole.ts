/** `Global.maxNameLength`. */
export const MAX_NAME_LENGTH = 10;
export const MAX_FACE_COUNT = 10;

/**
 * Client-side checks of `CreateRoleDialog.onSubmit` for the lord name; returns the message key
 * of the first failing rule. The server validates again (characters, length, uniqueness).
 */
export function validateLordName(name: string): string | null {
  if (name === '') return 'Login_CreateRoleDialogSrc_2';
  if (name.length > MAX_NAME_LENGTH) return 'Login_CreateRoleDialogSrc_3';
  if (name.length <= 1) return 'Login_CreateRoleDialogSrc_4';
  if (name.includes('\r')) return 'Login_CreateRoleDialogSrc_5';
  return null;
}
