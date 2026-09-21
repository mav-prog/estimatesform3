// Browser-mode stand-in for @tauri-apps/plugin-dialog. A browser cannot ask
// where to save, so "save" answers with a file name and the fs stand-in turns
// the following write into a download. "open" shows a real file picker and
// answers with the chosen file's name; the core stand-in can then read it.
import { pickFile, rememberFile } from './files.web';

interface DialogFilter {
  name: string;
  extensions: string[];
}

interface SaveDialogOptions {
  defaultPath?: string;
  filters?: DialogFilter[];
  title?: string;
}

interface OpenDialogOptions {
  multiple?: boolean;
  filters?: DialogFilter[];
  title?: string;
}

export async function save(options?: SaveDialogOptions): Promise<string | null> {
  const fromDefault = options?.defaultPath?.split(/[\\/]/).pop();
  if (fromDefault) return fromDefault;
  const ext = options?.filters?.[0]?.extensions?.[0];
  return ext ? `export.${ext}` : 'export';
}

export async function open(options?: OpenDialogOptions): Promise<string | string[] | null> {
  const accept = (options?.filters ?? []).flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',') || '*/*';
  const files = await pickFile(accept, options?.multiple ?? false);
  if (!files) return null;
  const names = files.map(rememberFile);
  return options?.multiple ? names : names[0];
}
