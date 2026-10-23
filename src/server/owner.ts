/** The workspace owner's email. Override with OWNER_EMAIL. */
export function ownerEmail(): string {
  return (process.env.OWNER_EMAIL || "ratulroydigital@gmail.com").trim().toLowerCase();
}

/** Optional extra secret required to set the owner password the first time. */
export function ownerSetupCode(): string | null {
  return process.env.OWNER_SETUP_CODE?.trim() || null;
}

export function isOwnerEmail(email: string): boolean {
  return email.trim().toLowerCase() === ownerEmail();
}
