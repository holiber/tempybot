import { expect, test } from "vitest";
import { startWebSession, userSleep } from "../../test-utils";

test("web scenario: sees hello world", async () => {
  const web = await startWebSession();
  try {
    await web.page.setContent(`<h1 data-testid="title">Hello, world!</h1>`);
    // Give the video recorder enough time to capture at least a few frames.
    // Extremely short sessions can result in no output video on some runners.
    await web.page.getByTestId("title").hover();
    await userSleep(400);
    const title = await web.page.getByTestId("title").textContent();
    expect(title).toBe("Hello, world!");
  } finally {
    await web.close();
  }
});

