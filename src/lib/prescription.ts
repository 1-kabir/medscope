import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateObject } from "ai";
import { z } from "zod";
import type { Lang } from "../i18n";

// Vision-based prescription/strip reading via an OpenAI-compatible endpoint.
// Config comes from env (VITE_AI_BASE_URL, VITE_AI_API_KEY, VITE_AI_MODEL).
// NOTE: VITE_ vars are bundled into the client — use a restricted key.

export const aiConfigured = Boolean(
  import.meta.env.VITE_AI_BASE_URL && import.meta.env.VITE_AI_API_KEY && import.meta.env.VITE_AI_MODEL
);

const ReadingSchema = z.object({
  nickname: z
    .string()
    .describe("A short household nickname for this medicine in the user's language, e.g. 'pressure tablet'. Max 4 words."),
  name: z.string().describe("Medicine brand/generic name exactly as printed, Latin script."),
  strength: z.string().describe("Strength as printed, e.g. '40mg' or '500mg'. Empty string if unknown."),
  instruction: z
    .string()
    .describe("Short spoken-style instruction in the user's language, e.g. '1 tablet with water after food'."),
  times: z
    .array(z.string())
    .max(4)
    .describe("Dose times as 24h HH:MM strings, inferred from the prescription (morning→08:00, afternoon→14:00, night→21:00)."),
  dosePerSlot: z
    .number()
    .refine((v) => [0.25, 0.5, 1, 2].includes(v))
    .describe("Tablets per dose: 0.25, 0.5, 1 or 2."),
  tabletsInStrip: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Only if the image clearly shows a full strip: how many tablets/capsules it contains."),
});

export type MedicineReading = z.infer<typeof ReadingSchema>;

const LANG_NAME: Record<Lang, string> = { bn: "Bengali", hi: "Hindi", en: "English" };

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function normalizeTimes(raw: string[]): string[] {
  const clean: string[] = [];
  for (const t of raw) {
    const m = /^(\d{1,2})[:.h]?(\d{2})?$/.exec(t.trim());
    if (m) {
      const h = Math.min(23, Number(m[1]));
      const min = m[2] ? Number(m[2]) : 0;
      const slot = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
      if (!clean.includes(slot)) clean.push(slot);
    }
  }
  return clean.sort().slice(0, 4);
}

export async function readMedicineImage(file: File, lang: Lang): Promise<MedicineReading> {
  const provider = createOpenAICompatible({
    name: "medscope-vision",
    baseURL: import.meta.env.VITE_AI_BASE_URL,
    apiKey: import.meta.env.VITE_AI_API_KEY,
  });
  const model = provider.chatModel(import.meta.env.VITE_AI_MODEL);
  const dataUrl = await fileToDataUrl(file);

  const { object } = await generateObject({
    model,
    schema: ReadingSchema,
    messages: [
      {
        role: "system",
        content:
          "You read photos of medicine strips, blister packs and prescriptions for an app that schedules doses for elderly patients. " +
          "Extract exactly one medicine per image. Prefer what is printed; infer conservatively. " +
          `Write nickname and instruction in ${LANG_NAME[lang]}. Times must be 24h HH:MM.`,
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Read this medicine image and fill the schedule fields." },
          { type: "image", image: dataUrl },
        ],
      },
    ],
  });

  const times = normalizeTimes(object.times);
  return {
    ...object,
    times: times.length ? times : ["08:00"],
    dosePerSlot: [0.25, 0.5, 1, 2].includes(object.dosePerSlot) ? object.dosePerSlot : 1,
  };
}
