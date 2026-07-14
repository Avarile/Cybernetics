# File Structure

[src/mastra](Entry point for all Mastra-related code and configuration)
[src/mastra/public](Contents are copied into the .build/output directory during the build process, making them available for serving at runtime)
[src/mastra/agents](Define and configure your agents - their behavior, goals, and tools)
[src/mastra/workflows](Define multi-step workflows that orchestrate agents and tools together)
[src/mastra/tools](Create reusable tools that your agents can call)
[src/mastra/mcp](Implement custom MCP servers to share your tools with external agents)
[src/mastra/scorers](Define scorers for evaluating agent performance over time)

