import { t } from "spacetimedb/server";
import spacetimedb from "./schema";

// progress is private; this is how a client reads its own rows.
export const myProgress = spacetimedb.view(
  { name: "my_progress", public: true },
  t.array(t.row("ProgressRow", { id: t.u64(), identity: t.identity(), key: t.string(), at: t.timestamp() })),
  (ctx) => [...ctx.db.progress.identity.filter(ctx.sender)],
);
