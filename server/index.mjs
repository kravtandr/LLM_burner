import { resolve } from 'node:path';
import { Store } from './store.mjs';
import { Runner } from './runner.mjs';
import { createApp } from './app.mjs';

process.umask(0o077);
const store = new Store(resolve(process.env.DATA_DIR || 'data', 'burner.sqlite'));
const runner = new Runner(store);
const port = Number(process.env.PORT || 4310);
const server = createApp({ store, runner }).listen(port, '127.0.0.1', () => console.log(`LLM Burner: http://127.0.0.1:${port}`));
let closing = false;
async function shutdown() {
  if (closing) return; closing = true;
  await runner.shutdown(); server.closeAllConnections();
  server.close(() => { store.close(); process.exit(0); });
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
