// Minimal Discord gateway bot — zero dependencies, outbound-only (works
// behind Tailscale with no open ports). Requires Node.js 22+ for the
// native global WebSocket; the feature disables itself otherwise.
import { setTimeout as delay } from 'node:timers/promises';

const API = 'https://discord.com/api/v10';
const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const EPHEMERAL = 64;
const TERMINAL_STATES = ['ready', 'timeout', 'failed', 'cancelled'];

const COMMANDS = [
  { name: 'devices', type: 1, description: 'デバイス一覧と状態を表示' },
  { name: 'status', type: 1, description: 'PiWakeホストの状態を表示' },
  {
    name: 'wake', type: 1, description: 'PCを起動する(完了まで追跡します)',
    options: [{ type: 3, name: 'device', description: 'デバイス名', required: true, autocomplete: true }],
  },
  {
    name: 'shutdown', type: 1, description: 'PCをSSH経由でシャットダウンする',
    options: [{ type: 3, name: 'device', description: 'デバイス名', required: true, autocomplete: true }],
  },
];

function statusEmoji(status) {
  return status === 'online' ? '🟢' : '⚪';
}

function formatUptime(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

class DiscordBot {
  constructor({ token, appId, guildId, allowedUsers, api }) {
    this.token = token;
    this.appId = appId;
    this.guildId = guildId;
    this.allowedUsers = allowedUsers;
    this.api = api;
    this.seq = null;
    this.sessionId = null;
    this.resumeUrl = null;
    this.heartbeatTimer = null;
    this.awaitingAck = false;
    this.backoffMs = 5000;
    this.stopped = false;
  }

  log(...args) {
    console.log('Discord bot:', ...args);
  }

  async rest(method, path, body) {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bot ${this.token}`, 'Content-Type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`${method} ${path} → ${response.status} ${detail.slice(0, 200)}`);
    }
    return response.status === 204 ? null : response.json();
  }

  async registerCommands() {
    const path = this.guildId
      ? `/applications/${this.appId}/guilds/${this.guildId}/commands`
      : `/applications/${this.appId}/commands`;
    await this.rest('PUT', path, COMMANDS);
    this.log(`registered ${COMMANDS.length} slash commands${this.guildId ? ` (guild ${this.guildId})` : ' (global — may take up to an hour to appear)'}`);
  }

  start() {
    this.registerCommands().catch(error => this.log('command registration failed —', error.message));
    this.connect();
  }

  connect(resume = false) {
    if (this.stopped) return;
    const url = resume && this.resumeUrl ? `${this.resumeUrl}?v=10&encoding=json` : GATEWAY;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      this.log('connect failed —', error.message);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onmessage = event => {
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      this.onPayload(payload, resume).catch(error => this.log('handler error —', error.message));
    };
    ws.onclose = event => {
      clearInterval(this.heartbeatTimer);
      if (event.code === 4004) {
        this.log('authentication failed (check PIWAKE_DISCORD_TOKEN) — bot stopped');
        this.stopped = true;
        return;
      }
      this.log(`gateway closed (${event.code}) — reconnecting`);
      this.scheduleReconnect();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  scheduleReconnect() {
    if (this.stopped) return;
    const wait = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 60000);
    setTimeout(() => this.connect(Boolean(this.sessionId)), wait).unref?.();
  }

  send(payload) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(payload));
  }

  async onPayload(payload, resume) {
    if (payload.s != null) this.seq = payload.s;
    switch (payload.op) {
      case 10: { // HELLO
        const interval = payload.d.heartbeat_interval;
        clearInterval(this.heartbeatTimer);
        this.awaitingAck = false;
        this.heartbeatTimer = setInterval(() => {
          if (this.awaitingAck) {
            this.log('heartbeat ack missed — reconnecting');
            this.ws?.close(4000);
            return;
          }
          this.awaitingAck = true;
          this.send({ op: 1, d: this.seq });
        }, interval);
        this.heartbeatTimer.unref?.();
        if (resume && this.sessionId) {
          this.send({ op: 6, d: { token: this.token, session_id: this.sessionId, seq: this.seq } });
        } else {
          this.send({
            op: 2,
            d: { token: this.token, intents: 0, properties: { os: process.platform, browser: 'piwake', device: 'piwake' } },
          });
        }
        break;
      }
      case 11: // HEARTBEAT ACK
        this.awaitingAck = false;
        this.backoffMs = 5000;
        break;
      case 1: // server-requested heartbeat
        this.send({ op: 1, d: this.seq });
        break;
      case 7: // RECONNECT
        this.ws?.close(4000);
        break;
      case 9: // INVALID SESSION
        this.sessionId = payload.d ? this.sessionId : null;
        await delay(2000);
        this.ws?.close(4000);
        break;
      case 0: // DISPATCH
        if (payload.t === 'READY') {
          this.sessionId = payload.d.session_id;
          this.resumeUrl = payload.d.resume_gateway_url;
          this.log(`connected as ${payload.d.user?.username || 'bot'}`);
        } else if (payload.t === 'RESUMED') {
          this.log('session resumed');
        } else if (payload.t === 'INTERACTION_CREATE') {
          await this.onInteraction(payload.d);
        }
        break;
      default:
        break;
    }
  }

  respond(interaction, type, data) {
    return this.rest('POST', `/interactions/${interaction.id}/${interaction.token}/callback`, { type, data });
  }

  editOriginal(interaction, content) {
    return this.rest('PATCH', `/webhooks/${this.appId}/${interaction.token}/messages/@original`, { content });
  }

  userAllowed(interaction) {
    if (!this.allowedUsers.length) return true;
    const userId = interaction.member?.user?.id || interaction.user?.id;
    return this.allowedUsers.includes(userId);
  }

  async onInteraction(interaction) {
    if (interaction.type === 4) { // autocomplete
      const query = String(interaction.data.options?.find(option => option.focused)?.value || '').toLowerCase();
      const choices = this.api.listDevices()
        .filter(device => !query || device.name.toLowerCase().includes(query))
        .slice(0, 25)
        .map(device => ({ name: `${device.name} (${device.status})`, value: device.id }));
      return this.respond(interaction, 8, { choices });
    }
    if (interaction.type !== 2) return;

    if (!this.userAllowed(interaction)) {
      return this.respond(interaction, 4, { content: '⛔ このBotを操作する権限がありません。', flags: EPHEMERAL });
    }

    const name = interaction.data.name;
    try {
      if (name === 'devices') return await this.handleDevices(interaction);
      if (name === 'status') return await this.handleStatus(interaction);
      if (name === 'wake') return await this.handleWake(interaction);
      if (name === 'shutdown') return await this.handleShutdown(interaction);
    } catch (error) {
      this.log(`/${name} failed —`, error.message);
    }
  }

  findDeviceFromOptions(interaction) {
    const value = String(interaction.data.options?.[0]?.value || '');
    return this.api.findDevice(value);
  }

  async handleDevices(interaction) {
    const devices = this.api.listDevices();
    const content = devices.length
      ? devices.map(device => `${statusEmoji(device.status)} **${device.name}** — ${device.ip || device.localIp || 'IP未設定'} (${device.status})`).join('\n')
      : 'デバイスが登録されていません。';
    return this.respond(interaction, 4, { content });
  }

  async handleStatus(interaction) {
    await this.respond(interaction, 5, {}); // defer — metrics take a moment
    const host = await this.api.hostSnapshot();
    const devices = this.api.listDevices();
    const online = devices.filter(device => device.status === 'online').length;
    const lines = [
      `🍓 **${host.name}** — Tailscale ${host.tailscaleOnline ? '🟢 connected' : '🔴 offline'}`,
      `🌡 ${host.tempC != null ? `${host.tempC}°C` : '—'} · Load ${host.load1 ?? '—'} · Uptime ${formatUptime(host.uptimeSeconds)}`,
      `🖥 デバイス: ${online}/${devices.length} オンライン`,
    ];
    return this.editOriginal(interaction, lines.join('\n'));
  }

  async handleWake(interaction) {
    const device = this.findDeviceFromOptions(interaction);
    if (!device) return this.respond(interaction, 4, { content: '❓ デバイスが見つかりません。', flags: EPHEMERAL });
    if (device.status === 'online') {
      return this.respond(interaction, 4, { content: `🟢 **${device.name}** はすでにオンラインです。` });
    }
    await this.respond(interaction, 5, {});
    const job = await this.api.wake(device);
    await this.editOriginal(interaction, `⚡ **${device.name}** にMagic Packetを送信しました。起動を確認しています…`);
    const deadline = Date.now() + 150000;
    while (Date.now() < deadline && !TERMINAL_STATES.includes(job.state)) {
      await delay(3000);
    }
    if (job.state === 'ready') {
      return this.editOriginal(interaction, `✅ **${device.name}** が起動しました。SSH / リモートデスクトップに接続できます。`);
    }
    return this.editOriginal(interaction, `⏱ **${device.name}** の応答が確認できませんでした。電源とWake-on-LAN設定を確認してください。`);
  }

  async handleShutdown(interaction) {
    const device = this.findDeviceFromOptions(interaction);
    if (!device) return this.respond(interaction, 4, { content: '❓ デバイスが見つかりません。', flags: EPHEMERAL });
    if (device.status !== 'online') {
      return this.respond(interaction, 4, { content: `⚪ **${device.name}** はオフラインです。` });
    }
    await this.respond(interaction, 5, {});
    const result = await this.api.shutdown(device);
    if (result.sent) return this.editOriginal(interaction, `🌙 **${device.name}** にシャットダウン信号を送信しました。`);
    return this.editOriginal(interaction, `⚠️ シャットダウンできませんでした: ${result.error}`);
  }
}

export function startDiscordBot(config) {
  if (!config.token || !config.appId) {
    console.log('Discord bot: disabled (set PIWAKE_DISCORD_TOKEN and PIWAKE_DISCORD_APP_ID to enable)');
    return null;
  }
  if (typeof WebSocket === 'undefined') {
    console.log('Discord bot: requires Node.js 22+ (native WebSocket) — disabled');
    return null;
  }
  const bot = new DiscordBot(config);
  bot.start();
  return bot;
}
