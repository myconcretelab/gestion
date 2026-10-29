import { apiFetch } from "./api";

export type PushDevice = {
  id: string;
  label: string;
  createdAt: string;
  endpoint: string;
};
export type PushState = { publicKey: string; devices: PushDevice[] };
const OWNER_KEY = "contrats:push-device-owner";

export const pushEnvironment = () => {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return {
    needsHomeScreen: ios && !standalone,
    supported:
      window.isSecureContext &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window,
    denied: "Notification" in window && Notification.permission === "denied",
  };
};

const publicKeyBytes = (key: string) =>
  Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (char) =>
    char.charCodeAt(0),
  );

export const getLocalPushSubscription = async () => {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager?.getSubscription()) ?? null;
};

export const enableDeviceNotifications = async (
  publicKey: string,
  userId: string,
) => {
  // Called before the first await, directly from the user's button click (iOS).
  const permissionPromise = Notification.requestPermission();
  const registrationPromise = navigator.serviceWorker.register(
    "/notifications-sw.js",
    { scope: "/", updateViaCache: "none" },
  );
  if ((await permissionPromise) !== "granted")
    throw new Error(
      "Les notifications n’ont pas été autorisées. Vous pouvez modifier ce choix dans les réglages de votre appareil.",
    );
  await registrationPromise;
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  const applicationServerKey = publicKeyBytes(publicKey);
  const previousKey = subscription?.options.applicationServerKey;
  const sameKey =
    previousKey &&
    Array.from(new Uint8Array(previousKey)).join(",") ===
      Array.from(applicationServerKey).join(",");
  if (subscription && !sameKey) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
  const label = /iPhone/.test(navigator.userAgent)
    ? "iPhone"
    : /iPad/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
      ? "iPad"
      : /Android/.test(navigator.userAgent)
        ? "Android"
        : "Ordinateur";
  try {
    await apiFetch("/notifications/subscriptions", {
      method: "POST",
      json: { subscription: subscription.toJSON(), label },
    });
  } catch (error) {
    await subscription.unsubscribe().catch(() => false);
    throw error;
  }
  try {
    localStorage.setItem(OWNER_KEY, userId);
  } catch {
    /* Optional on restricted browsers. */
  }
};

export const disableDeviceNotifications = async (deviceId?: string) => {
  if (deviceId)
    await apiFetch(
      `/notifications/subscriptions/${encodeURIComponent(deviceId)}`,
      { method: "DELETE" },
    );
  const subscription = await getLocalPushSubscription();
  if (subscription && !(await subscription.unsubscribe()))
    throw new Error(
      "Impossible de désactiver les notifications sur cet appareil. Réessayez.",
    );
  const registration =
    "serviceWorker" in navigator
      ? await navigator.serviceWorker.getRegistration("/")
      : undefined;
  registration?.active?.postMessage({ type: "CLEAR_NOTIFICATIONS" });
  try {
    localStorage.removeItem(OWNER_KEY);
  } catch {
    /* Optional storage. */
  }
};

export const clearPushOnAccountChange = async (userId: string) => {
  let previous: string | null = null;
  try {
    previous = localStorage.getItem(OWNER_KEY);
  } catch {
    return;
  }
  if (previous && previous !== userId) await disableDeviceNotifications();
};
