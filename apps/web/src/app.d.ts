// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    interface PageState {
      /** Issue key shown in the peek panel (shallow routing: Back closes it). */
      peek?: string;
    }
  }
}
export {};
