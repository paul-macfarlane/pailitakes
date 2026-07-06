// lite-youtube-embed ships no types; the import is side-effect-only
// (registers the <lite-youtube> custom element). Shorthand ambient module
// declarations must live in a global (non-module) .d.ts — the JSX
// augmentation for the element lives in lite-youtube-jsx.d.ts, which has to
// be a module.
declare module "lite-youtube-embed";
