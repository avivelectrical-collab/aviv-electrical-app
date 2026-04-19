# תוכנית: מערכת העלאת חשבוניות עם זיהוי AI + שדרוג תזרים

**פרויקט:** aviv-electrical-app
**תאריך יצירה:** 19.4.2026
**מטרה:** שילוב מערכת העלאת חשבוניות אוטומטית עם זיהוי AI, קישור דו-כיווני לספקים ולתזרים, וטיפול בהוראות קבע דינמיות.

---

## סיכום החלטות שנסגרו

| נושא | החלטה |
|---|---|
| מיקום העלאה | גם בכרטיס ספק, גם בטאב תזרים (קומפוננטה משותפת) |
| Storage | Firebase Storage |
| פלח UI | מודאל אישור אחרי זיהוי AI (לא הכנסה ישירה) |
| קטגוריות | רשימה קבועה + אפשרות הוספת קטגוריות מותאמות בעריכת ספק |
| סימון "שולם" | ידני בלבד (כפתור "סמן כשולם") |
| Overdue | אוטומטי לפי תאריך (job בטעינה) |
| הוראת קבע דינמית | בכל חודש בוחר: "ממוצע" או "סכום מותאם" |
| DB schema | קולקציה חדשה `invoices`, קישור ל-`transactions` דרך `invoiceId` |
| פיצ'רים חכמים | קטגוריות אוטו' + שיוך פרויקט + זיהוי כפילויות + סטטוס תשלום |

---

## מודל נתונים

### אובייקט `suppliers` — שדות חדשים

```javascript
{
  // קיים (לבדוק במיפוי)
  id: string,
  name: string,

  // חדש
  paymentTerms: "cash" | "net_current" | "net_30" | "net_60" | "net_90",
  defaultCategory: string,           // מפתח מתוך רשימת הקטגוריות
  customCategories: string[],        // קטגוריות שהמשתמש הוסיף בכרטיס זה
  isStandingOrder: boolean,
  standingOrderType: "fixed" | "dynamic" | null,
  averageAmount: number | null       // לספקי הוראת קבע דינמית
}
```

### קולקציה חדשה `invoices`

```javascript
{
  id: string,
  supplierId: string,
  supplierName: string,              // denormalized for display
  fileUrl: string,                   // Firebase Storage download URL
  fileName: string,
  fileType: "pdf" | "jpg" | "png",
  invoiceDate: date,                 // יום הפקת החשבונית
  paymentDate: date,                 // מחושב: invoiceDate + paymentTerms
  amount: number,
  invoiceNumber: string | null,      // מספר חשבונית (אם AI זיהה)
  category: string,
  projectId: string | null,
  status: "pending" | "paid" | "overdue",
  paidAt: timestamp | null,
  transactionId: string,             // קישור לשורת תזרים
  aiExtracted: boolean,              // נוצר אוטומטית או ידני
  aiConfidence: number | null,       // 0-1
  createdAt: timestamp
}
```

### אובייקט `transactions` — שדות חדשים

```javascript
{
  // קיים
  id, date, desc, amount, isIncome, cat, projectId, type,

  // חדש
  invoiceId: string | null,          // קישור אם נוצר מחשבונית
  status: "pending" | "paid" | "overdue" | null,
  category: string                   // מורש מהספק (אם יש)
}
```

---

## רשימת קטגוריות התחלתית

| מפתח | תצוגה | ספקים טיפוסיים |
|---|---|---|
| `fuel` | דלק | פאמפאי |
| `materials` | חומרים | ראש חשמל, דיפו |
| `tools` | כלים | המחסן למקצוען |
| `platforms` | במות הרמה | (ספקים של במות) |
| `credit` | אשראי | כרטיסי אשראי |
| `utilities` | חשבונות שוטפים | חשמל, מים, סלולר, אינטרנט |
| `labor` | כוח אדם | NMT, קבלני משנה |
| `taxes` | מסים ואגרות | רשויות |
| `office` | ציוד משרדי | |
| `software` | תוכנות ושירותים | Anthropic, GitHub |
| `other` | אחר | |

הרשימה מוגדרת כ-constant בקוד. קטגוריות מותאמות נשמרות ב-`supplier.customCategories` ומוצגות בדרופדאון רק כשאותו ספק נבחר.

---

## שלב 0 — מיפוי הקוד הקיים

**לפני שנוגעים בכלום** — להריץ את ה-greps הבאים ב-Claude Code ולסכם מה קיים היום:

```bash
# מבנה הספק הקיים
grep -n "suppliers" index.html | head -30
grep -n "SupplierDirectory" index.html
grep -n "SupplierForm\|supplierForm" index.html

# תנאי תשלום קיימים
grep -n "calcPaymentDate" index.html
grep -n "paymentTerms\|payment_terms" index.html

# סריקת AI קיימת
grep -n "SupplierScanApproval" index.html
grep -n "approveSupplierScan" index.html
grep -n "claude-sonnet" index.html

# הוראות קבע
grep -n "standing_order\|standingOrder" index.html

# Firebase Storage (האם כבר קיים?)
grep -n "firebase.storage\|storageRef\|getDownloadURL" index.html

# תזרים
grep -n "CashFlowPage" index.html
grep -n "manualForm" index.html
```

**פלט מצופה:** סיכום בן פיסקה לכל אזור בקוד. אם חסר לי מידע — לבקש.

---

## שלב 1 — תשתית

### 1.1 הוספת Firebase Storage ל-`index.html`

שינוי `old_string`/`new_string` ב-script tags של Firebase (סמוך לטעינת Firestore):

```html
<!-- להוסיף -->
<script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-storage-compat.js"></script>
```

ואתחול:
```javascript
const storage = firebase.storage();
```

### 1.2 Storage Rules (בקונסול Firebase)

**משימה ידנית שלך** — ב-Firebase Console → Storage → Rules:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /invoices/{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### 1.3 מיגרציה שקטה של ספקים קיימים

פונקציה שרצה פעם אחת בטעינת הדף:
```javascript
async function migrateSuppliers() {
  const migrated = localStorage.getItem('suppliers_migrated_v1');
  if (migrated) return;

  const suppliers = await db.get('suppliers');
  const updates = suppliers
    .filter(s => !s.paymentTerms)
    .map(s => ({
      ...s,
      paymentTerms: s.paymentTerms || 'cash',
      defaultCategory: s.defaultCategory || 'other',
      customCategories: s.customCategories || [],
      isStandingOrder: s.isStandingOrder || false,
      standingOrderType: s.standingOrderType || null,
      averageAmount: s.averageAmount || null
    }));

  for (const s of updates) {
    await db.update('suppliers', s.id, s);
  }
  localStorage.setItem('suppliers_migrated_v1', 'true');
}
```

---

## שלב 2 — עריכת כרטיס ספק

שדות חדשים בטופס עריכת ספק:

1. **תנאי תשלום** (select) — מזומן / שוטף / שוטף+30 / שוטף+60 / שוטף+90
2. **קטגוריית ברירת מחדל** (select) — מתוך רשימת הקטגוריות
3. **קטגוריות מותאמות** — input + כפתור "הוסף", רשימה עם כפתור מחיקה לכל אחת
4. **צ'קבוקס** — "זהו ספק של הוראת קבע"
5. **אם מסומן:**
   - select — "קבועה" / "משתנה"
   - אם "משתנה" → input סכום ממוצע (₪)

validation: אם הוראת קבע — חייב סכום ממוצע.

---

## שלב 3 — קומפוננטה משותפת `InvoiceUploader`

### Props
```javascript
{
  supplierId: string | null,    // אם בכרטיס ספק
  onComplete: (invoiceId) => void
}
```

### UI
- Drag-and-drop zone (תומך PDF, JPG, PNG)
- תצוגה מקדימה של הקובץ
- Progress bar בהעלאה
- כפתור "זהה אוטומטית"
- ולידציה: גודל מקסימום 10MB, סוגי קבצים מותרים בלבד

### העלאה ל-Storage
```javascript
const file = files[0];
const year = new Date().getFullYear();
const month = String(new Date().getMonth() + 1).padStart(2, '0');
const timestamp = Date.now();
const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
const path = `invoices/${year}/${month}/${timestamp}_${safeName}`;

const ref = storage.ref(path);
const snapshot = await ref.put(file);
const url = await snapshot.ref.getDownloadURL();

// שמירת url + path במצב לפני המודאל
```

---

## שלב 4 — Pipeline זיהוי AI

### System prompt

```
אתה עוזר שמחלץ מידע מחשבוניות וקבלות של עסק ישראלי בתחום החשמל.
החזר JSON בלבד, בלי הסברים, בלי markdown fences.

מבנה התגובה:
{
  "supplierName": "שם הספק כפי שמופיע במסמך (טקסט מלא)",
  "invoiceDate": "YYYY-MM-DD",
  "amount": מספר (סך הכל לתשלום כולל מע"מ),
  "invoiceNumber": "מספר החשבונית/קבלה" או null,
  "items": [{"desc": "תיאור פריט", "amount": מספר}] או [],
  "confidence": 0-1 (כמה אתה בטוח בזיהוי)
}

חוקים:
- אם השדה לא ברור או חסר - החזר null (לא "לא ידוע" או מחרוזת ריקה)
- סכום תמיד כמספר, בלי ₪ או פסיקים
- תאריך תמיד ב-ISO format
- confidence נמוך (<0.7) אם חלק מהשדות מעורפלים
```

### שליחת הקובץ

**PDF:**
```javascript
{
  type: "document",
  source: {
    type: "base64",
    media_type: "application/pdf",
    data: base64Data
  }
}
```

**JPG/PNG:**
```javascript
{
  type: "image",
  source: {
    type: "base64",
    media_type: file.type,  // "image/jpeg" או "image/png"
    data: base64Data
  }
}
```

### מודל

שדרוג מ-`claude-sonnet-4-20250514` ל-`claude-sonnet-4-6` או `claude-opus-4-7` לזיהוי מדויק יותר.

**הערה:** לפני השדרוג — לבדוק שה-API הקיים עובד ולא לשבור תקינות.

---

## שלב 5 — מודאל אישור חכם

### סדר בדיקות לפני הצגת המודאל

1. **מצא ספק לפי שם**
   - חיפוש fuzzy ב-`suppliers` (contains + case-insensitive)
   - אם נמצאה התאמה → prefill supplierId
   - אם לא → הצג banner "AI זיהה ספק: X, לא ברשימה"

2. **בדוק כפילויות**
   ```javascript
   const duplicates = invoices.filter(inv =>
     inv.supplierId === matchedSupplierId &&
     inv.amount === aiAmount &&
     Math.abs(daysBetween(inv.invoiceDate, aiDate)) <= 3
   );
   ```
   אם נמצאה → warning אדום בראש המודאל, עם קישור לחשבונית הקיימת.

3. **חשב תאריך תשלום**
   ```javascript
   paymentDate = calcPaymentDate(invoiceDate, supplier.paymentTerms)
   ```

4. **הצע פרויקט** (אופציונלי, prefilled אם נמצא):
   - פרויקט עם `status === "active"` + עדכון אחרון ב-7 ימים אחרונים
   - fallback: פרויקט אחרון שקושר לספק הזה

### שדות במודאל (כולם ניתנים לעריכה)

| שדה | מקור | Required |
|---|---|---|
| ספק | AI + dropdown | ✓ |
| תאריך חשבונית | AI | ✓ |
| סכום | AI | ✓ |
| מספר חשבונית | AI | — |
| קטגוריה | supplier.defaultCategory | ✓ |
| פרויקט | smart suggestion | — |
| תאריך תשלום | calcPaymentDate | ✓ |

### ולידציה לפני שמירה

- ספק חייב להיבחר (אם AI לא זיהה ברשימה → חובה לבחור או להוסיף)
- סכום > 0
- תאריכים תקינים

### אם ספק לא קיים

- כפתור "הוסף ספק חדש" → פותח טופס ספק מהיר (שם, תנאי תשלום, קטגוריה)
- אחרי יצירה → חוזר למודאל החשבונית עם הספק החדש כבר מסומן

---

## שלב 6 — שמירה וקישור דו-כיווני

```javascript
async function saveInvoice(data) {
  // 1. Create invoice doc
  const invoiceRef = await db.add('invoices', {
    ...data,
    status: 'pending',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  // 2. Create transaction
  const txRef = await db.add('transactions', {
    date: data.paymentDate,
    desc: `${data.supplierName}${data.invoiceNumber ? ' #' + data.invoiceNumber : ''}`,
    amount: data.amount,
    isIncome: false,
    cat: data.category,
    projectId: data.projectId,
    invoiceId: invoiceRef.id,
    status: 'pending'
  });

  // 3. Update invoice with transactionId
  await db.update('invoices', invoiceRef.id, {
    transactionId: txRef.id
  });

  return invoiceRef.id;
}
```

---

## שלב 7 — תצוגת חשבוניות בכרטיס ספק

רכיב `InvoicesSection` בתוך כרטיס הספק:

### UI
- כותרת: `חשבוניות ({count})`
- סינונים: שנה (select), חודש (select), סטטוס (select: all/pending/paid/overdue)
- טבלה:
  - תאריך חשבונית
  - מספר חשבונית
  - סכום
  - סטטוס (badge צבעוני)
  - קטגוריה
  - פרויקט
  - פעולות: [📄 פתח קובץ] [✓ סמן כשולם]
- שורת סיכום:
  - סה"כ השנה: ₪X
  - סה"כ החודש: ₪Y
  - ממתין לתשלום: ₪Z

### Query
```javascript
const invoices = await db.query('invoices', 'supplierId', '==', supplierId);
```

---

## שלב 8 — הוראת קבע דינמית + סטטוס תשלום

### הוראת קבע דינמית בתזרים

שורה וירטואלית של `standing_order` שבה `supplier.standingOrderType === "dynamic"`:

- **2 כפתורים** במקום 1:
  - `✓ אישור ₪X (ממוצע)` — יוצר transaction עם הסכום הממוצע
  - `✏️ עריכת סכום` — פותח modal קטן

### Modal עריכה
- שדה סכום
- תזכורת הממוצע: "הממוצע: ₪X"
- אם `|amount - averageAmount| / averageAmount > 0.2` → warning:
  `⚠️ הסכום חורג מהממוצע ב-XX%`
- כפתור "אשר ושמור" → יוצר transaction אמיתי; הוירטואלי נעלם

### סטטוס תשלום בתזרים

**צביעה:**
- שורה עם `status === "pending"` → רקע צהוב בהיר
- `status === "overdue"` → רקע אדום בהיר
- `status === "paid"` → רקע ירוק בהיר או ללא רקע

**כפתור "סמן כשולם":**
- זמין רק ל-`pending` / `overdue`
- על לחיצה:
  ```javascript
  await db.update('invoices', invoiceId, {
    status: 'paid',
    paidAt: serverTimestamp()
  });
  await db.update('transactions', txId, {
    status: 'paid'
  });
  ```

**Job עדכון overdue** (רץ בטעינת `CashFlowPage`):
```javascript
async function updateOverdue() {
  const today = new Date();
  const pending = await db.query('invoices', 'status', '==', 'pending');

  for (const inv of pending) {
    if (new Date(inv.paymentDate) < today) {
      await db.update('invoices', inv.id, { status: 'overdue' });
      if (inv.transactionId) {
        await db.update('transactions', inv.transactionId, { status: 'overdue' });
      }
    }
  }
}
```

---

## חלוקה לסשנים ב-Claude Code

### 🎯 סשן א' (שלבים 0–2) — תשתית

1. מיפוי קוד (grep)
2. הוספת Firebase Storage ל-`index.html`
3. Storage Rules בקונסול (ידנית)
4. מיגרציית ספקים קיימים
5. הרחבת טופס עריכת ספק
6. בדיקה בייצור
7. Commit + push

**Commits צפויים:**
- `הוסף: תמיכת Firebase Storage`
- `הוסף: שדות חדשים לטופס ספק (תנאי תשלום, קטגוריה, הוראת קבע)`
- `הוסף: מיגרציה אוטומטית של ספקים קיימים`

### 🎯 סשן ב' (שלבים 3–6) — העלאה + AI + שמירה

1. רכיב `InvoiceUploader` עם העלאה ל-Storage
2. שילוב בכרטיס ספק ובתזרים
3. Pipeline זיהוי AI
4. מודאל אישור עם כל הפיצ'רים החכמים
5. שמירה וקישור דו-כיווני
6. בדיקה בייצור עם חשבונית אמיתית
7. Commit + push

**Commits צפויים:**
- `הוסף: רכיב InvoiceUploader`
- `הוסף: אינטגרציית זיהוי AI לחשבוניות`
- `הוסף: מודאל אישור עם זיהוי כפילויות ושיוך פרויקט`
- `הוסף: שמירת חשבונית עם קישור דו-כיווני לתזרים`

### 🎯 סשן ג' (שלבים 7–8) — תצוגה + סטטוס + דינמיקה

1. סקשן חשבוניות בכרטיס ספק
2. הוראת קבע דינמית — 2 כפתורים + מודאל עריכה
3. סטטוס תשלום + צביעה
4. Job עדכון overdue
5. בדיקה בייצור
6. Commit + push

**Commits צפויים:**
- `הוסף: תצוגת חשבוניות בכרטיס ספק עם סינונים`
- `הוסף: הוראת קבע דינמית עם סכום משתנה`
- `הוסף: סטטוס תשלום וזיהוי איחור אוטומטי`

---

## פתיחת סשן ב-Claude Code

בסשן א' (והבאים), פתח עם ההודעה:

```
קרא את CLAUDE.md, את docs/invoice-upload-plan.md,
ואת /mnt/skills/user/electrical-quote/SKILL.md.

מתחילים בסשן א': שלבים 0–2.

לפני שנוגעים בקוד — תריץ את כל ה-greps משלב 0
ותעשה סיכום של מה קיים. אחרי הסיכום — נחליט
איזה שינויים בדיוק ואיך. אל תגע בקוד בלי אישור.
```

---

## שאלות פתוחות (לדיון בסשן הרלוונטי)

1. **נפח חשבוניות צפוי בחודש?** — ישפיע על החלטות ביצועים (pagination בכרטיס ספק, cache)
2. **גיבוי Storage?** — Firebase Storage ב-Spark plan ללא גיבוי אוטומטי. האם להוסיף export תקופתי?
3. **Retention של חשבוניות ישנות?** — דרישות מס בישראל: 7 שנים. לא למחוק קבצים.
4. **UX לקובץ גדול במודאל אישור** — PDF מרובה עמודים: תצוגה מקדימה של עמוד 1 או כפתור "פתח בחלון חדש"?

---

## סיכום אחרון

**אל תתחיל שום סשן בלי:**
- קריאת `CLAUDE.md`
- קריאת `docs/invoice-upload-plan.md` (המסמך הזה)
- קריאת `/mnt/skills/user/electrical-quote/SKILL.md`

**כללי הזהב:**
- תוכנית לפני כל edit
- diff לפני כל edit
- אישור בנפרד לכל edit
- commit + push דורשים אישור נפרד
- "עצור" = עוצרים מיד

**בהצלחה! 🚀**
