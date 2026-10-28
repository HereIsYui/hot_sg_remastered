<script setup lang="ts">
import { computed } from 'vue';
import { assets } from '../../assets/registry';
import { achieveItemView, type AchiveRow } from '../../game/achivement';
import { i18n } from '../../i18n';

/**
 * Achivement/AchieveItem (400x50, stretched to 473 by the parent): one achievement row — the image
 * in a 42px frame, the title and intro over the titleBackground, the `点数：N` box and the gain
 * time. A gained row is yellow, an open one grey (`setItem`, AS3 293-321). Clicking reports the
 * achievement id (`onClick` → UserAchivement.achieveItemClick).
 */
const props = defineProps<{ row: AchiveRow }>();
const emit = defineEmits<{ click: [id: number] }>();

const view = computed(() => achieveItemView(props.row));
const image = computed(() => assets.url(view.value.imagePath));
const pointLabel = computed(() => `${i18n('Achivement_Other_1')}${view.value.point}`);
</script>

<template>
  <div class="achieve-item" :class="{ gained: view.gained }" @click="emit('click', view.id)">
    <div class="frame">
      <img :src="image" alt="" draggable="false" />
    </div>
    <div class="titles">
      <div class="title">{{ view.title }}</div>
      <div class="intro">{{ view.intro }}</div>
    </div>
    <div class="point">{{ pointLabel }}</div>
    <div class="time">{{ view.getTime }}</div>
  </div>
</template>

<style scoped>
.achieve-item {
  position: absolute;
  height: 50px;
  background: #26301b;
  border: 1px solid #4c5c33;
  cursor: pointer;
  font-size: 12px;
}

.frame {
  position: absolute;
  left: 4px;
  top: 4px;
  width: 42px;
  height: 42px;
  border: 1px solid #e7e7dd;
  background: #10130a;
}

.frame img {
  position: absolute;
  left: 1px;
  top: 1px;
  width: 40px;
  height: 40px;
}

.titles {
  position: absolute;
  left: 55px;
  right: 100px;
  top: 1px;
  bottom: 2px;
}

.title {
  height: 20px;
  color: #9b9b8f;
  text-align: center;
  font-weight: bold;
}

.gained .title {
  color: #ffff00;
}

.intro {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 20px;
  color: #f0f0f0;
  text-align: center;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.point,
.time {
  position: absolute;
  right: 4px;
  width: 90px;
  height: 21px;
  background: #1a2211;
  color: #e7e7dd;
  text-align: center;
  line-height: 21px;
}

.point {
  top: 3px;
}

.time {
  bottom: 3px;
}

.gained .time {
  color: #30d400;
}
</style>
