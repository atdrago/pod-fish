// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  /*
		The SvelteKit HTML shell defines this, and the development build of
		`$app/env/public` reads it when it loads. `src/vitest-setup-client.ts`
		supplies it for the browser tests, which run without the shell.
	*/
  var __sveltekit_dev: { env: Record<string, string> };
}

export {};
