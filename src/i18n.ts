export type Lang = "bn" | "hi" | "en";

export const LANGUAGES: { id: Lang; label: string }[] = [
  { id: "bn", label: "বাংলা" },
  { id: "hi", label: "हिन्दी" },
  { id: "en", label: "English" },
];

const bn = {
  continue: "এগিয়ে যান",
  whoUsesPhone: "এই ফোন কে ব্যবহার করবেন?",
  myself: "আমি নিজে",
  familyMember: "পরিবারের কেউ",
  // Elder
  timeFor: "এখন ওষুধ খাওয়ার সময়",
  taken: "খেয়েছি",
  remindLater: "১০ মিনিট পরে",
  takenDone: "খেয়েছি।",
  remainingToday: "আজ আর {n}টি।",
  allDone: "আজকের সব ওষুধ খাওয়া হয়েছে।",
  nextDose: "পরের ওষুধ: {name}, {time}টায়।",
  help: "সাহায্য",
  callFamily: "পরিবারকে ফোন করুন",
  notNow: "এখন নয়",
  withWater: "১টি, পানির সাথে",
  // Family
  welcomeTitle: "MedscopeOne",
  welcomeBody: "ওষুধের স্ট্রিপের ছবি তুলুন, অ্যাপ সময়সূচি বানিয়ে নেবে। প্রতিদিন ফোন নিজেই মনে করিয়ে দেবে।",
  startSetup: "শুরু করুন",
  medicines: "ওষুধ",
  history: "ইতিহাস",
  family: "পরিবার",
  addMedicine: "ওষুধ যোগ করুন",
  missedToday: "আজ {n}টি ডোজ মিস হয়েছে",
  daysLeft: "{n} দিন বাকি",
  outOfStock: "ফুরিয়ে গেছে",
  reorder: "আবার কিনুন",
  settings: "সেটিংস",
  // Reminders-only line
  remindersOnly: "MedscopeOne শুধু মনে করিয়ে দেয়। ওষুধ বদলানো বা পরামর্শ দেওয়া এই অ্যাপের কাজ নয়।",
};

const hi: typeof bn = {
  continue: "आगे बढ़ें",
  whoUsesPhone: "यह फ़ोन कौन इस्तेमाल करेगा?",
  myself: "मैं खुद",
  familyMember: "परिवार का सदस्य",
  timeFor: "दवा लेने का समय",
  taken: "ले लिया",
  remindLater: "१० मिनट बाद",
  takenDone: "ले लिया।",
  remainingToday: "आज {n} और।",
  allDone: "आज की सारी दवाएँ ले ली गईं।",
  nextDose: "अगली दवा: {name}, {time} बजे।",
  help: "मदद",
  callFamily: "परिवार को कॉल करें",
  notNow: "अभी नहीं",
  withWater: "१ गोली, पानी के साथ",
  welcomeTitle: "MedscopeOne",
  welcomeBody: "दवा की पट्टी की फोटो लें, ऐप समय-सारणी बना लेगा। हर दिन फ़ोन खुद याद दिलाएगा।",
  startSetup: "शुरू करें",
  medicines: "दवाएँ",
  history: "इतिहास",
  family: "परिवार",
  addMedicine: "दवा जोड़ें",
  missedToday: "आज {n} डोज़ छूटे",
  daysLeft: "{n} दिन बाकी",
  outOfStock: "खत्म हो गया",
  reorder: "दोबारा खरीदें",
  settings: "सेटिंग्स",
  remindersOnly: "MedscopeOne सिर्फ याद दिलाता है। दवा बदलना या सलाह देना इस ऐप का काम नहीं।",
};

const en: typeof bn = {
  continue: "Continue",
  whoUsesPhone: "Who will use this phone?",
  myself: "Myself (elderly)",
  familyMember: "A family member",
  timeFor: "Time for your medicine",
  taken: "Taken",
  remindLater: "Remind in 10 min",
  takenDone: "Taken.",
  remainingToday: "{n} more today.",
  allDone: "All doses taken today.",
  nextDose: "Next: {name} at {time}.",
  help: "Help",
  callFamily: "Call family",
  notNow: "Not now",
  withWater: "One tablet, with water",
  welcomeTitle: "MedscopeOne",
  welcomeBody: "Photograph the medicine strip and the app builds the schedule. The phone reminds you every day, on its own.",
  startSetup: "Start setup",
  medicines: "Medicines",
  history: "History",
  family: "Family",
  addMedicine: "Add medicine",
  missedToday: "{n} doses missed today",
  daysLeft: "{n} days left",
  outOfStock: "Out of stock",
  reorder: "Reorder",
  settings: "Settings",
  remindersOnly: "MedscopeOne only reminds. It never changes a dose or gives medical advice.",
};

const dicts: Record<Lang, typeof bn> = { bn, hi, en };

export type TKey = keyof typeof bn;

export function t(lang: Lang, key: TKey, vars?: Record<string, string | number>): string {
  let s: string = dicts[lang][key] ?? dicts.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

const DIGITS: Record<string, string[]> = {
  bn: ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"],
  hi: ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"],
  en: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
};

export function localizeNumber(n: number | string, lang: Lang): string {
  const digits = DIGITS[lang] ?? DIGITS.en;
  return String(n).replace(/[0-9]/g, (d) => digits[Number(d)]);
}

export function speechLocale(lang: Lang): string {
  return lang === "bn" ? "bn-IN" : lang === "hi" ? "hi-IN" : "en-IN";
}
