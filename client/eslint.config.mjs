import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}", "app/providers.tsx"],
    rules: {
      // Bans the HOOKS that reach past the facade, not the modules they live
      // in. A path-level ban (no `@/stores/*`, no `@/lib/api/*` at all) would
      // also take out MODAL_SCRIM_Z (a constant), isSettled/UploadItem (a pure
      // helper and a type), and ApiError/PASSWORD_MIN_LENGTH (narrowing an
      // error and reading a validation constant, both legitimate in a
      // component). Forcing those through a feature hook too would be a
      // design change wearing a lint fix's clothes. `importNames` lets the
      // rule say precisely what's forbidden — reading or writing store/server
      // state directly — while leaving the rest of each module importable.
      //
      // Two known gaps, both inherent to ESLint's built-in rule rather than
      // this configuration: a dynamic `await import(...)` is not inspected at
      // all (this defeats every ban shape here, not just the name-scoped
      // ones), and a same-name re-export through `features/**` is invisible
      // from the component side. Namespace and aliased imports ARE caught.
      // Closing the two gaps would need a custom rule or
      // eslint-plugin-boundaries; until then they are covered by review, not
      // by lint.
      "no-restricted-imports": ["error", {
        paths: [
          {
            name: "@/stores/session.store",
            importNames: ["useSessionStore"],
            message: "UI components consume features/session/, not the store directly.",
          },
          {
            name: "@/stores/workspace.store",
            importNames: ["useWorkspaceStore"],
            message: "UI components consume features/workspace/, not the store directly.",
          },
          {
            name: "@/stores/viewport.store",
            importNames: ["useViewportStore"],
            message: "UI components consume features/workspace/, not the store directly.",
          },
          {
            name: "@/stores/scene.store",
            importNames: ["useSceneStore"],
            message: "UI components consume features/workspace/, not the store directly.",
          },
          {
            name: "@/stores/turn.store",
            importNames: ["useTurnStore"],
            message: "UI components consume features/agent/, not the store directly.",
          },
          {
            name: "@/stores/upload.store",
            importNames: ["useUploadStore"],
            message: "UI components consume features/files/, not the store directly.",
          },
          {
            name: "@/lib/api/client",
            message: "UI components consume features/**, not the API client directly.",
          },
          {
            // The complete bypass: `useApi` hands back the raw `client` and
            // `auth`, so banning the modules they live in achieves nothing
            // while this re-export stays open.
            name: "@/lib/swr/provider",
            importNames: ["useApi"],
            message: "UI components consume features/**, not the API client directly.",
          },
          {
            name: "swr",
            importNames: ["useSWRConfig", "default"],
            message: "UI components consume features/**, not SWR directly.",
          },
        ],
        patterns: [
          {
            group: ["@/lib/api/endpoints/*"],
            message: "UI components consume features/**, not API endpoints directly.",
          },
        ],
      }],
    },
  },
]);

export default eslintConfig;
