import { expect, test } from "@playwright/test";
import { startServer } from "../../src/server.js";

test.describe("hello page (e2e)", () => {
  let server: Awaited<ReturnType<typeof startServer>>;

  test.beforeAll(async () => {
    server = await startServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  test("renders greeting", async ({ page }) => {
    await page.goto(server.url);
    await expect(page.getByTestId("title")).toHaveText("Hello, world!");
  });
});

