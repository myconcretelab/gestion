import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import {
  disableDeviceNotifications,
  enableDeviceNotifications,
  clearPushOnAccountChange,
  pushEnvironment,
} from "../src/utils/pushNotifications.ts";

const originals = new Map<string, PropertyDescriptor | undefined>();
const globalValue = (name: string, value: unknown) => {
  if (!originals.has(name))
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
};
afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  originals.clear();
});

const browser = () => {
  const calls: string[] = [];
  const storage = new Map<string, string>();
  const subscription = {
    endpoint: "https://web.push.apple.com/test",
    options: { applicationServerKey: Uint8Array.of(1, 2, 3).buffer },
    toJSON: () => ({ endpoint: "https://web.push.apple.com/test", keys: {} }),
    unsubscribe: async () => {
      calls.push("unsubscribe");
      return true;
    },
  };
  const registration = {
    pushManager: {
      getSubscription: async () => subscription,
      subscribe: async () => {
        calls.push("subscribe");
        return subscription;
      },
    },
    active: { postMessage: () => calls.push("clear") },
  };
  globalValue("window", {
    isSecureContext: true,
    Notification: {},
    PushManager: {},
    matchMedia: () => ({ matches: false }),
  });
  globalValue("navigator", {
    userAgent: "iPhone",
    platform: "iPhone",
    maxTouchPoints: 1,
    serviceWorker: {
      register: async () => {
        calls.push("register");
        return registration;
      },
      ready: Promise.resolve(registration),
      getRegistration: async () => registration,
    },
  });
  globalValue("Notification", {
    permission: "default",
    requestPermission: async () => {
      calls.push("permission");
      return "granted";
    },
  });
  globalValue("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  globalValue("fetch", async (_url: string, options: RequestInit) => {
    calls.push(`api:${options.method}`);
    return new Response(JSON.stringify({}), {
      headers: { "Content-Type": "application/json" },
    });
  });
  return { calls, storage, subscription, registration };
};

test("sur iPhone l'installation sur l'écran d'accueil est expliquée avant l'activation", () => {
  browser();
  assert.equal(pushEnvironment().needsHomeScreen, true);
  (navigator as Navigator & { standalone: boolean }).standalone = true;
  assert.equal(pushEnvironment().needsHomeScreen, false);
});

test("la permission est demandée dans le clic et l'abonnement est rattaché au compte après enregistrement", async () => {
  const { calls, storage } = browser();
  const promise = enableDeviceNotifications("AQID", "owner-1");
  assert.equal(calls[0], "permission");
  await promise;
  assert.deepEqual(calls, ["permission", "register", "api:POST"]);
  assert.equal(storage.get("contrats:push-device-owner"), "owner-1");
});

test("un changement de clé VAPID recrée l'abonnement et un échec serveur annule l'inscription locale", async () => {
  const { calls } = browser();
  globalValue(
    "fetch",
    async () =>
      new Response(JSON.stringify({ error: "Enregistrement impossible" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
  );
  await assert.rejects(
    enableDeviceNotifications("BAUG", "owner-1"),
    /Enregistrement impossible/,
  );
  assert.deepEqual(calls, [
    "permission",
    "register",
    "unsubscribe",
    "subscribe",
    "unsubscribe",
  ]);
});

test("désactiver un appareil retire l'inscription, l'abonnement et les notifications affichées", async () => {
  const { calls, storage } = browser();
  storage.set("contrats:push-device-owner", "owner-1");
  await disableDeviceNotifications("device-1");
  assert.deepEqual(calls, ["api:DELETE", "unsubscribe", "clear"]);
  assert.equal(storage.size, 0);
});

test("un autre compte sur le même appareil ne conserve pas les notifications du précédent", async () => {
  const { calls, storage } = browser();
  storage.set("contrats:push-device-owner", "owner-1");
  await clearPushOnAccountChange("owner-1");
  assert.equal(calls.length, 0);
  await clearPushOnAccountChange("owner-2");
  assert.deepEqual(calls, ["unsubscribe", "clear"]);
});

const worker = () => {
  const handlers: Record<string, (event: unknown) => void> = {};
  const notifications: Array<{
    title: string;
    options: { data: { url: string }; body: string };
  }> = [];
  const opened: string[] = [];
  const self = {
    location: { origin: "https://app.example.test" },
    addEventListener: (event: string, handler: (event: unknown) => void) => {
      handlers[event] = handler;
    },
    registration: {
      showNotification: async (
        title: string,
        options: (typeof notifications)[number]["options"],
      ) => {
        notifications.push({ title, options });
      },
    },
    clients: {
      matchAll: async () => [],
      openWindow: async (url: string) => {
        opened.push(url);
      },
    },
  };
  vm.runInNewContext(
    fs.readFileSync(
      new URL("../public/notifications-sw.js", import.meta.url),
      "utf8",
    ),
    { self, URL },
  );
  const dispatch = async (type: string, data: Record<string, unknown>) => {
    let finished: Promise<unknown> = Promise.resolve();
    handlers[type]({
      ...data,
      waitUntil: (promise: Promise<unknown>) => {
        finished = promise;
      },
    });
    await finished;
  };
  return { dispatch, notifications, opened };
};

test("le service worker affiche une alerte sans page ouverte et garde un repli visible pour les données invalides", async () => {
  const { dispatch, notifications } = worker();
  await dispatch("push", {
    data: {
      json: () => ({
        title: "Nouvelle réservation",
        body: "Gîte Forêt",
        url: "/reservations?focus=one",
      }),
    },
  });
  assert.equal(notifications[0].title, "Nouvelle réservation");
  assert.equal(notifications[0].options.body, "Gîte Forêt");
  await dispatch("push", {
    data: {
      json: () => {
        throw new Error("bad JSON");
      },
    },
  });
  assert.equal(notifications[1].title, "Nouvelle alerte");
});

test("un clic ouvre le dossier mais ne suit jamais une URL externe ou une action Telegram signée", async () => {
  const { dispatch, opened } = worker();
  for (const url of [
    "/reservations?focus=one",
    "https://evil.test/",
    "/api/public/task-reminders/action?token=secret",
  ]) {
    await dispatch("notificationclick", {
      notification: { data: { url }, close() {} },
    });
  }
  assert.deepEqual(opened, [
    "https://app.example.test/reservations?focus=one",
    "https://app.example.test/aujourdhui",
    "https://app.example.test/aujourdhui",
  ]);
});
