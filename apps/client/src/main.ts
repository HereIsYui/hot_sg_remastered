import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { boot } from './game/boot';
import { Game, GAME_KEY } from './game/game';
import './style.css';

const pinia = createPinia();
const game = new Game(pinia);

createApp(App).use(pinia).provide(GAME_KEY, game).mount('#app');
void boot(game);
