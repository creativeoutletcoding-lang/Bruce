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

  // Data-only message: no top-level notification field.
  // On iOS, a notification+data FCM payload converts to an APNs alert, which
  // the OS displays automatically — and then the SW's onBackgroundMessage also
  // fires and calls showNotification, producing two banners. Omitting the
  // notification field prevents APNs auto-display; the SW is the sole
  // display path on every platform.
  await messaging.send({
    token: fcmToken,
    data: { title, body, ...(data ?? {}) },
    webpush: {
      fcmOptions: {
        link: data?.url ?? "https://heybruce.app/family",
      },
    },
  });
}
