// The top-level import makes this file a module, so the react declaration
// below AUGMENTS React's types (a plain ambient `declare module "react"`
// would replace them wholesale).
import type { DetailedHTMLProps, HTMLAttributes } from "react";

// JSX support for the <lite-youtube> custom element (React 19 renders
// unknown-element props as attributes, so lowercase `videoid` is deliberate).
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "lite-youtube": DetailedHTMLProps<
        HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        videoid: string;
        playlabel?: string;
      };
    }
  }
}
