<div align="center">
  <img alt="LynkU"
       src="./assets/logo.png"
       width="100">

  **UNNC Unofficial Discourse**

  ![Version][Version]
  [![CloudBase][CloudBase]][CloudBase-url]

</div>

## Overview

An open-source, non-profit, exclusive chat and community platform for students at the University of Nottingham Ningbo China (UNNC), designed as a modern alternative to Allink.

## Development

LynkU is a native WeChat Mini Program backed by CloudBase, migrated from Lucky. The client is written in TypeScript with Skyline and Glass-Easel; authenticated cloud functions own posts, comments, profiles, drafts, notifications, and private messages.

```text
Mini Program -> features / typed services -> Cloud Functions -> application / adapters -> CloudBase
```

Anonymous content is sanitized at the cloud-function boundary. Chat and comment updates use privacy-safe polling rather than exposing private collections to client database watches.

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for setup, database permissions, indexes, deployment, and verification.

The project uses npm workspaces. Open the repository root in WeChat DevTools; `project.config.json` selects `apps/miniprogram/` and built `dist/cloudfunctions/`.

```text
apps/miniprogram/     native client, features, platform adapters and composition
apps/cloudfunctions/ six cloud function entries and remaining legacy server code
packages/contracts/  shared validated requests and public responses
packages/server/     platform-independent business applications
packages/adapters/   typed CloudBase persistence adapters
tooling/             builds, dependency boundaries and quality checks
scripts/             deployment and controlled data migration commands
tests/               business, integration and architecture tests
config/              database and environment manifests
dist/                generated upload artifacts; never hand-edit
```

Use Node.js 24.21.x and run `npm run setup`. This installs locked dependencies, generates public configuration, checks the project, and builds standalone function bundles; it does not deploy. Open this repository root in WeChat DevTools. Public configuration lives in `config/project.json`; after editing it run `npm run configure`. `npm run check` rejects configuration drift.

LynkU uses AppID `wxba2bcb0c71a5f33d` and its own environment `cloud1-d7gifgdpb8ad0ab8e`. The old Lucky environment and identities are preserved separately. Internal `@lucky/*` package names remain stable implementation identifiers. See the [cutover decision](docs/architecture/decisions/002-lynku-cutover.md), [demo guide](docs/DEMO.md) and [current evidence](docs/plans/refactor/status.md).

## Contribution

We welcome contributions, bug reports, and feature proposals from students and developers interested in improving the UNNC digital ecosystem.

- **Email:** [quin@asro.cc](mailto:quin@asro.cc) (Quin)
- **WeChat:** `quin1745`

## License

Distributed under the [WTFPL License](LICENSE).


[Version]: https://img.shields.io/badge/Beta-0.0.1-111111?style=for-the-badge

[CloudBase]: https://img.shields.io/badge/CloudBase-07C160?style=for-the-badge&logo=wechat&logoColor=white
[CloudBase-url]: https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html
