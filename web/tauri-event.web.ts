// Browser-mode stand-in for @tauri-apps/api/event. Native menu events do not
// exist in a browser, so listeners are bridged to DOM events named
// "tauri://<event>", which lets scripts and tests trigger the same actions.
export interface WebEvent<T> {
  event: string;
  id: number;
  payload: T;
}

let nextId = 1;

export async function listen<T>(event: string, handler: (event: WebEvent<T>) => void): Promise<() => void> {
  const name = `tauri://${event}`;
  const domHandler = (e: Event) => {
    handler({ event, id: nextId++, payload: (e as CustomEvent<T>).detail });
  };
  window.addEventListener(name, domHandler);
  return () => window.removeEventListener(name, domHandler);
}
