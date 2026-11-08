// The /api/ai/* shapes the partner uses, from the server's AI types module
// (types only, so nothing server-side reaches the client).

export type {
  ApiErrorBody,
  ChatEvent,
  ChatMessage,
  ChatPeer,
  ChatRequest,
  ImageResponse,
  StoryRequest,
  StoryResponse,
  TranscribeResponse,
} from "@/lib/server/ai/types";

import type { StoryEvent as ServerStoryEvent } from "@/lib/server/ai/types";

/** What a session-log line is about; the story route takes any string here. */
export type StoryEventKind = "action" | "chat" | "ai" | "fault" | "pass" | "join" | "help";

export type StoryEvent = ServerStoryEvent & { kind: StoryEventKind };
