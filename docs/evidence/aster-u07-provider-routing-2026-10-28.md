# U07 provider/model/reasoning routing evidence — 2026-10-28

U07 remains **PARTIAL**. The provider selector displays and searches the saved
model ID and reasoning effort. Requests identify a saved provider, and server
hydration uses that row's model and reasoning settings instead of stale client
copies. The server recomputes reasoning support from the shared `models.dev`
snapshot. An unlisted model, including a custom Azure deployment name, resolves
to unsupported and cannot activate Azure's `forceReasoning` path. Legacy inline
provider configuration without a matching stored row preserves its supplied
capability for compatibility.

Validation: **70 focused tests passed across eight files**; app, server and
shared-package typechecks passed; Biome passed on the changed code. Independent
Luna review checked known unsupported models, unknown Azure deployments,
reasoning configuration, and inline compatibility.

No headed UI run exercised changing providers/models or observed requests to
each real provider. Catalog data may not cover every custom deployment or
provider-specific capability. Native package integration and full provider
compatibility remain open, so this evidence does not promote U07 to PASS.
