import { guardAi } from "@/lib/server/ai/guard";
import { notConfigured } from "@/lib/server/http";

// Nemotron has no speech-to-text model, so features.voice is always false. The
// guard answers 503 first; the UI reads the flag and says "not set up".
export async function POST(req: Request) {
  return guardAi(req, "transcribe", 20, "voice") ?? notConfigured("AI voice");
}
