# File access scope

[Capabilities](capabilities.md) · [Named agents](named-agents.md)

Freelancer offers one saved file-scope choice shared by Engineer, Researcher,
Designer and custom named agents:

- **Files in this project** — file-target tools are limited to the currently
  selected project folder.
- **Files in all projects** — file-target tools may target any folder registered
  in Freelancer's project list.
- **Files on my computer** — default; preserves the current capability-first
  behavior for ordinary file paths.

The scope applies to file targets for native read, write, edit, patch, glob,
grep and LSP calls. Native OpenCode permissions, including external-directory
rules and denials, remain authoritative. `.git` and Freelancer's private `.state`
remain protected in all scopes; use the GitHub panel or `git_project` for managed
history. Shell commands, MCP/custom tools and plugins can have other filesystem
effects; this choice is not a computer-wide sandbox and does not grant those
tools permission. Choose the narrowest scope that fits the task.

Find this setting in **Application settings → Content & Storage**. It is stored in the existing shared settings document and used by the
runtime guard independently of agent identity. Changing the named agent does not
change the scope. A change to the scope does not enable integrations or relax
native permissions.
