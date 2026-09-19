/**
 * Saved state, so a reload does not throw away the daily.
 *
 * Everything goes through one small store so that a browser with storage
 * blocked (private windows, some embedded views) degrades to "nothing is
 * remembered" rather than crashing.
 */

const PREFIX = 'tumblers:';

/**
 * @param {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null} [backend]
 *   Defaults to localStorage when it is usable.
 */
export function createStore(backend = defaultBackend()) {
  const read = (key) => {
    if (!backend) return null;
    try {
      const raw = backend.getItem(PREFIX + key);
      return raw == null ? null : JSON.parse(raw);
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    if (!backend) return false;
    try {
      backend.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  };
  const remove = (key) => {
    if (!backend) return;
    try {
      backend.removeItem(PREFIX + key);
    } catch {
      // Nothing to do: a store we cannot clear is a store we cannot read either.
    }
  };

  return {
    /** Progress on one day's lock, keyed by its number. */
    loadDaily: (number) => read(`daily:${number}`),
    saveDaily: (number, progress) => write(`daily:${number}`, progress),
    clearDaily: (number) => remove(`daily:${number}`),
    /** Whether the how-to-play card has been shown. */
    hasSeenHelp: () => read('seen-help') === true,
    markHelpSeen: () => write('seen-help', true),
  };
}

function defaultBackend() {
  try {
    const storage = globalThis.localStorage;
    // A storage object can exist and still throw on use.
    storage.getItem(`${PREFIX}probe`);
    return storage;
  } catch {
    return null;
  }
}
