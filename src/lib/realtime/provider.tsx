"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTable } from "spacetimedb/react";
import type { LabKind, LabStore } from "@/components/dock/types";
import type { Locale } from "@/i18n/config";
import { useLocale } from "@/i18n/client";
import { progressPrefix, useSaved } from "@/lib/progress";
import {
  tables,
  useChat,
  useCursorEvents,
  usePlayers,
  usePoseEvents,
  useRoom as useRoomRow,
  useRoomActions,
  useRoomMembers,
  useRoomSnapshot,
  useStdb,
  useStdbActions,
  useTranslations,
  type StdbActions,
  type StdbStatus,
} from "@/lib/stdb";
import { setTelemetryContext, track } from "@/lib/telemetry";
import { pageLink, pageScope, ROOM_PARAM } from "./config";
import { getIdentity, getServerIdentity, subscribeIdentity, type Identity } from "./identity";
import { NEW_ROOM, parseRoomParam } from "./protocol";
import { RoomClient, type RoomBackend, type RoomState } from "./room";
import { attachStore } from "./store-sync";
import type { RoomApi, RoomEnd } from "./types";

// ?room= in the address bar is the only room state that outlives a page: the
// room starts when it appears and ends when it goes. Pages stay static.
// ?room=new means "open a fresh room here"; the page swaps in the code the module picks.

const locationListeners = new Set<() => void>();

function subscribeLocation(listener: () => void) {
  locationListeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    locationListeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

function getRoomParam(): string | null {
  return parseRoomParam(new URLSearchParams(window.location.search).get(ROOM_PARAM));
}

const getServerRoomParam = () => null;

function setRoomParam(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set(ROOM_PARAM, id);
  else url.searchParams.delete(ROOM_PARAM);
  window.history.replaceState(null, "", url);
  for (const listener of [...locationListeners]) listener();
}

export type Together = {
  lab: LabKind;
  itemId: string;
  /** The room in the address bar, joined or not. */
  roomId: string | null;
  identity: Identity | null;
  /** The connection to the realtime database; rooms need it to be online. */
  connection: StdbStatus;
  room: RoomApi | null;
  /** Why the last room ended, until you start or join another. */
  ended: RoomEnd | null;
  /** Opens a fresh room on this page, with you as host. */
  start(): void;
  join(id: string): void;
  leave(): void;
};

const TogetherContext = createContext<Together | null>(null);

/** The room this page is in, or null. */
export function useRoom(): RoomApi | null {
  return useContext(TogetherContext)?.room ?? null;
}

/** The name and colour this browser uses in rooms; null until chosen (and on the server). */
export function useIdentity(): Identity | null {
  return useSyncExternalStore(subscribeIdentity, getIdentity, getServerIdentity);
}

/** Everything the Together panel needs, room or not; null outside a RoomProvider. */
export function useTogether(): Together | null {
  return useContext(TogetherContext);
}

const noopSubscribe = () => () => {};

function toApi(client: RoomClient, state: RoomState): RoomApi {
  return {
    id: state.id,
    link: state.link,
    you: state.you,
    peers: state.peers,
    hostId: state.hostId,
    connected: state.status === "live",
    messages: state.messages,
    status: state.status,
    ended: state.ended,
    batonHolder: state.batonHolder,
    batonDenied: state.batonDenied,
    chat: (text, kind, options) => client.chat(text, kind, options),
    setPresence: (p) => client.setPresence(p),
    onPose: (cb) => client.onPose(cb),
    sendPose: (pose) => client.sendPose(pose),
    leave: () => client.leave(),
    passBaton: (to) => client.passBaton(to),
    requestBaton: () => client.requestBaton(),
    rename: (name) => client.rename(name),
    kick: (id) => client.kick(id),
    sendCursor: (point) => client.sendCursor(point),
    onCursor: (cb) => client.onCursor(cb),
  };
}

/** A fixed backend that always calls the connection's current actions, so a client outlives a reconnect. */
function useStableBackend(): RoomBackend {
  const actions = useStdbActions();
  const latest = useRef<StdbActions>(actions);
  useEffect(() => {
    latest.current = actions;
  });
  return useMemo(
    () =>
      new Proxy({} as RoomBackend, {
        get: (_, name: string) => (...args: unknown[]) => (latest.current as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args),
      }),
    [],
  );
}

const NONE = "\u0000none";

/** Makes a room on the module and reports the code it picked, which it reads back from our new membership. */
function RoomCreator({
  lab,
  itemId,
  identity,
  lang,
  onCode,
  onError,
}: {
  lab: LabKind;
  itemId: string;
  identity: Identity;
  lang: string;
  onCode: (code: string) => void;
  onError: (error: unknown) => void;
}) {
  const stdb = useStdb();
  const actions = useStdbActions();
  const [rows, ready] = useTable(tables.roomMember.where((m) => m.identity.eq(stdb.identity ?? (NONE as never))), { enabled: !!stdb.identity });
  const before = useRef<Set<string> | null>(null);
  const online = stdb.status === "online" && ready;

  useEffect(() => {
    if (!online || before.current) return;
    before.current = new Set(rows.map((row) => row.roomCode));
    actions
      .setProfile({ name: identity.name, color: identity.color, lang })
      .then(() => actions.createRoom(lab, itemId))
      .catch(onError);
  }, [online, rows, actions, identity, lang, lab, itemId, onError]);

  useEffect(() => {
    if (!before.current) return;
    const fresh = rows.find((row) => !before.current!.has(row.roomCode));
    if (fresh) onCode(fresh.roomCode);
  }, [rows, onCode]);

  return null;
}

/** Feeds one room's rows, cursor frames and pose frames to its client. Mounted only while a room is open. */
function RoomFeed({ client, code, locale }: { client: RoomClient; code: string; locale: Locale }) {
  const { status } = useStdb();
  const { room, ready: roomReady } = useRoomRow(code);
  const { members, ready: membersReady } = useRoomMembers(code);
  const { actions, ready: actionsReady } = useRoomActions(code);
  const { snapshot, ready: snapshotReady } = useRoomSnapshot(code);
  const { messages, ready: chatReady } = useChat(code);
  const { byMessage } = useTranslations(code);
  const { rows: players } = usePlayers();
  const langs = useMemo(() => new Map(players.map((player) => [player.identity.toHexString(), player.lang])), [players]);
  const ready = roomReady && membersReady && actionsReady && snapshotReady && chatReady;

  useEffect(() => {
    client.ingest({ online: status === "online", ready, room, members, actions, snapshot, chat: messages, translations: byMessage, langs });
  }, [client, status, ready, room, members, actions, snapshot, messages, byMessage, langs]);

  useEffect(() => {
    client.translateFor(locale);
  }, [client, locale]);

  useCursorEvents(code, (event) => client.cursorEvent(event.from.toHexString(), event.x, event.y));
  usePoseEvents(code, (event) => client.poseEvent(event.from.toHexString(), event));
  return null;
}

/**
 * Joins the room named by ?room= and keeps `store` in step with it.
 * Wrap a lab page (figure, controls and LabDock) in one RoomProvider.
 */
export function RoomProvider<S, A extends { type: string }>({
  lab,
  itemId,
  store,
  children,
}: {
  lab: LabKind;
  itemId: string;
  store: LabStore<S, A>;
  children: ReactNode;
}) {
  const locale = useLocale();
  const param = useSyncExternalStore(subscribeLocation, getRoomParam, getServerRoomParam);
  const identity = useIdentity();
  const saved = useSaved();
  const stdb = useStdb();
  const backend = useStableBackend();
  const [client, setClient] = useState<RoomClient | null>(null);
  const [lastEnded, setLastEnded] = useState<RoomEnd | null>(null);

  const code = param && param !== NEW_ROOM ? param : null;
  const selfId = stdb.identityHex;

  const prefix = progressPrefix.item(lab, itemId);
  const doneKeys = useMemo(() => Object.keys(saved.done).filter((key) => key.startsWith(prefix)).sort(), [saved, prefix]);
  const doneSignature = doneKeys.join("|");

  // The join reads these when it happens; later changes go out as presence.
  const latest = useRef({ identity, doneKeys, locale });
  useEffect(() => {
    latest.current = { identity, doneKeys, locale };
  });

  // Join the room in the address bar once you have a name and the connection knows who you are.
  const named = identity !== null;
  useEffect(() => {
    const { identity: me, doneKeys: done, locale: lang } = latest.current;
    if (!code || !me || !selfId) return;
    const next = new RoomClient({ id: code, link: pageLink(code), selfId, me: { name: me.name, color: me.color, lang, done }, lab, itemId, backend });
    const detach = attachStore(store, lab, next, { scope: pageScope(window.location.pathname) });
    let joined = false;
    const offStatus = next.subscribe(() => {
      const { ended, status, peers } = next.getState();
      if (status === "live" && !joined) {
        joined = true;
        setTelemetryContext({ room: code });
        track("room.join", { peers: peers.length + 1 });
      }
      // The room ended without us leaving (removed, full, gone): drop ?room= so a reload doesn't rejoin.
      if (!ended || ended === "left") return;
      setLastEnded(ended);
      setRoomParam(null);
    });
    setClient(next);
    return () => {
      offStatus();
      detach();
      next.leave();
      setTelemetryContext({ room: undefined });
      setClient((current) => (current === next ? null : current));
    };
  }, [code, named, selfId, lab, itemId, store, backend]);

  const name = identity?.name;
  const color = identity?.color;
  useEffect(() => {
    if (!client || !name || !color) return;
    if (client.getState().you.name !== name) client.rename(name);
    void backend.setProfile({ name, color, lang: locale }).catch(() => {});
  }, [client, name, color, locale, backend]);

  useEffect(() => {
    if (client && client.getState().you.done.join("|") !== doneSignature) client.shareDone(doneSignature ? doneSignature.split("|") : []);
  }, [client, doneSignature]);

  const state = useSyncExternalStore(
    client?.subscribe ?? noopSubscribe,
    () => client?.getState() ?? null,
    () => null,
  );

  const room = useMemo(() => (client && state ? toApi(client, state) : null), [client, state]);

  const value = useMemo<Together>(
    () => ({
      lab,
      itemId,
      roomId: param,
      identity,
      connection: stdb.status,
      room,
      ended: lastEnded,
      start: () => {
        setLastEnded(null);
        setRoomParam(NEW_ROOM);
      },
      join: (id) => {
        const clean = parseRoomParam(id);
        if (!clean || clean === NEW_ROOM) return;
        setLastEnded(null);
        setRoomParam(clean);
      },
      leave: () => {
        client?.leave();
        setRoomParam(null);
      },
    }),
    [lab, itemId, param, identity, stdb.status, room, lastEnded, client],
  );

  const failCreate = useCallback(() => {
    setLastEnded("error");
    setRoomParam(null);
  }, []);

  return (
    <TogetherContext.Provider value={value}>
      {param === NEW_ROOM && identity ? (
        <RoomCreator lab={lab} itemId={itemId} identity={identity} lang={locale} onCode={setRoomParam} onError={failCreate} />
      ) : null}
      {client && code ? <RoomFeed client={client} code={code} locale={locale} /> : null}
      {children}
    </TogetherContext.Provider>
  );
}
