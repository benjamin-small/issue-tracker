// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  interface ImportMetaEnv {
    /** True in the self-contained browser demo build (`pnpm build:demo`). */
    readonly TRACKER_DEMO: boolean;
  }
  namespace App {
    interface PageState {
      /** Issue key shown in the peek panel (shallow routing: Back closes it). */
      peek?: string;
    }
  }
}
export {};
