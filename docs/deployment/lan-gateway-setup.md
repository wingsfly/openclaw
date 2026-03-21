# LAN Gateway 部署方案

## 概述

在局域网环境中部署 OpenClaw Gateway，使多终端（Mac、Windows、智能眼镜等）通过 LAN IP 访问 Control UI 和 WebSocket 服务。

## 网络环境

| 设备               | IP                                     | 角色                   |
| ------------------ | -------------------------------------- | ---------------------- |
| Mac (Gateway Host) | 192.168.1.201                          | 运行 OpenClaw Gateway  |
| OpenWrt 路由器     | 192.168.1.1 (LAN) / 10.28.76.219 (WAN) | 网络网关、DHCP/DNS     |
| 智能眼镜 (Android) | 192.168.1.235                          | 客户端                 |
| 上游网关           | 10.28.0.1                              | ISP 网关 (ezelink.net) |

## Gateway 配置

配置文件：`~/.openclaw/openclaw.json`

### 关键配置项

```json
{
  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "custom",
    "customBindHost": ["192.168.1.201", "127.0.0.1"],
    "controlUi": {
      "allowedOrigins": [
        "http://localhost:18789",
        "http://127.0.0.1:18789",
        "http://192.168.1.201:18789"
      ],
      "dangerouslyDisableDeviceAuth": true
    },
    "auth": {
      "mode": "token",
      "token": "<gateway-token>"
    }
  }
}
```

### 配置说明

| 配置项                                   | 值                               | 说明                                                                     |
| ---------------------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| `bind`                                   | `"custom"`                       | 自定义绑定地址，不使用 `"lan"`（0.0.0.0）避免暴露到所有网卡              |
| `customBindHost`                         | `["192.168.1.201", "127.0.0.1"]` | 仅监听 LAN IP 和 loopback，支持多地址绑定                                |
| `controlUi.allowedOrigins`               | 包含所有访问源                   | WebSocket 连接的 Origin 检查白名单，缺少会导致 "origin not allowed" 错误 |
| `controlUi.dangerouslyDisableDeviceAuth` | `true`                           | 非 HTTPS 环境下禁用设备身份认证（仅限受信任局域网）                      |

### 启动命令

```bash
openclaw gateway run --port 18789 --force
```

注意：`--bind` 参数会覆盖配置文件中的 `bind` 设置，使用配置文件时不需要传 `--bind`。

### 访问方式

Control UI 地址：`http://192.168.1.201:18789/`

首次访问需在 Control UI 设置中粘贴 Gateway Token（token 不通过 URL 参数传递，需在页面设置界面手动输入）。

## OpenWrt 路由器配置

### 已解决的问题

#### 问题 1：Android 设备 DNS 解析失败 (ERR_NAME_NOT_RESOLVED)

**根因**：路由器开启了 DHCPv6 和 RA (Router Advertisement)，向客户端下发 IPv6 ULA DNS 地址 `fdfc:40c4:bbeb::1`。由于路由器没有 IPv6 上游连接，该 DNS 服务器无法解析外部域名。Android 优先使用 IPv6 DNS 导致解析失败，而 Mac/Windows 有更好的 fallback 机制不受影响。

**修复**：

```bash
uci set dhcp.lan.dhcpv6='disabled'
uci set dhcp.lan.ra='disabled'
uci delete dhcp.lan.ra_flags
uci delete dhcp.lan.ra_slaac
uci commit dhcp
/etc/init.d/odhcpd restart
/etc/init.d/dnsmasq restart
```

**验证**（在 Android 设备上）：

```bash
adb shell dumpsys connectivity | grep DnsAddresses
# 应只显示 IPv4 DNS: [ /8.8.8.8, /8.8.4.4 ]
# 不应包含 IPv6 DNS 地址
```

#### 问题 2：DHCP DNS 配置

当前通过 DHCP Option 6 直接下发公共 DNS：

```bash
uci show dhcp.lan.dhcp_option
# dhcp.lan.dhcp_option='6,8.8.8.8,8.8.4.4'
```

客户端直接使用 8.8.8.8/8.8.4.4 解析，不经过路由器的 dnsmasq 转发。

### 当前 DHCP 配置

```
dhcp.lan.interface='lan'
dhcp.lan.start='100'
dhcp.lan.limit='150'
dhcp.lan.leasetime='12h'
dhcp.lan.dhcpv4='server'
dhcp.lan.dhcpv6='disabled'
dhcp.lan.ra='disabled'
dhcp.lan.dhcp_option='6,8.8.8.8,8.8.4.4'
```

## 安全注意事项

- `dangerouslyDisableDeviceAuth=true` 仅适用于受信任的局域网环境
- 生产环境应使用 HTTPS + 设备身份认证
- Gateway 启动时会显示安全警告，可通过 `openclaw security audit` 检查
- `bind=custom` 比 `bind=lan`（0.0.0.0）更安全，限制了监听范围

## GlassClaw 图片发送

### 协议要求

GlassClaw 发送 `chat.send` RPC 时，附件字段必须匹配 Gateway 的 `RpcAttachmentInput` 接口：

```json
{
  "attachments": [
    {
      "type": "image",
      "fileName": "photo.jpg",
      "mimeType": "image/jpeg",
      "content": "data:image/jpeg;base64,/9j/4AAQ..."
    }
  ]
}
```

**注意**：字段名必须是 `content`（非 `media`）、`fileName`（非 `name`），否则 Gateway 的 `normalizeRpcAttachmentsToChatAttachments` 会因 `content` 为空而过滤掉附件。

### 模型 Vision 支持

本地模型（omlx 等）需要在配置中声明 `input` 包含 `"image"`，否则 Pi agent 的 openai-completions provider 会在发送前过滤掉所有图片 content block：

```json
{
  "providers": {
    "omlx": {
      "models": [
        {
          "id": "Qwen3.5-35B-A3B-8bit",
          "input": ["text", "image"]
        }
      ]
    }
  }
}
```

如果 `input` 仅为 `["text"]`，图片虽然通过了 Gateway 的附件归一化和解析，但会在最终发送给 LLM 时被静默丢弃。

## 排障检查清单

1. **Gateway 未监听** — 检查 `lsof -i :18789 -P -n`
2. **Origin not allowed** — 确认 `controlUi.allowedOrigins` 包含访问源地址
3. **Token missing** — 在 Control UI 设置中粘贴 Gateway Token
4. **DNS 解析失败 (Android)** — 检查 `adb shell dumpsys connectivity | grep DnsAddresses`，确认无 IPv6 DNS
5. **配置不生效** — 修改配置后必须重启 Gateway
6. **图片发送后 LLM 说没收到** — 检查模型配置 `input` 是否包含 `"image"`；检查附件字段名是否为 `content`/`fileName`
