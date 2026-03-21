# Gateway Multi-IP Bind

**Date:** 2026-03-19
**Status:** Implemented

## Problem

Gateway `bind=custom` only supported a single IP via `gateway.customBindHost`. Users who need to bind to specific interfaces (e.g., loopback + a LAN IP) had to use `bind=lan` (0.0.0.0), which exposes all interfaces unnecessarily.

## Solution

Extend `gateway.customBindHost` to accept `string | string[]`. When an array is provided, the gateway creates separate HTTP server instances for each IP, all sharing a single WebSocket server.

### Config Example

```json
{
  "gateway": {
    "bind": "custom",
    "customBindHost": ["127.0.0.1", "192.168.31.206"]
  }
}
```

Single-string config remains fully backward compatible:

```json
{
  "gateway": {
    "bind": "custom",
    "customBindHost": "192.168.31.206"
  }
}
```

## Architecture

### Primary vs Extra Hosts

- The **first** IP in the array is the "primary" bind host, used for:
  - CLI probe target (`gateway status --deep`)
  - Dashboard URL display
  - Control UI links in onboarding
  - Setup code / QR generation
- **Remaining** IPs are "extra bind hosts" — each gets its own `http.Server` instance bound via `server.listen(port, host)`.
- When the primary is `127.0.0.1`, IPv6 loopback (`::1`) is automatically added (existing behavior preserved).

### Data Flow

```
Config (customBindHost: string[])
  → resolveGatewayBindHost()        — returns first IP as primary bindHost
  → resolveGatewayRuntimeConfig()   — validates all IPs, extracts extraBindHosts = IPs[1:]
  → createGatewayRuntimeState()     — calls resolveGatewayListenHosts(primary, {extraBindHosts})
  → For each host:
      createGatewayHttpServer()     — independent HTTP server per host
      listenGatewayHttpServer()     — bind to host:port
  → All servers share single WebSocketServer (noServer mode, upgrade handler attached to each)
```

### Consumer Normalization

All code that reads `customBindHost` for single-value contexts (URLs, probes, display) uses:

```typescript
const firstHost = (Array.isArray(raw) ? raw[0] : raw)?.trim();
```

A shared helper `normalizeCustomBindHosts()` in `src/gateway/net.ts` handles array normalization for multi-host contexts.

## Files Modified

### Core (bind logic)

| File                                   | Change                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/config/types.gateway.ts`          | `customBindHost?: string \| string[]`                                                                                    |
| `src/config/zod-schema.ts`             | `z.union([z.string(), z.array(z.string())])`                                                                             |
| `src/gateway/net.ts`                   | `normalizeCustomBindHosts()`, updated `resolveGatewayBindHost()` and `resolveGatewayListenHosts()` with `extraBindHosts` |
| `src/gateway/server-runtime-config.ts` | Validate all IPs, add `extraBindHosts` to `GatewayRuntimeConfig`                                                         |
| `src/gateway/server-runtime-state.ts`  | Pass `extraBindHosts` to `resolveGatewayListenHosts()`                                                                   |
| `src/gateway/server.impl.ts`           | Plumb `extraBindHosts` from config to runtime state                                                                      |

### Adapters (single-host consumers)

| File                                                   | Change                                           |
| ------------------------------------------------------ | ------------------------------------------------ |
| `src/config/gateway-control-ui-origins.ts`             | Generate allowed origins for all IPs             |
| `src/shared/gateway-bind-url.ts`                       | Use first host for URL resolution                |
| `src/cli/daemon-cli/shared.ts`                         | `pickProbeHostForBind()` uses first host         |
| `src/commands/onboard-helpers.ts`                      | `resolveControlUiLinks()` uses first host        |
| `src/commands/doctor-security.ts`                      | Pass raw config to `resolveGatewayBindHost()`    |
| `src/config/validation.ts`                             | Validate first host for tailscale loopback check |
| `extensions/diffs/src/url.ts`                          | Use first host for viewer URLs                   |
| `extensions/mattermost/src/mattermost/interactions.ts` | Use first host for callback URL                  |
| `extensions/mattermost/src/mattermost/monitor.ts`      | Use first host for slash command callback        |
| `src/wizard/onboarding.ts`                             | Extract first host for wizard defaults           |

## Testing

- Existing tests pass with updated error message assertion in `server-runtime-config.test.ts`.
- Verified live: gateway binds to `127.0.0.1:18789`, `[::1]:18789`, and `192.168.31.206:18789` simultaneously.
- CLI commands (`devices list`, `gateway status --deep`) work via loopback; external browser connects via LAN IP.
