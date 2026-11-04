// A browser test loads the app stylesheet, so a computed style assertion reads
// a styled element.
import './routes/layout.css';

/*
	The SvelteKit HTML shell defines this global in the running app, and the
	development build of `$app/env/public` opens with `const env =
	globalThis.__sveltekit_dev.env`. A browser test loads that module without the
	shell, so without this shim a spec fails at import.
*/
globalThis.__sveltekit_dev = { env: {} };
