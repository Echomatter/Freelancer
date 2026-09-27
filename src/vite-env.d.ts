/// <reference types="vite/client" />

declare module '*?help' {
  const excerpts: Record<import('../shared/readme-help.mjs').HelpTopic, import('../shared/readme-help.mjs').HelpExcerpt>;
  export default excerpts;
}
