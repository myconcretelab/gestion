export const AUTH_REQUIRED_EVENT = "contrats:auth-required";

export type AppUser = {
  id: string;
  displayName: string;
  gestionnaireId: string | null;
  isActive: boolean;
  permissions: {
    canWrite: boolean;
    canViewAmounts: boolean;
    isOwner: boolean;
  };
};

let currentUser: AppUser | null = null;

export const setCurrentAuthUser = (user: AppUser | null) => {
  currentUser = user;
};

export const canCurrentUserViewAmounts = () =>
  currentUser?.permissions.canViewAmounts ?? true;

export type ServerAuthSession = {
  required: boolean;
  authenticated: boolean;
  passwordConfigured: boolean;
  sessionDurationHours: number;
  sessionExpiresAt: string | null;
  user: AppUser | null;
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
