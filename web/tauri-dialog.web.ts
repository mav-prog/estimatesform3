// Browser-mode stand-in for @tauri-apps/plugin-dialog. A browser cannot ask
// where to save, so "save" answers with a file name and the fs stand-in turns
// the following write into a download. "open" always reports a cancel.
interface DialogFilter {
  name: string;
  extensions: string[];
}

interface SaveDialogOptions {
  defaultPath?: string;
  filters?: DialogFilter[];
  title?: string;
}

export async function save(options?: SaveDialogOptions): Promise<string | null> {
  const fromDefault = options?.defaultPath?.split(/[\\/]/).pop();
  if (fromDefault) return fromDefault;
  const ext = options?.filters?.[0]?.extensions?.[0];
  return ext ? `export.${ext}` : 'export';
}

export async function open(_options?: unknown): Promise<string | string[] | null> {
  return null;
}
