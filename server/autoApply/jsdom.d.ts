// No @types/jsdom in this project's dependency tree — jsdom itself ships no
// types. This is the minimal shape greenhouse.test.ts's fixture-HTML tests
// actually use, not a full jsdom API surface.
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string);
    window: { document: Document };
  }
}
