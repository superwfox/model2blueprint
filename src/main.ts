import { createApp } from 'vue';
import App from './app/App.vue';
import './app/style.css';

const app = createApp(App);
app.mount('#app');
if (import.meta.hot) import.meta.hot.dispose(() => app.unmount());
