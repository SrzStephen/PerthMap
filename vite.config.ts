import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/postcss'
import { configDefaults } from 'vitest/config'
import { stripLocal } from './scripts/strip-local'

/** Public builds drop public/data/local/ (personal-use-only layers) from dist. */
function stripLocalData(local: boolean): Plugin {
    let outDir = 'dist'
    return {
        name: 'strip-local-data',
        apply: 'build',
        configResolved(config) { outDir = config.build.outDir },
        closeBundle() {
            if (stripLocal(outDir, local)) console.log('removed local-only layers from the public build')
        },
    }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
    plugins: [react(), stripLocalData(loadEnv(mode, process.cwd(), 'VITE_').VITE_LOCAL_LAYERS === '1')],
    css: {
        postcss: {
            plugins: [tailwindcss()],
        },
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.ts'],
        exclude: [...configDefaults.exclude, 'e2e/*'],
        css: false
    }
}))
