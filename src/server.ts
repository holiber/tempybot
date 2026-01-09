import http from "node:http";

export type StartedServer = {
  url: string;
  close: () => Promise<void>;
};

export async function startServer(): Promise<StartedServer> {
  const server = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(`<html><body><h1 data-testid="title">Hello, world!</h1></body></html>`);
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

