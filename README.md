# @crafter8/cli

Crafter8 command line interface.

Canonical repo:

- `https://github.com/crafter8/cli`

Current commands:

- `crafter8 build`
- `crafter8 login`
- `crafter8 logout`
- `crafter8 whoami`
- `crafter8 publish datapack`

Install:

```bash
npm install @crafter8/cli @crafter8/sdk
```

Build a declaration entry:

```bash
crafter8 build --entry ./crafter8.mjs --out-dir ./dist --emit-community-datapack --publication-dir .
```

Create a local Crafter8 CLI login:

```bash
crafter8 login \
  --api-base-url https://staging-api.crafter8.app \
  --display-name "Leo"
```

Inspect the active CLI session:

```bash
crafter8 whoami
```

Remove the active CLI session:

```bash
crafter8 logout
```

Publish a datapack through Crafter8 backend:

```bash
crafter8 publish datapack --target cloudflare-r2
```

Default publish inputs are:

- `./community-datapack.manifest.json`
- `./community-datapacks.json`

The publish command:

1. reads the generated datapack publication files
2. creates a backend publication session
3. uploads payload directly when the backend returns an upload grant
4. finalizes the session

The CLI stores login state in a local config file. Override its location with:

- `CRAFTER8_CLI_CONFIG_PATH=/absolute/path/to/config.json`

Current supported targets:

- `local-static`
- `cloudflare-r2`
