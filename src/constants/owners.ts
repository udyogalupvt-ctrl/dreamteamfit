/**
 * Owner accounts: every feature, and the only ones who can create staff logins.
 * Keep in sync with isOwner() in firestore.rules.
 */
export const OWNER_EMAILS = ["rebuildfitnesskkd@gmail.com", "admin@elevategym.com"] as const;

export const isOwnerEmail = (email: string | null | undefined) =>
  !!email && (OWNER_EMAILS as readonly string[]).includes(email.trim().toLowerCase());
