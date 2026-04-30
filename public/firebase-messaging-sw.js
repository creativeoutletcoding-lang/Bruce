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

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title ?? "Bruce";
  const body = payload.notification?.body ?? "";
  const data = payload.data ?? {};

  // Use the notification DB row ID as the tag so duplicate FCM deliveries
  // of the same push coalesce into one banner instead of appearing twice.
  self.registration.showNotification(title, {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data,
    tag: data.notificationId ?? data.chatId ?? "bruce",
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "https://heybruce.app/family";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) return client.focus();
        }
        if (clients.openWindow) return clients.openWindow(url);
      })
  );
});
