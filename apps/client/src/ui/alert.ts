import { reactive } from 'vue';

/** mx.controls.Alert (modal) and the floating `utils.AlertPanel` of BloodWar.as. */

export type AlertButton = 'ok' | 'yes' | 'no' | 'cancel';

export interface AlertItem {
  id: number;
  text: string;
  title: string;
  buttons: AlertButton[];
  resolve: (button: AlertButton) => void;
}

export const alertState = reactive({
  items: [] as AlertItem[],
  /** `Alert.okLabel` etc., set from the client strings at login / game start. */
  labels: { ok: 'OK', yes: 'Yes', no: 'No', cancel: 'Cancel' } as Record<AlertButton, string>,
  panel: { text: '', visible: false },
});

let nextId = 1;
let panelTimer: ReturnType<typeof setTimeout> | undefined;

export function setAlertLabels(labels: Partial<Record<AlertButton, string>>): void {
  Object.assign(alertState.labels, labels);
}

/** `Alert.show(text, title, flags)`; resolves with the clicked button. */
export function showAlert(
  text: string,
  title = '',
  buttons: AlertButton[] = ['ok'],
): Promise<AlertButton> {
  return new Promise((resolve) => {
    alertState.items.push({ id: nextId++, text, title, buttons, resolve });
  });
}

export function closeAlert(id: number, button: AlertButton): void {
  const i = alertState.items.findIndex((a) => a.id === id);
  if (i < 0) return;
  const [item] = alertState.items.splice(i, 1);
  item!.resolve(button);
}

/** `AlertPanel.setText`: shown for three seconds. */
export function showAlertPanel(text: string): void {
  clearTimeout(panelTimer);
  alertState.panel.text = text;
  alertState.panel.visible = true;
  panelTimer = setTimeout(() => (alertState.panel.visible = false), 3000);
}

/**
 * `BloodWar.alert` sends a text to the modal Alert when any character satisfies
 * `!isNaN(Number(ch))`, i.e. digits and whitespace; otherwise to the floating panel.
 */
export function prefersModal(text: string): boolean {
  return [...text].some((ch) => !Number.isNaN(Number(ch)));
}

export function gameAlert(text: string, checkDigits = true): void {
  if (checkDigits && prefersModal(text)) void showAlert(text);
  else showAlertPanel(text);
}
