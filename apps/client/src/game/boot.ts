import { loadAssetIndex, preloadImages } from '../assets/registry';
import { loadStrings } from '../i18n';
import type { Game } from './game';

/** Skins of the first screens, loaded behind the progress screen (BloodWarDownloadProgressBar). */
const PRELOAD = [
  'images/board_login.jpg',
  'images/button_red.png',
  'images/button_red_hl.png',
  'images/button_red_pr.png',
  'images/button_selected.png',
  'images/button_unselected.png',
  'images/button_unselected_over.png',
  'swf/UIParts.swf#board_listdown',
  'swf/UIParts.swf#board_listup',
  'images/board_popup.png',
  'images/sanguo_worldmap.png',
  'images/leftboard_new.jpg',
  'images/board_topbar.png',
  'images/chatbar.png',
];

export async function boot(game: Game): Promise<void> {
  game.session.screen = 'loading';
  await Promise.all([loadAssetIndex(), loadStrings()]);
  await preloadImages(PRELOAD, (done, total) => {
    game.session.loadProgress = total ? done / total : 1;
  });
  await game.showLogin();
}
