// Browser-mode stand-in for @tauri-apps/plugin-fs. Only writeFile is really
// used outside the storage layer (which has its own stand-in): it hands the
// bytes to the browser as a download named after the requested path.
export const BaseDirectory = { AppLocalData: 0 } as const;

export async function writeFile(path: string, data: Uint8Array | ArrayBuffer, _options?: unknown): Promise<void> {
  const name = path.split(/[\\/]/).pop() || 'download';
  const bytes = data instanceof Uint8Array ? data.slice().buffer : data;
  const url = URL.createObjectURL(new Blob([bytes]));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function exists(_path: string, _options?: unknown): Promise<boolean> {
  return false;
}

export async function mkdir(_path: string, _options?: unknown): Promise<void> {
  return;
}

export async function remove(_path: string, _options?: unknown): Promise<void> {
  return;
}

export async function readFile(_path: string, _options?: unknown): Promise<Uint8Array> {
  throw new Error('readFile is not available in web mode');
}
