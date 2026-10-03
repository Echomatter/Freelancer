import type { Plugin } from "@opencode-ai/plugin"
import contentIndex from "../tools/content_index"

const ContentIndex: Plugin = async () => ({ tool: { content_index: contentIndex } })
export default ContentIndex
