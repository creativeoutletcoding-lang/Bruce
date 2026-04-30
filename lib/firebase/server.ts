import {
  initializeApp,
  getApps,
  getApp,
  cert,
  type App,
} from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

let adminApp: App | null = null;

function getAdminApp(): App {
  if (adminApp) return adminApp;
  if (getApps().length > 0) {
    adminApp = getApp();
    return adminApp;
  }

  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set");

  adminApp = initializeApp({ credential: cert(JSON.parse(json)) });
  return adminApp;
}

export async function sendPushNotification({
  fcmToken,
  title,
  body,
  data,
}: {
  fcmToken: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}): Promise<void> {
  const messaging = getMessaging(getAdminApp());

  await messaging.send({
    token: fcmToken,
    notification: { title, body },
    data: data ?? {},
    webpush: {
      notification: {
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        requireInteraction: false,
      },
      fcmOptions: {
        link: data?.url ?? "https://heybruce.app/family",
      },
    },
  });
}
