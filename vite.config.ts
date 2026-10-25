import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
const base=process.env.VITE_BASE_PATH ?? '/lunumi/';
export default defineConfig({base,plugins:[react(),VitePWA({registerType:'autoUpdate',includeAssets:['lunumi.svg'],manifest:{name:'Lunumi',short_name:'Lunumi',description:'Food, found nearby',theme_color:'#fff8f0',background_color:'#fff8f0',display:'standalone',start_url:base,scope:base,icons:[{src:'lunumi.svg',sizes:'any',type:'image/svg+xml',purpose:'any maskable'}]},workbox:{navigateFallback:'index.html'}})]});
