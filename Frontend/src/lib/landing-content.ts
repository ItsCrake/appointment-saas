/**
 * Landing page copy as data. Icons are referenced by *name* rather than by
 * component so this module stays plain data with no JSX import — the page maps
 * a name to a `lucide-react` component when it renders. Editing copy, adding a
 * feature or reordering an FAQ therefore never touches a component.
 */

export type FeatureIcon =
  "smartphone" | "bell" | "calendar" | "palette" | "chart" | "shield";

export type Feature = {
  icon: FeatureIcon;
  title: string;
  body: string;
};

/**
 * The three claims under the hero's buttons.
 *
 * **Product facts, never social proof.** PRODUCT.md records that there are no
 * testimonials, no customer logos and no usage figures, and that design must
 * not imply any exist — so "trusted by N shops" is not available here and never
 * will be until somebody agrees to be named. Each of these is instead something
 * the product does, checkable on the page it links to.
 *
 * The trial length is not written out: it lives in `TRIAL_DAYS`, and a number
 * typed here would drift from the one the billing sweep actually applies.
 */
export const HERO_FACTS: readonly string[] = [
  "בלי הרשמה ללקוח",
  "בעברית, מותאם לישראל",
  "הודעות אוטומטיות בוואטסאפ",
] as const;

export const FEATURES: Feature[] = [
  {
    icon: "smartphone",
    title: "בלי אפליקציה ללקוח",
    body: "הלקוח פותח קישור, בוחר שירות ושעה, ומקבל אישור. בלי הורדה ובלי הרשמה.",
  },
  {
    icon: "bell",
    title: "תזכורות שנשלחות מעצמן",
    body: "אישור מיידי בקביעה ותזכורת לפני התור. פחות שכחות ופחות חלונות ריקים.",
  },
  {
    icon: "calendar",
    title: "יומן שמבין משמרות",
    body: "משמרת בוקר וערב באותו יום, הפסקות, חופשות ומרווח בין טיפולים.",
  },
  {
    icon: "palette",
    title: "עמוד שנראה כמו העסק שלכם",
    body: "צבע, באנר, גלריית עבודות וחוות דעת, בלי מעצב ובלי מפתח.",
  },
  {
    icon: "chart",
    title: "מספרים שאפשר לפעול לפיהם",
    body: "כמה תורים השבוע, כמה ביטולים, ומי הלקוחות שחוזרים.",
  },
  {
    icon: "shield",
    title: "אפס כפילויות",
    body: "שני לקוחות לוחצים על אותה שעה, רק אחד יקבל אותה. נאכף במסד הנתונים.",
  },
];

export type Step = { title: string; body: string };

export const STEPS: Step[] = [
  {
    title: "הגדרת שירותים ושעות",
    body: "מגדירים מה אתם נותנים, כמה זמן כל טיפול לוקח ומתי אתם פתוחים. חמש דקות, פעם אחת.",
  },
  {
    title: "שיתוף הקישור האישי",
    body: "מקבלים כתובת משלכם. שולחים בוואטסאפ, מצמידים לביו באינסטגרם, מדפיסים על כרטיס ביקור.",
  },
  {
    title: "קבלת תורים אוטומטית",
    body: "הלקוחות קובעים לבד, מסביב לשעון. אתם רואים הכול ביומן אחד מסודר.",
  },
];

export type Faq = { question: string; answer: string };

export const FAQS: Faq[] = [
  {
    question: "כמה זמן לוקח להקים את זה?",
    answer:
      "כחמש דקות. מגדירים שם עסק, שירותים ושעות פעילות, ומקבלים קישור שאפשר לשתף מיד. אפשר לשנות הכול אחר כך.",
  },
  {
    question: "הלקוחות צריכים להירשם או להוריד אפליקציה?",
    answer:
      "לא. הלקוח פותח את הקישור בדפדפן, בוחר שירות ומועד ומזין שם וטלפון. זהו.",
  },
  {
    question: "מה קורה אם לקוח רוצה לבטל?",
    answer:
      "כל תור מגיע עם קישור אישי לביטול. הלקוח מבטל בעצמו בתוך חלון הזמן שהגדרתם, והמועד מתפנה מיד להזמנה הבאה, בלי טלפון אליכם.",
  },
  {
    question: "אפשר לבטל את המנוי?",
    answer:
      "כן, בכל רגע ובלי התחייבות. הנתונים שלכם נשארים זמינים להורדה, ועמוד ההזמנות פשוט מפסיק לקבל תורים חדשים.",
  },
  {
    question: "איך מקבלים תמיכה?",
    answer: "בוואטסאפ ובמייל. במסלול המקצועי יש גם ליווי בהקמה ומענה בעדיפות.",
  },
  {
    question: "התזכורות נשלחות ב-SMS או במייל?",
    answer:
      "במסלול הבסיסי במייל, ובמסלול המקצועי ב-SMS ישירות לנייד של הלקוח. בשני המסלולים התזכורת נשלחת אוטומטית לפי מספר השעות שהגדרתם.",
  },
  {
    question: "יש הגבלה על מספר התורים בחודש?",
    answer:
      "אין. שני המסלולים כוללים תורים ללא הגבלה. חודש עמוס לא יגרור חיוב נוסף ולא יחסום לקוח שמנסה לקבוע.",
  },
];
