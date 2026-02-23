import "solid-js"

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      box: any
      text: any
      input: any
      select: any
      textarea: any
      ascii_font: any
      tab_select: any
      scrollbox: any
      code: any
      diff: any
      line_number: any
      markdown: any
      span: any
      strong: any
      b: any
      em: any
      i: any
      u: any
      br: any
      a: any
      scroll: any
      scrollbox: any
      spinner: any
    }
  }
}

declare module "@opentui/solid/jsx-runtime" {
  export const jsx: any;
  export const jsxs: any;
  export const jsxDEV: any;
  export const Fragment: any;
}

declare module "@opentui/solid/jsx-dev-runtime" {
  export const jsx: any;
  export const jsxs: any;
  export const jsxDEV: any;
  export const Fragment: any;
}

export {}
