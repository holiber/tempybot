import { expect, test } from "vitest";
import { startWebSession, userSleep } from "../../test-utils.js";

test("web scenario: sees hello world", async () => {
  const web = await startWebSession();
  try {
    await web.page.setContent(`<h1 data-testid="title">Hello, world!</h1>`);
    await userSleep(50);
    const title = await web.page.getByTestId("title").textContent();
    expect(title).toBe("Hello, world!");
  } finally {
    await web.close();
  }
});

