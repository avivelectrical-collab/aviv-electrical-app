// ═══════════════════════════════════════════════════════════════
// Cloud Functions — ניהול משתמשים (אביב מערכות חשמל)
// כל פונקציה מאמתת בצד השרת שהקורא הוא admin פעיל — לא סומכים על ה-UI.
// פריסה: firebase deploy --only functions   (לא לפרוס rules מכאן!)
// ═══════════════════════════════════════════════════════════════
// חשוב: ב-firebase-functions v6 ה-API הישן (v1) זמין תחת הנתיב /v1
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
admin.initializeApp();

const ROLES = ["admin", "team_leader", "worker"];

// הרשאות ברירת מחדל לפי תפקיד — זהה ל-DEFAULT_PERMS שבאפליקציה (index.html)
const DEFAULT_PERMS = {
  admin: { pages: { dashboard: true, projects: true, worklog: true, attendance: true, invoices: true, reports: true, financial: true, cashflow: true, ai: true, users: true, workers: true, pricing: true, settings: true }, viewPrices: true, viewWorkerRates: true, editWorklog: true, deleteWorklog: true },
  team_leader: { pages: { dashboard: false, projects: false, worklog: true, attendance: true, invoices: false, reports: false, financial: false, cashflow: false, ai: false, users: false, workers: false, pricing: false }, viewPrices: false, viewWorkerRates: false, editWorklog: true, deleteWorklog: false },
  worker: { pages: { dashboard: false, projects: false, worklog: false, attendance: true, invoices: false, reports: false, financial: false, cashflow: false, ai: false, users: false, workers: false, pricing: false }, viewPrices: false, viewWorkerRates: false, editWorklog: false, deleteWorklog: false }
};

// אימות בצד השרת: הקורא מחובר + קיים ב-app_users + תפקידו admin + לא מושבת
async function assertAdmin(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "נדרשת התחברות");
  }
  const snap = await admin.firestore().collection("app_users").doc(context.auth.uid).get();
  const prof = snap.exists ? snap.data() : null;
  if (!prof || prof.role !== "admin" || prof.active === false) {
    throw new functions.https.HttpsError("permission-denied", "פעולה זו מותרת למנהל בלבד");
  }
  return context.auth.uid;
}

// יצירת סיסמה זמנית קריאה (10 תווים, בלי תווים דו-משמעיים כמו O/0, l/1)
function genTempPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let pw = "";
  for (let i = 0; i < 10; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}

// ── הוספת עובד: שם + אימייל + תפקיד → חשבון Auth + פרופיל app_users ──
// מחזיר סיסמה זמנית שהמנהל מוסר לעובד (העובד יכול לשנות דרך "שכחתי סיסמה").
exports.createUser = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);
  const name = (data && data.name || "").trim();
  const email = (data && data.email || "").trim().toLowerCase();
  const role = data && data.role;
  if (!name) throw new functions.https.HttpsError("invalid-argument", "חסר שם עובד");
  if (!email || email.indexOf("@") < 1) throw new functions.https.HttpsError("invalid-argument", "כתובת אימייל לא תקינה");
  if (ROLES.indexOf(role) < 0) throw new functions.https.HttpsError("invalid-argument", "תפקיד לא תקין");

  const tempPassword = genTempPassword();
  let userRecord;
  try {
    userRecord = await admin.auth().createUser({ email: email, password: tempPassword, displayName: name });
  } catch (e) {
    if (e.code === "auth/email-already-exists") {
      throw new functions.https.HttpsError("already-exists", "כבר קיים חשבון עם האימייל הזה");
    }
    throw new functions.https.HttpsError("internal", "שגיאה ביצירת החשבון: " + (e.message || e.code));
  }
  await admin.firestore().collection("app_users").doc(userRecord.uid).set({
    uid: userRecord.uid,
    name: name,
    email: email,
    role: role,
    permissions: DEFAULT_PERMS[role],
    active: true,
    createdAt: new Date().toISOString()
  });
  return { uid: userRecord.uid, tempPassword: tempPassword };
});

// ── השבתה/הפעלה של עובד (השבתה חוסמת כניסה מיידית; ההיסטוריה נשמרת) ──
exports.setUserActive = functions.https.onCall(async (data, context) => {
  const callerUid = await assertAdmin(context);
  const uid = data && data.uid;
  const active = !!(data && data.active);
  if (!uid) throw new functions.https.HttpsError("invalid-argument", "חסר מזהה משתמש");
  if (uid === callerUid && !active) {
    throw new functions.https.HttpsError("failed-precondition", "אי אפשר להשבית את עצמך");
  }
  // disabled ב-Auth חוסם התחברות; revokeRefreshTokens מנתק session פעיל תוך עד שעה
  await admin.auth().updateUser(uid, { disabled: !active });
  if (!active) await admin.auth().revokeRefreshTokens(uid);
  await admin.firestore().collection("app_users").doc(uid).update({ active: active });
  return { ok: true };
});

// ── מחיקה מלאה (בלתי הפיכה) — נשמרת רק לפרופיל; היסטוריית יומנים/נוכחות לא נמחקת ──
exports.deleteUser = functions.https.onCall(async (data, context) => {
  const callerUid = await assertAdmin(context);
  const uid = data && data.uid;
  if (!uid) throw new functions.https.HttpsError("invalid-argument", "חסר מזהה משתמש");
  if (uid === callerUid) {
    throw new functions.https.HttpsError("failed-precondition", "אי אפשר למחוק את עצמך");
  }
  try {
    await admin.auth().deleteUser(uid);
  } catch (e) {
    if (e.code !== "auth/user-not-found") {
      throw new functions.https.HttpsError("internal", "שגיאה במחיקת החשבון: " + (e.message || e.code));
    }
  }
  await admin.firestore().collection("app_users").doc(uid).delete();
  return { ok: true };
});
