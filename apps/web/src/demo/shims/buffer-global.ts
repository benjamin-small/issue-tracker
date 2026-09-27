// Node's global Buffer, used by a few server helpers (cursor encoding, webhook signing).
import { Buffer } from 'buffer';

(globalThis as { Buffer?: unknown }).Buffer ??= Buffer;
