import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => {
  const isChromiumBuild = mode.endsWith('chromium')
  const isAsterBuild = mode === 'aster-chromium'

  return {
    base: isChromiumBuild ? './' : undefined,
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'onboarding-brand-title',
        // Run before Vite rewrites public URLs according to base './'.
        // A normal-priority hook sees ./icon/32.png and misses the original path.
        transformIndexHtml: {
          order: 'pre',
          handler(html) {
          const branded = html.replace(
            '<title>BrowserOS Onboarding</title>',
            `<title>${isAsterBuild ? 'Aster' : 'BrowserOS'} Onboarding</title>`,
          )
            if (!isAsterBuild) return branded
            const browserosIcon =
              '<link rel="icon" type="image/png" sizes="32x32" href="/icon/32.png" />'
            if (!html.includes(browserosIcon)) {
              throw new Error('Aster onboarding source favicon changed; cannot brand safely')
            }
            return branded.replace(
              browserosIcon,
              '<link rel="icon" type="image/svg+xml" href="/icon/aster-mark.svg" />',
            )
          },
        },
      },
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: isChromiumBuild
      ? {
          outDir: 'dist/chromium',
          emptyOutDir: true,
          assetsDir: '.',
          cssCodeSplit: false,
          modulePreload: { polyfill: false },
          assetsInlineLimit: 0,
          rollupOptions: {
            output: {
              entryFileNames: 'app.js',
              chunkFileNames: 'app.js',
              inlineDynamicImports: true,
              assetFileNames: (assetInfo) => {
                const name = assetInfo.names[0] ?? ''
                if (name.endsWith('.css')) return 'app.css'
                throw new Error(
                  `Unexpected Chromium resource asset emitted: ${name}`,
                )
              },
            },
          },
        }
      : undefined,
  }
})
