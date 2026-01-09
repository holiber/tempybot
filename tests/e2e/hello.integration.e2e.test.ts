import { expect, test } from "@playwright/test";
import { startServer } from "../../src/server";

test.describe("hello page (e2e integration) @integration", () => {
  let server: Awaited<ReturnType<typeof startServer>>;

  test.beforeAll(async () => {
    // In a real project this suite would validate real external integrations
    // (and therefore require secrets + gated CI). Here it's a minimal template.
    server = await startServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  test("renders greeting @integration", async ({ page }) => {
    await page.goto(server.url);
    await expect(page.getByTestId("title")).toHaveText("Hello, world!");
  });
});

