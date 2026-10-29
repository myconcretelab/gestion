// Notifications only: authenticated pages and API responses are never cached.
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    const data = event.data?.json();
    payload = data && typeof data === "object" ? data : {};
  } catch { /* Show a visible fallback. */ }
  event.waitUntil(self.registration.showNotification(
    typeof payload.title === "string" ? payload.title : "Gestion locative",
    {
      body: typeof payload.body === "string" ? payload.body : "Une nouvelle alerte vous attend dans l’application.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: typeof payload.tag === "string" ? payload.tag : undefined,
      data: { url: typeof payload.url === "string" ? payload.url : "/aujourdhui" },
    },
  ));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    let url = new URL("/aujourdhui", self.location.origin);
    try {
      const candidate = new URL(event.notification.data?.url, self.location.origin);
      if (candidate.origin === self.location.origin && !candidate.pathname.startsWith("/api/")) url = candidate;
    } catch { /* Keep the authenticated home page. */ }
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === url.origin);
    if (existing) {
      const navigated = await existing.navigate(url.href);
      if (navigated) return navigated.focus();
    }
    return self.clients.openWindow(url.href);
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_NOTIFICATIONS") {
    event.waitUntil(self.registration.getNotifications().then((notifications) => {
      notifications.forEach((notification) => notification.close());
    }));
  }
});
