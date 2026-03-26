# Vibe Pencil

Visual architecture editor for mapping systems on a canvas, discussing them with AI, and triggering topology-aware builds.

## Features

- Visual architecture editor built on React Flow
- AI chat panel with node-scoped discussion
- Auto-build workflows for the full graph, selected subgraphs, or a single node
- Project import flow for turning an existing codebase into canvas nodes

## Quick Start

```bash
npm install && npm run dev
```

## How It Works

Design the system on the canvas, select a node or the full architecture to discuss tradeoffs with AI, then trigger a build pass that uses the graph structure to scope implementation prompts.

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- `@xyflow/react`
- Zustand
- Vitest

## Configuration

Project state is saved in `architect.json`. The main runtime settings are:

- `config.agent`: agent backend to use for build execution (`claude-code` or `codex`)
- `config.workDir`: working directory where generated code should be written
- `config.maxParallel`: maximum parallel worker count recorded in project config

See `architect.json.example` for a sample three-service architecture and the full saved project format.

## License

MIT
