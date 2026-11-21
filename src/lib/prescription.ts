import { functions, ExecutionMethod } from "./appwrite";
import { z } from "zod";
import type { Lang } from "../i18n";

// Vision-based strip/prescription reading. The image goes to the `ai-proxy`
// Appwrite function, which forwards it to the OpenAI-compatible endpoint with
// the server-side key. The key never reaches the browser. There is no on-device
// OCR fallback: a failure is reported to the caller and shown to the user.

const ReadingSchema = z.object({
  nickname: z.string().catch(""),
  name: z.string().catch(""),
  strength: z.string().catch(""),
  instruction: z.string().catch(""),
  times: z.array(z.string()).catch([]),
  // Any quarter-tablet amount the label asks for — not just ¼, ½, 1, 2.
  dosePerSlot: z.number().min(0.25).max(20).catch(1),
  tabletsInStrip: z.number().int().min(1).max(500).nullish().catch(null),
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

// Phone cameras produce 8MB, 4000px photos; the proxy rejects bodies over ~6MB
// of base64. One canvas pass keeps the print legible and the upload small.
async function imageToDataUrl(file: File): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file);
    const max = 1600;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return fileToDataUrl(file);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return fileToDataUrl(file);
  }
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
  return clean.sort().slice(0, 6);
}

export async function readMedicineImage(file: File, lang: Lang): Promise<MedicineReading> {
  const imageDataUrl = await imageToDataUrl(file);
  const execution = await functions.createExecution({
    functionId: "ai-proxy",
    method: ExecutionMethod.POST,
    body: JSON.stringify({ imageDataUrl, lang }),
    // Without this the execution can be queued, and a queued execution reports
    // an empty body — which looked like "the AI failed" and fell back to OCR.
    async: false,
  });

  if (execution.status !== "completed") {
    throw new Error(`ai-proxy ${execution.status}`);
  }
  if ((execution.responseStatusCode ?? 200) >= 400) {
    throw new Error(`ai-proxy ${execution.responseStatusCode}: ${String(execution.responseBody || "").slice(0, 160)}`);
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
