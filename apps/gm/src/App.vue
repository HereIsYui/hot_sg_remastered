<script setup lang="ts">
import { onMounted, ref } from 'vue';

const serverStatus = ref('检测中…');

onMounted(async () => {
  try {
    const res = await fetch('/api/health');
    serverStatus.value = res.ok ? '服务端正常' : `服务端异常（${res.status}）`;
  } catch {
    serverStatus.value = '无法连接服务端';
  }
});
</script>

<template>
  <main>
    <h1>热血三国 GM 后台</h1>
    <p>{{ serverStatus }}</p>
  </main>
</template>

<style scoped>
main {
  font-family: system-ui, sans-serif;
  padding: 24px;
}
</style>
