import Link from "next/link";
import { cx } from "@/components/ui/cx";

export type LiveRoom = { id: string; title: string; players: number; href?: string };
export type LiveLeader = { name: string; points: number };

export type LiveNowLabels = {
  rooms: string;
  leaderboard: string;
  lobby: string;
  points: string;
  players: (count: number) => string;
};

type LiveNowProps = {
  rooms: readonly LiveRoom[];
  leaders: readonly LiveLeader[];
  labels: LiveNowLabels;
  lobbyHref: string;
  locale: string;
  className?: string;
};

/** Rooms and a leaderboard side by side. It takes plain rows, so a live subscription can feed it later. */
export function LiveNow({ rooms, leaders, labels, lobbyHref, locale, className }: LiveNowProps) {
  const number = new Intl.NumberFormat(locale);
  return (
    <div className={cx("grid gap-x-8 gap-y-8 min-[520px]:grid-cols-2", className)}>
      <div>
        <h3 className="font-ui text-[11px] font-medium uppercase tracking-[0.1em] text-muted">{labels.rooms}</h3>
        <ul className="mt-3 divide-y divide-rule border-y border-rule">
          {rooms.map((room) => (
            <li key={room.id} className="flex items-center gap-3 py-2.5 text-[14px]">
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-pcb [animation:led-blink_2.4s_ease-in-out_infinite]" />
              <span className="min-w-0 flex-1 truncate">
                {room.href ? (
                  <Link href={room.href} className="no-underline hover:underline">
                    {room.title}
                  </Link>
                ) : (
                  room.title
                )}
              </span>
              <span className="shrink-0 font-ui text-xs tabular-nums text-muted">{labels.players(room.players)}</span>
            </li>
          ))}
        </ul>
        <Link href={lobbyHref} className="mt-3 inline-flex min-h-8 items-center gap-1 text-[14px] font-medium no-underline hover:underline">
          {labels.lobby}
          <span aria-hidden="true">→</span>
        </Link>
      </div>
      <div>
        <h3 className="font-ui text-[11px] font-medium uppercase tracking-[0.1em] text-muted">{labels.leaderboard}</h3>
        <ol className="mt-3 divide-y divide-rule border-y border-rule">
          {leaders.map((leader, i) => (
            <li key={leader.name} className="flex items-center gap-3 py-2.5 text-[14px]">
              <span aria-hidden="true" className="w-4 shrink-0 font-ui text-xs tabular-nums text-muted">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">{leader.name}</span>
              <span className="shrink-0 font-ui text-xs tabular-nums text-muted">
                {number.format(leader.points)} {labels.points}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
