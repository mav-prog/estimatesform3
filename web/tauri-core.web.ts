// Browser-mode stand-in for @tauri-apps/api/core.
import { pickedFile } from './files.web';

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (cmd === 'get_startup_args') return [] as unknown as T;
  if (cmd === 'read_file_binary') {
    const file = pickedFile(String(args?.path ?? ''));
    if (!file) throw new Error(`No picked file named ${String(args?.path)}`);
    return Array.from(new Uint8Array(await file.arrayBuffer())) as unknown as T;
  }
  throw new Error(`Tauri command "${cmd}" is not available in web mode`);
}
