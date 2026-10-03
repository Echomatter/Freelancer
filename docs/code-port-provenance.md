# Code port provenance

The source references, inspected blobs, and revision limitations are recorded in
[the migration map](Freelancer_Code_Port_and_Migration_Map.md). These references
inform adaptations implemented in Freelancer's existing Node service. This work
does not install the donor frameworks, their transports, or separate server
processes. Retain the source notices and a pinned revision if donor source code
is extracted in a future change.

| Reference | Adapted behavior | Freelancer implementation |
|---|---|---|
| P01 MCP reference Memory | Duplicate-safe entities, aliases, claims, directed relations, precise deletes | `server/data/memory.mjs`, `server/data/knowledge-queries.mjs` |
| P02 archived SQLite MCP | Parameterized analytical reads and schema discovery | `server/data/analytics.mjs`, `server/data/analytics-worker.mjs` |
| P03 content query | Common Unicode matching, filters, scope, and stable result order | `domain/content-query.mjs`, `server/data/knowledge-query.mjs` |
| P04 Memory Service | Retrieval diagnostics and explicit superseded states | `server/data/knowledge-queries.mjs`; vectors remain optional |
| P05 memory revisions | Immutable captures, provenance, explicit retention and forgetting | `server/data/memory.mjs`, `server/data/memory-capture.mjs` |
| P06 temporal graph | Revision history, validity intervals, optimistic edits | `server/data/memory.mjs`, `server/data/migration-19.sql` |
| P07 conversation warehouse | Source identities, immutable native revisions, part metadata, coverage | `server/data/opencode-warehouse.mjs` |
| P08 Datasette execution | Separate analytical process, bounded results, cancellation | `server/data/analytics.mjs`, `server/data/analytics-worker.mjs` |
| P09 sqlite-utils FTS lifecycle | Derived index reconstruction inside the existing database | `server/data/store.mjs`, `server/data/schema.sql` |

Source and transport ownership follow the migration map's fresh-install amendment.
Prior-data import utilities are explicit maintenance commands. Native OpenCode
configuration, credentials, source files, and Git history keep their owners.

The TypeSafe integration uses the declared `@typesafe-ai/sdk` dependency through
one judgment provider. Its installed package includes its upstream license and
notices. Freelancer stores typed judgments separately from facts and retains
actual model identity, evidence hashes, and known or unknown usage.
