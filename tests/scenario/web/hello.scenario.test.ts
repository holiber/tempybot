import { expect, test } from "vitest";
import { startServer } from "../../../src/server.js";
import { startWebSession, userSleep, userType } from "../../test-utils.js";

test("web scenario: logs in and sees greetings", async () => {
  const server = await startServer();
  const web = await startWebSession();
  try {
    await web.page.goto(`${server.url}/auth`);

    await web.page.getByTestId("auth-form").waitFor({ state: "visible" });
    expect(await web.page.getByTestId("auth-form").isVisible()).toBe(true);

    // Give the recording and userlike mode a real "settle" moment.
    await userSleep();

    await userType(web.page, '[data-testid="login-input"]', "hello word");
    await userType(web.page, '[data-testid="password-input"]', "hello word");
    await userSleep(600);

    await web.page.getByTestId("remember-checkbox").check();
    await userSleep(600);

    await web.page.getByTestId("login-button").click();

    await web.page.getByTestId("auth-form").waitFor({ state: "hidden" });
    await web.page.getByTestId("greetings-title").waitFor({ state: "visible" });

    expect(await web.page.getByTestId("auth-form").isVisible()).toBe(false);
    expect(await web.page.getByTestId("greetings-title").textContent()).toBe("Greetings!");

    // Give the video recorder enough time to capture at least a few frames.
    await web.page.getByTestId("greetings-title").hover();
    await userSleep(1200);
  } finally {
    await web.close();
    // Delay after "stop recording" signal (context close finalizes the video).
    await userSleep();
    await server.close();
  }
});

