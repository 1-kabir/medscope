// Minimal Sarvam smoke test: one chat completion, printed.
// Reads SARVAM_API_KEY from the environment — never hardcoded, never printed.
import { SarvamAIClient } from "sarvamai";

const apiKey = process.env.SARVAM_API_KEY;
if (!apiKey) {
  console.error("SARVAM_API_KEY is not set. Add it to .env: SARVAM_API_KEY=<your key>");
  process.exit(1);
}

const client = new SarvamAIClient({ apiCredentials: apiKey });

const reply = await client.chat.completions({
  model: "sarvam-105b-conversations",
  messages: [
    { role: "user", content: "Reply with exactly: MedscopeOne is ready." },
  ],
});

console.log(reply.choices[0].message.content);
