export const AUTH_REQUIRED_EVENT = "contrats:auth-required";

export type ServerAuthSession = {
  required: boolean;
  authenticated: boolean;
  passwordConfigured: boolean;
  sessionDurationHours: number;
  sessionExpiresAt: string | null;
};

export type ServerSecuritySettings = {
  enabled: boolean;
  passwordConfigured: boolean;
  sessionDurationHours: number;
  sessionExpiresAt: string | null;
};

export type ServerSecuritySaveResult = {
  settings: ServerSecuritySettings;
  session: ServerAuthSession;
};
