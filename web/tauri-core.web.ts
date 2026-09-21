// Browser-mode stand-in for @tauri-apps/api/core.
export async function invoke<T>(cmd: string, _args?: Record<string, unknown>): Promise<T> {
  if (cmd === 'get_startup_args') return [] as unknown as T;
  throw new Error(`Tauri command "${cmd}" is not available in web mode`);
}
