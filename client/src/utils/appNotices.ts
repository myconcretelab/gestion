export const APP_NOTICE_EVENT = "app-notice";

export type AppNotice = {
  label: string;
  message: string;
  tone: "neutral" | "success" | "error";
  timeoutMs?: number | null;
  role?: "status" | "alert";
};

export const dispatchAppNotice = (notice: AppNotice) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AppNotice>(APP_NOTICE_EVENT, { detail: notice }));
};
