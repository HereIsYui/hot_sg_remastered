<script setup lang="ts">
import { computed } from 'vue';
import { assets } from '../../assets/registry';
import type { AchiveGuideView } from '../../game/achivement';
import { i18n } from '../../i18n';
import FxImage from '../../ui/FxImage.vue';

/**
 * Achivement/AchieveGuide (454x250): the 成就指南 detail of one achievement — image, title, the
 * player count, and one of three bodies per the achievement type: 1 实时成就 shows the todo
 * text, 2 累积成就 the progress bar with `user/target` (or the % form over 1000), 3 分类成就 the
 * ◆ goal list with the done goals green (`setAchieveItem`, AS3 995-1067).
 */
const props = defineProps<{ view: AchiveGuideView | null }>();

const goals = computed(() => props.view?.goals ?? []);
const image = computed(() => (props.view ? assets.url(props.view.imagePath) : ''));
</script>

<template>
  <div v-if="view" class="achieve-guide">
    <FxImage class="title-bk" source="images/achievement/titlebk.png" />
    <div class="frame">
      <img class="pic" :src="image" alt="" draggable="false" />
    </div>
    <div class="title">{{ view.name }}</div>
    <div class="guide-label">{{ i18n('Achivement_AchieveGuide_2') }}</div>
    <div class="content">
      <!-- type 1: the todo text -->
      <div v-if="view.type === 1" class="todo">{{ view.todo }}</div>
      <!-- type 2: the cumulative progress -->
      <div v-else-if="view.type === 2" class="todo">
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: `${view.progressRatio * 100}%` }" />
          <span class="progress-label">{{ view.progressLabel }}</span>
        </div>
        <div class="body">{{ view.todo }}</div>
      </div>
      <!-- type 3: the goal list -->
      <div v-else class="goals">
        <div v-for="(goal, i) in goals" :key="i" class="goal" :class="{ done: goal.isDone }">
          ◆ {{ goal.content }}
        </div>
      </div>
    </div>
    <div class="user-count-label">{{ i18n('Achivement_AchieveGuide_1') }}</div>
    <div class="user-count">{{ view.userCount }}</div>
  </div>
</template>

<style scoped>
.achieve-guide {
  position: absolute;
  width: 454px;
  height: 250px;
  border: 1px solid #725f40;
  font-size: 12px;
  color: #fff;
  background: #1e2613;
}

.title-bk {
  position: absolute;
  left: 45px;
  top: 0;
  width: 408px;
  height: 45px;
}

.frame {
  position: absolute;
  left: 2px;
  top: 2px;
  width: 42px;
  height: 42px;
  border: 1px solid #e7e7dd;
}

.pic {
  position: absolute;
  left: 3px;
  top: 3px;
  width: 40px;
  height: 40px;
}

.title {
  position: absolute;
  left: 45px;
  top: 5px;
  width: 407px;
  color: #fffdf0;
  text-align: center;
  font-size: 22px;
  font-weight: bold;
}

.guide-label {
  position: absolute;
  left: 3px;
  top: 57px;
  width: 40px;
  color: #a0a0a0;
  text-align: center;
  font-size: 18px;
  font-weight: bold;
  writing-mode: vertical-rl;
  text-orientation: upright;
}

.content {
  position: absolute;
  left: 45px;
  right: 0;
  top: 46px;
  bottom: 26px;
}

.todo {
  margin: 20px 10px 0;
  width: 320px;
  color: #efe0e0;
  white-space: pre-wrap;
}

.progress-track {
  position: relative;
  margin: 4px 3px 0;
  height: 16px;
  border: 1px solid #555;
  background: #000;
}

.progress-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: #006070;
}

.progress-label {
  position: absolute;
  left: 0;
  right: 0;
  color: #ffff00;
  text-align: center;
  font-size: 12px;
  font-weight: bold;
}

.goals {
  margin: 8px 10px 0;
}

.goal {
  color: #a0a0a0;
}

.goal.done {
  color: #00ff00;
}

.user-count-label {
  position: absolute;
  left: 20px;
  right: 75px;
  bottom: 0;
  height: 24px;
  color: #ffff00;
  text-align: right;
  font-size: 14px;
}

.user-count {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 75px;
  height: 24px;
  color: #00ff00;
  font-size: 16px;
  font-weight: bold;
}
</style>
