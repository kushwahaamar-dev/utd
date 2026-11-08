import { guardAi } from "@/lib/server/ai/guard";
import { notConfigured } from "@/lib/server/http";

// Nemotron has no image model, so features.image is always false. The guard
// answers 503 first; the UI reads the flag and says "not set up".
export async function POST(req: Request) {
  return guardAi(req, "image", 3, "image") ?? notConfigured("AI image");
}
