import { promises as fs } from 'node:fs';
import path from 'node:path';

// On Azure App Service, /home is a persistent mounted share that survives
// restarts and image updates (requires WEBSITES_ENABLE_APP_SERVICE_STORAGE=true).
// Locally we just drop it next to the source.
const DATA_DIR =
  process.env.DATA_DIR ||
  (process.env.WEBSITE_INSTANCE_ID ? '/home/data' : path.join(process.cwd(), 'data'));

const FILE = path.join(DATA_DIR, 'state.json');
const TMP = FILE + '.tmp';
const CACHE_TTL_MS = 1000;

const EMPTY = {
  availableUntil: null, // ISO string, or null when not available
  lastNotifiedAt: null, // ISO string
  updatedAt: null,
};

let cache = null;
let cachedAt = 0;
// Serialise writes so two concurrent requests can't interleave read/modify/write.
let queue = Promise.resolve();

async function readFromDisk() {
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    // Strip a BOM: Node never writes one, but a hand-edited state.json might have one.
    const clean = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
    return { ...EMPTY, ...JSON.parse(clean) };
  } catch (err) {
    if (err.code === 'ENOENT') return { ...EMPTY };
    // A corrupt state file must not take the whole app down - it is one timestamp.
    console.error(`[state] could not read ${FILE}, starting fresh:`, err.message);
    return { ...EMPTY };
  }
}

async function writeToDisk(state) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(TMP, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(TMP, FILE); // atomic, so a crash mid-write can't truncate the file
}

// Re-reads from disk once a second rather than trusting an in-process cache
// forever: if App Service ever runs more than one instance they share /home,
// and a stale cache would let the two disagree about availability.
export async function getState() {
  if (!cache || Date.now() - cachedAt > CACHE_TTL_MS) {
    cache = await readFromDisk();
    cachedAt = Date.now();
  }
  return { ...cache };
}

export async function updateState(patch) {
  queue = queue.then(async () => {
    const current = await readFromDisk();
    cache = { ...current, ...patch, updatedAt: new Date().toISOString() };
    cachedAt = Date.now();
    await writeToDisk(cache);
  });
  await queue;
  return { ...cache };
}

export function dataDir() {
  return DATA_DIR;
}
