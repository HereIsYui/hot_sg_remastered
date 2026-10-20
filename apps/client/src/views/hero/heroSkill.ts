import { computed, onUnmounted, ref, watch, type Ref } from 'vue';
import { useGame } from '../../game/game';
import type { HeroDetail } from '../../game/hero';
import { NO_SKILL, parseHeroSkill, type HeroSkillState } from '../../game/skill';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { gameAlert, showAlert } from '../../ui/alert';

type Row = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v), 10) || 0;
const asRow = (v: unknown): Row | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null;

/**
 * The skill half of `HeroDetailDialog`: the shown hero's skill and worn book, 领悟, and the
 * skill slot's 装备 / 卸下.
 */
export function useHeroSkill(hero: Ref<HeroDetail | null>) {
  const game = useGame();
  const city = useCityStore();

  const state = ref<HeroSkillState>(NO_SKILL);
  /** The skill slot's 装备 opened ChangeArmorDialog for the books of this skill. */
  const choosing = ref<number | null>(null);
  const hid = computed(() => hero.value?.hid ?? 0);

  function send(command: string, ...args: (number | string)[]) {
    game.sendGlobalCommand('hero', command, args);
  }

  watch(
    hid,
    (id) => {
      state.value = NO_SKILL;
      choosing.value = null;
      if (id) send('getHeroSkill', id);
    },
    { immediate: true },
  );

  const unregister = game.addGlobalReceiver('hero', (command, data) => {
    const d = Array.isArray(data) ? (data as unknown[]) : [];
    if (int(d[0]) !== hid.value) return;
    switch (command) {
      case 'getHeroSkill':
        state.value = parseHeroSkill(d.slice(1));
        break;
      case 'resetHeroSkill': {
        const skill = asRow(Array.isArray(d[1]) ? d[1][0] : null) ?? {};
        state.value = {
          ...state.value,
          skillId: int(skill.skill),
          name: String(skill.name ?? ''),
          description: String(skill.description ?? ''),
          worn: null,
        };
        break;
      }
      case 'setHeroBook': {
        const book = asRow(Array.isArray(d[2]) ? d[2][0] : null);
        state.value = { ...state.value, bookId: int(book?.id), worn: book };
        game.onLoadHeroList(d[1]);
        break;
      }
      case 'moveHeroBook':
        state.value = { ...state.value, worn: null };
        game.onLoadHeroList(d[1]);
        break;
    }
  });
  onUnmounted(unregister);

  /** `onDigestSkill`: 领悟 a new skill for a 技能领悟书. */
  async function onDigest() {
    const h = hero.value;
    if (!h) return;
    if (state.value.worn) {
      void showAlert(i18n('HeroSkillEquiped'));
    } else if (!h.healthy) {
      gameAlert(i18n('Hero_HeroArmorPanelSrc_23'));
    } else if (
      (await showAlert(i18n('Hero_HeroDetailDialogSrc_19_1'), '', ['yes', 'no'])) === 'yes'
    ) {
      game.sendGlobalCommand('hero', 'resetHeroSkill', [city.cid, h.hid]);
    }
  }

  /** The skill slot's menu: `onClickEquipSkill` / `onClickmoveHeroBook`. */
  function onSlotAction(action: string) {
    if (action === 'equip') {
      if (state.value.worn) void showAlert(i18n('HeroSkillEquiped'));
      else choosing.value = state.value.skillId;
    } else if (action === 'offload') {
      send('moveHeroBook', hid.value, state.value.bookId, city.cid);
    }
  }

  /** `ChangeArmorDialog.onClickSkill` */
  function wear(id: number) {
    send('setHeroBook', hid.value, id, city.cid);
  }

  return { state, choosing, onDigest, onSlotAction, wear };
}

export type HeroSkillControls = ReturnType<typeof useHeroSkill>;
