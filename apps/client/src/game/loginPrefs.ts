/** `LocalLoginUtils`: remembered passport / password (Flash SharedObject -> localStorage). */

export interface LoginPrefs {
  saveUsername: boolean;
  savePassword: boolean;
  username: string;
  password: string;
}

const KEY = 'hot.login';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadLoginPrefs(): LoginPrefs {
  const empty = { saveUsername: false, savePassword: false, username: '', password: '' };
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return empty;
    const p = JSON.parse(raw) as Partial<LoginPrefs>;
    return {
      saveUsername: p.saveUsername === true,
      savePassword: p.savePassword === true,
      username: p.saveUsername === true ? String(p.username ?? '') : '',
      password: p.savePassword === true ? String(p.password ?? '') : '',
    };
  } catch {
    return empty;
  }
}

/** `LoginDialog.saveInput`: only the checked fields are kept. */
export function saveLoginPrefs(prefs: LoginPrefs): void {
  storage()?.setItem(
    KEY,
    JSON.stringify({
      saveUsername: prefs.saveUsername,
      savePassword: prefs.savePassword,
      username: prefs.saveUsername ? prefs.username : '',
      password: prefs.savePassword ? prefs.password : '',
    }),
  );
}
