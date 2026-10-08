/** Runs before the app starts. In the demo build it boots the in-browser backend (see src/demo/). */
export async function init() {
  if (import.meta.env.POIETIC_ISSUES_DEMO) await (await import('./demo/install.ts')).installDemo();
}
