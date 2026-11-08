import spacetimedb from "./schema";

// Client visibility filter: a subscription only ever sees the rows this allows, whatever SQL the client sends.
// A job holds the goal and its context, so it is its owner's alone. (Steps and proposals go through views.)
export const agentJobOwn = spacetimedb.clientVisibilityFilter.sql("SELECT * FROM agent_job WHERE owner = :sender");
