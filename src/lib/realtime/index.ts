// iynk Together on the client. Import from here only.

export { RoomProvider, useIdentity, useRoom, useTogether, type Together } from "./provider";
export { createRoom, parseRoomInput, roomLink, withRoom } from "./config";
export { useRoomProbe, type ProbeResult } from "./probe";
export { isHydrating } from "./store-sync";
export { isRoomId, MAX_CHAT_LENGTH, MAX_NAME_LENGTH, ROLES } from "./protocol";
export { PEER_COLORS, saveIdentity, type Identity } from "./identity";
export type { ChatMsg, CursorPoint, Peer, Role, RoomApi, RoomEnd, RoomStatus, SystemEvent } from "./types";
