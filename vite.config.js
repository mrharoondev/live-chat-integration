import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';

export default defineConfig({
    plugins: [
        laravel({
            input: ['resources/css/app.css', 'resources/js/app.js'],
            refresh: true,
        }),
    ],
    server: {
        host: '127.0.0.1',
        port: 5173,
        strictPort: true,
        cors: {
            origin: '*',
        },
        hmr: {
            host: '127.0.0.1',
            protocol: 'ws',
            port: 5173,
        },
    },
});
