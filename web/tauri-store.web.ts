// Browser-mode stand-in for @tauri-apps/plugin-store, backed by localStorage
// when the browser allows it and by memory otherwise.
export class LazyStore {
  private readonly storageKey: string;
  private cache: Record<string, unknown> | null = null;

  constructor(name: string) {
    this.storageKey = `protakeoff-store:${name}`;
  }

  private load(): Record<string, unknown> {
    if (this.cache) return this.cache;
    let loaded: Record<string, unknown> = {};
    try {
      loaded = JSON.parse(localStorage.getItem(this.storageKey) || '{}');
    } catch {
      loaded = {};
    }
    this.cache = loaded;
    return loaded;
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.load()[key] as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.load()[key] = value;
  }

  async save(): Promise<void> {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.load()));
    } catch {
      // Storage unavailable; values stay in memory for this page.
    }
  }
}
