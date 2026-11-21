import { functions, ExecutionMethod } from "./appwrite";
import { z } from "zod";
import type { Lang } from "../i18n";

// Vision-based strip/prescription reading. The image goes to the `ai-proxy`
// Appwrite function, which forwards it to the OpenAI-compatible endpoint with
// the server-side key. The key never reaches the browser; failures fall back
// to on-device tesseract OCR in the caller.

const ReadingSchema = z.object({
  nickname: z.string().catch(""),
  name: z.string().catch(""),
  strength: z.string().catch(""),
  instruction: z.string().catch(""),
  times: z.array(z.string()).catch([]),
  dosePerSlot: z
    .number()
    .refine((v) => [0.25, 0.5, 1, 2].includes(v))
    .catch(1),
  tabletsInStrip: z.number().int().min(1).max(200).nullish().catch(null),
});

export type MedicineReading = z.infer<typeof ReadingSchema>;

export const aiProxyAvailable = Boolean(functions);

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
  const imageDataUrl = await fileToDataUrl(file);
  const execution = await functions.createExecution({
    functionId: "ai-proxy",
    method: ExecutionMethod.POST,
    body: JSON.stringify({ imageDataUrl, lang }),
  });

  if (execution.status !== "completed") {
    throw new Error(`ai-proxy ${execution.status}: ${String(execution.responseBody || "").slice(0, 200)}`);
  }

  const outer = JSON.parse(execution.responseBody || "{}");
  if (outer.error) throw new Error(`ai-proxy: ${outer.error}`);

  // The model text is itself JSON; extract the first object from it.
  const match = /{[\s\S]*}/.exec(String(outer.content || ""));
  if (!match) throw new Error("ai-proxy: no JSON in model response");

  const reading = ReadingSchema.parse(JSON.parse(match[0]));
  const times = normalizeTimes(reading.times);
  return {
    ...reading,
    times: times.length ? times : ["08:00"],
  };
}
