import { sentryVitePlugin } from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'
import { archiveSourceMaps } from './lib/build/archive-source-maps'
import {
  getAsterCompatibilityExtensionIds,
  getAsterManifestIdentity,
  getAsterProductWebMatches,
} from './lib/build/aster-manifest-identity'

// biome-ignore lint/style/noProcessEnv: build config file needs env access
const env = process.env
const manifestIdentity = getAsterManifestIdentity(env)
const compatibilityExtensionIds = getAsterCompatibilityExtensionIds(env)
const productWebMatches = getAsterProductWebMatches(env)

// See https://wxt.dev/api/config.html
// Extension IDs are derived from the explicitly configured Aster public key.
export default defineConfig({
  outDir: 'dist',
  modules: ['@wxt-dev/module-react'],
  hooks: {
    // All Vite builds (including Sentry uploads) finish before this hook; WXT's
    // ZIP and the release CRX packer then consume the extension without maps.
    'build:done': (wxt, output) => archiveSourceMaps(wxt.config, output),
  },
  manifest: {
    name: 'Aster Browser',
    description: 'Aster Browser with a built-in AI workspace.',
    ...manifestIdentity,
    ...(productWebMatches.length
      ? {
          web_accessible_resources: [
            {
              resources: ['app.html'],
              matches: productWebMatches,
              ...(compatibilityExtensionIds.length
                ? { extension_ids: compatibilityExtensionIds }
                : {}),
            },
          ],
        }
      : {}),
    chrome_url_overrides: {
      newtab: 'app.html',
    },
    options_ui: {
      page: 'app.html#/settings',
      open_in_tab: true,
    },
    action: {
      default_icon: {
        16: 'aster-icon/16.png',
        32: 'aster-icon/32.png',
        48: 'aster-icon/48.png',
        128: 'aster-icon/128.png',
      },
      default_title: 'Ask Aster',
    },
    permissions: [
      'system.cpu',
      'system.memory',
      'topSites',
      'storage',
      'unlimitedStorage',
      'scripting',
      'tabs',
      'activeTab',
      'tabGroups',
      'sidePanel',
      'bookmarks',
      'history',
      'browserOS',
      'alarms',
      'webNavigation',
      'downloads',
      'sessions',
    ],
    host_permissions: ['http://127.0.0.1/*'],
  },
  vite: () => ({
    define: {
      __ASTER_REPORTER_EXTENSION_ID__: JSON.stringify(
        manifestIdentity.externally_connectable.ids[0] ?? '',
      ),
    },
    build: {
      sourcemap: 'hidden',
    },
    plugins: [
      tailwindcss(),
      ...(env.SENTRY_AUTH_TOKEN
        ? [
            sentryVitePlugin({
              org: env.SENTRY_ORG,
              project: env.SENTRY_PROJECT,
              authToken: env.SENTRY_AUTH_TOKEN,
              // archiveSourceMaps retains full maps after every upload finishes.
            }),
          ]
        : []),
    ],
  }),
})
