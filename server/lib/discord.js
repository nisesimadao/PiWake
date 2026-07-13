// Minimal Discord gateway bot — zero dependencies, outbound-only (works
// behind Tailscale with no open ports). Requires Node.js 22+ for the
// native global WebSocket; the feature disables itself otherwise.
import { setTimeout as delay } from 'node:timers/promises';

const API = 'https://discord.com/api/v10';
const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const EPHEMERAL = 64;
const TERMINAL_STATES = ['ready', 'timeout', 'failed', 'cancelled'];

const COMMANDS = [
  { name: 'devices', type: 1, description: '操作パネルを表示（デバイス選択→起動/Ping/停止）' },
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

const COLOR_ACCENT = 0xf04454;
const COLOR_ONLINE = 0x42d68a;
const COLOR_MUTED = 0x8d96a5;

const OS_LABELS = { windows: 'Windows', macos: 'macOS', linux: 'Linux', raspberrypi: 'Raspberry Pi' };

function button(customId, label, { style = 2, emoji, disabled = false } = {}) {
  return { type: 2, style, custom_id: customId, label, disabled, ...(emoji ? { emoji: { name: emoji } } : {}) };
}

// The /devices control panel: device picker + refresh.
function listPanel(devices) {
  const description = devices.length
    ? devices.map(device => `${statusEmoji(device.status)} **${device.name}** — ${device.ip || device.localIp || 'IP未設定'} (${device.status})`).join('\n')
    : 'デバイスが登録されていません。';
  const components = [];
  if (devices.length) {
    components.push({
      type: 1,
      components: [{
        type: 3,
        custom_id: 'pw:select',
        placeholder: 'デバイスを選んで操作…',
        options: devices.slice(0, 25).map(device => ({
          label: device.name,
          value: device.id,
          description: `${device.status} · ${device.ip || device.localIp || 'IP未設定'}`,
          emoji: { name: statusEmoji(device.status) },
        })),
      }],
    });
  }
  components.push({ type: 1, components: [button('pw:refresh', '更新', { emoji: '🔄' })] });
  return {
    embeds: [{
      title: '🍓 PiWake 操作パネル',
      description,
      color: COLOR_ACCENT,
      footer: { text: 'デバイスを選択すると操作ボタンが表示されます' },
    }],
    components,
  };
}

// Per-device panel: wake / ping / shutdown buttons plus navigation.
function detailPanel(device, { note = '', busy = false } = {}) {
  const online = device.status === 'online';
  return {
    embeds: [{
      title: `${statusEmoji(device.status)} ${device.name}`,
      description: note || undefined,
      color: online ? COLOR_ONLINE : COLOR_MUTED,
      fields: [
        { name: '状態', value: device.status, inline: true },
        { name: 'OS', value: OS_LABELS[device.os] || '—', inline: true },
        { name: 'Last seen', value: device.lastSeenAt ? `<t:${Math.floor(new Date(device.lastSeenAt).getTime() / 1000)}:R>` : '未接続', inline: true },
        { name: 'Tailscale IP', value: device.ip || '未設定', inline: true },
        { name: 'Local IP', value: device.localIp || '未設定', inline: true },
        { name: 'MAC', value: `\`${device.mac}\``, inline: true },
      ],
    }],
    components: [
      {
        type: 1,
        components: [
          button(`pw:wake:${device.id}`, '起動', { style: 3, emoji: '⚡', disabled: online || busy }),
          button(`pw:ping:${device.id}`, 'Ping', { emoji: '📶', disabled: busy }),
          button(`pw:shutdown:${device.id}`, '停止', { style: 4, emoji: '🌙', disabled: !online || busy }),
        ],
      },
      {
        type: 1,
        components: [
          button('pw:back', '一覧に戻る', { emoji: '↩️' }),
          button(`pw:detail:${device.id}`, '更新', { emoji: '🔄' }),
        ],
      },
    ],
  };
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

  editOriginal(interaction, payload) {
    const body = typeof payload === 'string' ? { content: payload } : payload;
    return this.rest('PATCH', `/webhooks/${this.appId}/${interaction.token}/messages/@original`, body);
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
    if (interaction.type !== 2 && interaction.type !== 3) return;

    if (!this.userAllowed(interaction)) {
      return this.respond(interaction, 4, { content: '⛔ このBotを操作する権限がありません。', flags: EPHEMERAL });
    }

    if (interaction.type === 3) { // component (button / select) on the panel
      try {
        return await this.onComponent(interaction);
      } catch (error) {
        this.log('component failed —', error.message);
        return;
      }
    }

    const name = interaction.data.name;
    try {
      if (name === 'devices') return await this.respond(interaction, 4, listPanel(this.api.listDevices()));
      if (name === 'status') return await this.handleStatus(interaction);
      if (name === 'wake') return await this.handleWake(interaction);
      if (name === 'shutdown') return await this.handleShutdown(interaction);
    } catch (error) {
      this.log(`/${name} failed —`, error.message);
    }
  }

  async onComponent(interaction) {
    const customId = interaction.data.custom_id || '';
    const [, action, deviceId] = customId.split(':');
    if (action === 'refresh' || action === 'back') {
      return this.respond(interaction, 7, listPanel(this.api.listDevices()));
    }
    const targetId = action === 'select' ? interaction.data.values?.[0] : deviceId;
    const device = this.api.findDevice(targetId || '');
    if (!device) {
      return this.respond(interaction, 7, listPanel(this.api.listDevices()));
    }
    if (action === 'select' || action === 'detail') {
      return this.respond(interaction, 7, detailPanel(device));
    }
    if (action === 'ping') {
      await this.respond(interaction, 6, {}); // deferred panel update
      const result = await this.api.ping(device);
      return this.editOriginal(interaction, detailPanel(device, {
        note: result.alive ? `📶 Ping応答あり（${result.via === 'tailscale' ? 'Tailscale' : 'LAN'}経由）` : '📴 Ping応答がありません',
      }));
    }
    if (action === 'wake') {
      if (device.status === 'online') {
        return this.respond(interaction, 7, detailPanel(device, { note: '🟢 すでにオンラインです。' }));
      }
      await this.respond(interaction, 7, detailPanel(device, { note: '⚡ Magic Packetを送信しました。起動を確認しています…', busy: true }));
      const job = await this.api.wake(device);
      const state = await this.waitForJob(job);
      const note = state === 'ready'
        ? '✅ 起動しました。SSH / リモートデスクトップに接続できます。'
        : '⏱ 応答が確認できませんでした。電源とWake-on-LAN設定を確認してください。';
      return this.editOriginal(interaction, detailPanel(device, { note }));
    }
    if (action === 'shutdown') {
      if (device.status !== 'online') {
        return this.respond(interaction, 7, detailPanel(device, { note: '⚪ すでにオフラインです。' }));
      }
      await this.respond(interaction, 6, {});
      const result = await this.api.shutdown(device);
      return this.editOriginal(interaction, detailPanel(device, {
        note: result.sent ? '🌙 シャットダウン信号を送信しました。' : `⚠️ シャットダウンできませんでした: ${result.error}`,
      }));
    }
  }

  async waitForJob(job, timeoutMs = 150000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !TERMINAL_STATES.includes(job.state)) {
      await delay(3000);
    }
    return job.state;
  }

  findDeviceFromOptions(interaction) {
    const value = String(interaction.data.options?.[0]?.value || '');
    return this.api.findDevice(value);
  }

  async handleStatus(interaction) {
    await this.respond(interaction, 5, {}); // defer — metrics take a moment
    const host = await this.api.hostSnapshot();
    const devices = this.api.listDevices();
    const online = devices.filter(device => device.status === 'online').length;
    return this.editOriginal(interaction, {
      embeds: [{
        title: `🍓 ${host.name}`,
        color: host.tailscaleOnline ? COLOR_ONLINE : COLOR_ACCENT,
        fields: [
          { name: 'Tailscale', value: host.tailscaleOnline ? '🟢 connected' : '🔴 offline', inline: true },
          { name: 'CPU温度', value: host.tempC != null ? `${host.tempC}°C` : '—', inline: true },
          { name: 'Load avg', value: String(host.load1 ?? '—'), inline: true },
          { name: 'Uptime', value: formatUptime(host.uptimeSeconds), inline: true },
          { name: 'デバイス', value: `${online}/${devices.length} オンライン`, inline: true },
        ],
      }],
    });
  }

  async handleWake(interaction) {
    const device = this.findDeviceFromOptions(interaction);
    if (!device) return this.respond(interaction, 4, { content: '❓ デバイスが見つかりません。', flags: EPHEMERAL });
    if (device.status === 'online') {
      return this.respond(interaction, 4, { content: `🟢 **${device.name}** はすでにオンラインです。` });
    }
    await this.respond(interaction, 5, {});
    const job = await this.api.wake(device);
    await this.editOriginal(interaction, detailPanel(device, { note: '⚡ Magic Packetを送信しました。起動を確認しています…', busy: true }));
    const state = await this.waitForJob(job);
    const note = state === 'ready'
      ? '✅ 起動しました。SSH / リモートデスクトップに接続できます。'
      : '⏱ 応答が確認できませんでした。電源とWake-on-LAN設定を確認してください。';
    return this.editOriginal(interaction, detailPanel(device, { note }));
  }

  async handleShutdown(interaction) {
    const device = this.findDeviceFromOptions(interaction);
    if (!device) return this.respond(interaction, 4, { content: '❓ デバイスが見つかりません。', flags: EPHEMERAL });
    if (device.status !== 'online') {
      return this.respond(interaction, 4, { content: `⚪ **${device.name}** はオフラインです。` });
    }
    await this.respond(interaction, 5, {});
    const result = await this.api.shutdown(device);
    return this.editOriginal(interaction, detailPanel(device, {
      note: result.sent ? '🌙 シャットダウン信号を送信しました。' : `⚠️ シャットダウンできませんでした: ${result.error}`,
    }));
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
