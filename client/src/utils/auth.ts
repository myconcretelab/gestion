export const AUTH_REQUIRED_EVENT = "contrats:auth-required";

export const APP_PAGES = [
  { id: "today", label: "Aujourd’hui" },
  { id: "reservations", label: "Réservations" },
  { id: "booking_requests", label: "Demandes" },
  { id: "calendar", label: "Calendrier" },
  { id: "planning_relay", label: "Planning relais" },
  { id: "contracts", label: "Contrats" },
  { id: "invoices", label: "Factures" },
  { id: "gites", label: "Gîtes" },
  { id: "professional_expenses", label: "Frais professionnels" },
  { id: "personal_expenses", label: "Frais personnels" },
  { id: "statistics", label: "Statistiques" },
  { id: "rates", label: "Tarifs" },
  { id: "settings", label: "Paramètres" },
] as const;
export type AppPageId = (typeof APP_PAGES)[number]["id"];
export type AppUserStatus = "owner" | "worker" | "custom";
export type AppUserRole = "owner" | "worker";

export type AppUser = {
  id: string;
  displayName: string;
  firstName: string;
  lastName: string;
  gestionnaireId: string | null;
  intervenantId: string | null;
  roles: AppUserRole[];
  status: AppUserStatus;
  telephone: string | null;
  email: string | null;
  adresse: string | null;
  telegramChatId: string | null;
  hourlyRate: number;
  cleaningCheckRate: number;
  fullCleaningRate: number;
  pageAccess: AppPageId[];
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

export const canCurrentUserAccessPage = (page: AppPageId) =>
  !currentUser || currentUser.permissions.isOwner || currentUser.pageAccess.includes(page);

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
