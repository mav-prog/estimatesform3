// Files picked in the browser, so the desktop "open a file" flow works in web mode:
// the dialog stand-in returns a file name, and the core stand-in reads its bytes.
const picked = new Map<string, File>();

export function rememberFile(file: File): string {
  picked.set(file.name, file);
  return file.name;
}

export function pickedFile(name: string): File | undefined {
  return picked.get(name);
}

/** Show a native file picker and resolve with the chosen file, or null if dismissed. */
export function pickFile(accept: string, multiple = false): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    input.setAttribute('data-web-open-dialog', '');
    let settled = false;
    const finish = (files: File[] | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish(input.files && input.files.length ? Array.from(input.files) : null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}
