import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3001;

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/api/nonexistent-endpoint-xyz") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found (intentional fixture)" }));
    return;
  }
  if (url === "/" || url === "/index.html") {
    const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf-8");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }
  // Any other static file -> 404 so broken image stays broken
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => console.log(`[demo-app] http://localhost:${PORT}`));
