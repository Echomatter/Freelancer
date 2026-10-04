# Fetch service setup

Inspect the native service in Application settings → Capabilities. Preserve the
user's existing command, proxy, credentials and configuration; startup help is
not an instruction to replace them.

The documented local command is `uvx mcp-server-fetch`. With the Python package
already installed, `python -m mcp_server_fetch` is another documented option.
For Windows encoding-related timeouts, upstream recommends the service
environment value `PYTHONIOENCODING=utf-8`. Change configuration only within the
user's setup request and native permission.

See the pinned [upstream setup/troubleshooting guide](https://github.com/modelcontextprotocol/servers/blob/f46d9578190b476b3501923ea8977d899e8db2cb/src/fetch/README.md).
The server may reach local/internal URLs; an accessible URL is not authorization
to disclose its contents. Preserve the configured robots policy and report
refusals rather than bypassing them.
