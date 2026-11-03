/**
 * `DialogManager.setParametersInBuyAndUseDlg` for the battlefield commands: the dialogs arm the
 * command they are about to send together with the item gid it consumes; when the buy-and-use
 * popup finishes (`buyGoodsBeforeUse` replies with the bought gid) the same command re-runs.
 */

interface PendingResend {
  gids: number[];
  send: () => void;
}

let pending: PendingResend | null = null;

/** Arms a re-send before a command that may throw `not_enough_goods<gid>`. */
export function armBuyAgain(gids: number[], send: () => void): void {
  pending = { gids, send };
}

/** `buyGoodsBeforeUse` reply: re-run the armed command when the bought gid matches. */
export function consumeBuyAgain(gid: number): boolean {
  if (!pending || !pending.gids.includes(gid)) return false;
  const resend = pending;
  pending = null;
  resend.send();
  return true;
}

/** Drops an armed re-send (the dialog closed or the command succeeded). */
export function clearBuyAgain(): void {
  pending = null;
}
