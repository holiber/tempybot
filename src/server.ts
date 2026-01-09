import http from "node:http";

function authHtml(): string {
  // Keep it self-contained and deterministic (no external assets).
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Auth</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #0b1220;
        --panel: #111a2e;
        --text: #e6eefc;
        --muted: #a9b7d1;
        --accent: #7c5cff;
        --border: #23314f;
      }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Apple Color Emoji",
          "Segoe UI Emoji";
        background: radial-gradient(1200px 800px at 20% 10%, #1b2a56 0%, var(--bg) 55%) fixed;
        color: var(--text);
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      .card {
        width: min(520px, 92vw);
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02));
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 16px;
        padding: 20px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
        backdrop-filter: blur(8px);
      }
      h1 {
        margin: 0 0 6px;
        font-size: 22px;
        letter-spacing: 0.2px;
      }
      p {
        margin: 0 0 16px;
        color: var(--muted);
      }
      .row {
        display: grid;
        gap: 10px;
        margin: 10px 0;
      }
      label {
        display: grid;
        gap: 6px;
        font-size: 14px;
        color: var(--muted);
      }
      input[type="text"],
      input[type="password"] {
        width: 100%;
        box-sizing: border-box;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(0, 0, 0, 0.25);
        color: var(--text);
        outline: none;
      }
      input[type="text"]:focus,
      input[type="password"]:focus {
        border-color: rgba(124, 92, 255, 0.7);
        box-shadow: 0 0 0 4px rgba(124, 92, 255, 0.18);
      }
      .inline {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 12px 0 16px;
        color: var(--muted);
        font-size: 14px;
        user-select: none;
      }
      .inline input[type="checkbox"] {
        width: 18px;
        height: 18px;
        accent-color: var(--accent);
      }
      button {
        width: 100%;
        border: 0;
        border-radius: 12px;
        padding: 10px 12px;
        background: linear-gradient(135deg, var(--accent), #33c3ff);
        color: white;
        font-weight: 600;
        cursor: pointer;
      }
      button:active {
        transform: translateY(1px);
      }
      .success {
        display: none;
        text-align: center;
        padding: 22px 12px;
      }
      .success h2 {
        margin: 0;
        font-size: 26px;
        letter-spacing: 0.2px;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <section data-testid="auth-form">
        <h1>Sign in</h1>
        <p>Use any credentials. This is a scenario demo.</p>
        <form id="auth-form">
          <div class="row">
            <label for="login-input">
              Login
              <input id="login-input" data-testid="login-input" name="login" type="text" autocomplete="username" />
            </label>
            <label for="password-input">
              Password
              <input
                id="password-input"
                data-testid="password-input"
                name="password"
                type="password"
                autocomplete="current-password"
              />
            </label>
          </div>
          <label class="inline" for="remember-checkbox">
            <input id="remember-checkbox" data-testid="remember-checkbox" name="remember" type="checkbox" />
            remember me
          </label>
          <button data-testid="login-button" type="submit">Login</button>
        </form>
      </section>

      <section class="success" data-testid="greetings">
        <h2 data-testid="greetings-title">Greetings!</h2>
      </section>
    </main>

    <script>
      const formSection = document.querySelector('[data-testid="auth-form"]');
      const form = document.getElementById('auth-form');
      const success = document.querySelector('[data-testid="greetings"]');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        formSection.style.display = 'none';
        success.style.display = 'block';
      });
    </script>
  </body>
</html>`;
}

function helloHtml(): string {
  return `<html><body><h1 data-testid="title">Hello, world!</h1></body></html>`;
}

export type StartedServer = {
  url: string;
  close: () => Promise<void>;
};

export async function startServer(): Promise<StartedServer> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");

    if (url.pathname === "/auth") {
      res.end(authHtml());
      return;
    }

    res.end(helloHtml());
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("Failed to get server address");
  }

  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

