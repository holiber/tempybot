// issueTracker.ts
import { module, procedure } from "./workbench-light";
import { obj, opt, str, arr } from "./schema";

export const issueTracker = module((ctx) => {
  let counter = 0;

  ctx.events.sub("tick", () => {
    counter += 1;
  });

  return {
    api: {
      getTasks: procedure
        .meta({
          description: "Fetch tasks from issue tracker",
          grade: "IssueTrackerG1",
        })
        .input(
          opt(
            obj({
              q: opt(str().desc("Free-text search query")),
            }).desc("Task query parameters")
          )
        )
        .output(
          arr(
            obj({
              id: str().desc("Task identifier"),
              title: str().desc("Task title"),
            })
          ).desc("List of tasks")
        )
        .query(async ({ input }) => {
          return [
            {
              id: String(counter),
              title: input?.q ?? "Task",
            },
          ];
        }),

      ping: procedure
        .meta({
          description: "Ping endpoint (no output schema, like tRPC)",
        })
        .query(async () => {
          return { ok: true, ts: Date.now() };
        }),
    },
  };
});
