importScripts("https://www.gstatic.com/firebasejs/11.6.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging-compat.js");

// Config values mirror NEXT_PUBLIC_FIREBASE_* in .env. Safe to commit — these
// are client-side identifiers, not secrets. Firebase security is enforced by
// server-side rules, not by keeping the config private.
firebase.initializeApp({
  apiKey: "AIzaSyCwn3gBi8sEtR-BqwOMsae_ee34LihooKU",
  authDomain: "bruce-39068.firebaseapp.com",
  projectId: "bruce-39068",
  storageBucket: "bruce-39068.firebasestorage.app",
  messagingSenderId: "953486198059",
  appId: "1:953486198059:web:4d73aadeb4edfc8547316e",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(async (payload) => {
  // title and body come from payload.data (data-only message — no notification
  // field on the FCM send, so the OS never auto-displays on iOS via APNs).
  const title = payload.data?.title ?? "Bruce";
  const body = payload.data?.body ?? "";
  const data = payload.data ?? {};

  // Use the notification DB row ID as the tag so duplicate FCM deliveries
  // of the same push coalesce into one banner instead of appearing twice.
  await self.registration.showNotification(title, {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data,
    tag: data.notificationId ?? data.chatId ?? "bruce",
  });

  if ("setAppBadge" in self.navigator) {
    try {
      // Drive the badge from DB unread count rather than tray (shown notification)
      // count. This ensures clearAppBadge() on app open is the sole thing clearing
      // the badge — dismissing or accumulating tray banners has no effect.
      const res = await fetch("/api/notifications/unread", { credentials: "include" });
      if (res.ok) {
        const { count } = await res.json();
        await self.navigator.setAppBadge(count || 0);
      }
    } catch {}
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "https://heybruce.app/family";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // 1. A window already showing the exact target URL — just focus it.
        for (const client of windowClients) {
          if (client.url === url && "focus" in client) {
            return client.focus();
          }
        }
        // 2. App is open on a different page — navigate it to the target URL.
        for (const client of windowClients) {
          if ("navigate" in client) {
            return client.navigate(url).then((c) => c && c.focus());
          }
        }
        // 3. App is not open — launch it at the target URL.
        if (clients.openWindow) return clients.openWindow(url);
      })
  );
});
