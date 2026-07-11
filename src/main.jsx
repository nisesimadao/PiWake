import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, ArrowLeft, Check, ChevronRight, CircleHelp, Clock3, Cpu,
  MonitorUp as Desktop, ExternalLink, Globe2, Home, KeyRound, Monitor,
  Network, Plus, Power, Radio, RefreshCw, Router, Search, Server,
  Settings, ShieldCheck, SlidersHorizontal, Terminal,
  Thermometer, Trash2, Wifi, X
} from 'lucide-react';
import './styles.css';
import { loadAppState, resetAppState, saveAppState } from './lib/appState';
import { getApiToken, piwakeClient, runtime, setApiToken } from './services/piwakeClient';

const isApi = runtime.mode === 'api';

const demoHost = { name: 'raspberrypi-5', tempC: 46, cpuPercent: 2, uptimeSeconds: 195000, tailscaleIp: '100.100.1.1', tailscaleOnline: true };
const seedDevices = [
  { id: 'main', name: 'Main PC', kind: 'pc', ip: '100.100.1.23', mac: 'D4:5D:64:12:34:56', status: 'offline', last: '3日前', location: 'Home Office' },
  { id: 'sub', name: 'Sub PC', kind: 'pc', ip: '100.100.1.42', mac: '8C:47:BE:20:11:08', status: 'offline', last: '昨日', location: 'Desk' },
  { id: 'server', name: 'Home Server', kind: 'server', ip: '100.100.1.10', mac: '60:A4:B7:09:CF:2A', status: 'online', last: 'いま', location: 'Rack' },
];

const demoDiscovered = [
  { name: 'Office PC', ip: '192.168.1.66', mac: '3C:52:82:9A:11:22' },
  { name: 'Gaming PC', ip: '192.168.1.88', mac: '70:85:C2:55:AA:33', kind: 'pc' },
  { name: 'NAS', ip: '192.168.1.90', mac: '1C:69:7A:10:B8:44', kind: 'server' },
];

const statusText = { online: 'Online', offline: 'Offline', asleep: 'Asleep' };

function timeAgo(iso) {
  if (!iso) return '未接続';
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 90) return 'いま';
  if (seconds < 3600) return `${Math.round(seconds / 60)}分前`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}時間前`;
  if (seconds < 86400 * 2) return '昨日';
  return `${Math.round(seconds / 86400)}日前`;
}

function formatUptime(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

function deviceLast(device) {
  return device.last || timeAgo(device.lastSeenAt);
}

function reachableAddress(device) {
  return device.ip || device.localIp;
}

function openSsh(device, toast) {
  const address = reachableAddress(device);
  if (!address) return toast('接続先IPが設定されていません');
  window.location.href = `ssh://${device.user || 'pi'}@${address}`;
  toast('SSHクライアントを起動しています…');
}

function openChromeRemoteDesktop(toast) {
  window.open('https://remotedesktop.google.com/access', '_blank', 'noopener');
  toast('Chrome Remote Desktopを開きました');
}

function openRdp(device, toast) {
  const address = reachableAddress(device);
  if (!address) return toast('接続先IPが設定されていません');
  window.location.href = `rdp://full%20address=s:${address}`;
  toast(`RDPクライアントを起動しています… (${address})`);
}

function IconButton({ children, label, onClick, className = '' }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} onClick={onClick}>{children}</button>;
}

function Status({ value = 'offline', children }) {
  return <span className={`status status-${value}`}><i />{children || statusText[value]}</span>;
}

function HostBar({ hostInfo, onOpen }) {
  const online = hostInfo.tailscaleOnline !== false;
  return (
    <button className="host-bar squircle" onClick={onOpen}>
      <span className="host-mark"><Cpu size={20} /></span>
      <span className="host-copy"><strong>{hostInfo.name}</strong><Status value={online ? 'online' : 'offline'}>{online ? 'Tailscale connected' : 'Tailscale offline'}</Status></span>
      {hostInfo.tempC != null && <span className="host-meta"><Thermometer size={14} /> {hostInfo.tempC}°</span>}
      <ChevronRight size={18} />
    </button>
  );
}

function DeviceGlyph({ device, size = 26 }) {
  const glyphs = { host: Cpu, server: Server, pc: Monitor };
  const Glyph = glyphs[device.kind] || Monitor;
  return <span className={`device-glyph ${device.kind === 'host' ? 'host-glyph' : ''}`}><Glyph size={size} strokeWidth={1.7} /></span>;
}

function Nav({ view, setView }) {
  const items = [
    ['home', Home, 'Home'],
    ['devices', Server, 'Devices'],
    ['activity', Activity, 'Activity'],
  ];
  return <nav className="bottom-nav">{items.map(([id, Glyph, label]) => (
    <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Glyph size={21} /><span>{label}</span></button>
  ))}</nav>;
}

function AppHeader({ title, eyebrow, onBack, onSettings, trailing }) {
  return <header className="app-header">
    <div>{onBack && <IconButton label="戻る" onClick={onBack}><ArrowLeft size={21} /></IconButton>}</div>
    <div className="header-title">{eyebrow && <span>{eyebrow}</span>}<strong>{title}</strong></div>
    <div>{trailing || (onSettings && <IconButton label="設定" onClick={onSettings}><Settings size={21} /></IconButton>)}</div>
  </header>;
}

function QuickSwitch({ devices, selectedId, onSelect, onAdd }) {
  return <section className="quick-section">
    <div className="section-label">Quick switch</div>
    <div className="quick-switch">
      {devices.map(d => <button key={d.id} className={`quick-device squircle ${selectedId === d.id ? 'selected' : ''}`} onClick={() => onSelect(d.id)}>
        <DeviceGlyph device={d} size={25} /><span>{d.name}</span><Status value={d.status} />
      </button>)}
      <button className="quick-device add squircle" onClick={onAdd}><Plus size={24} /><span>Add</span></button>
    </div>
  </section>;
}

function DeviceStage({ device, onWake, onDetail, toast }) {
  const online = device.status === 'online';
  return <section className={`device-stage squircle ${online ? 'is-online' : ''}`}>
    <div className="stage-heading">
      <div><span className="overline">Selected device</span><h1>{device.name}</h1><Status value={device.status} /></div>
      <DeviceGlyph device={device} size={42} />
    </div>
    <dl className="facts">
      <div><dt>Tailscale IP</dt><dd>{device.ip || '未設定'}</dd></div>
      <div><dt>Last seen</dt><dd>{deviceLast(device)}</dd></div>
      <div><dt>Location</dt><dd>{device.location || 'Home'}</dd></div>
    </dl>
    <button className="primary-action" onClick={online ? () => openChromeRemoteDesktop(toast) : onWake}>
      {online ? <Desktop size={20} /> : <Power size={20} />}{online ? 'Open Desktop' : 'Wake and connect'}
    </button>
    <div className="action-pair">
      <button onClick={() => openSsh(device, toast)}><Terminal size={18} />Open SSH</button>
      <button onClick={() => openChromeRemoteDesktop(toast)}><ExternalLink size={18} />Chrome RDP</button>
    </div>
    <button className="text-link" onClick={onDetail}>接続方法と設定 <ChevronRight size={15} /></button>
  </section>;
}

function HomeView({ devices, selectedId, setSelectedId, setView, startWake, toast, hostInfo }) {
  const selected = devices.find(d => d.id === selectedId) || devices[0];
  return <>
    <AppHeader title="PiWake" onSettings={() => setView('settings')} />
    <HostBar hostInfo={hostInfo} onOpen={() => setView('host')} />
    <main className="screen-body home-body">
      <p className="greeting" aria-hidden="true">Away from home.<br /><span>Your machines are still within reach.</span></p>
      {selected
        ? <DeviceStage device={selected} onWake={() => startWake(selected)} onDetail={() => setView('detail')} toast={toast} />
        : <section className="device-stage squircle empty-stage"><h1>デバイスがありません</h1><p className="page-lead">最初の管理対象デバイスを追加してください。</p><button className="primary-action" onClick={() => setView('add')}><Plus size={20} />Add device</button></section>}
      <QuickSwitch devices={devices} selectedId={selectedId} onSelect={setSelectedId} onAdd={() => setView('add')} />
    </main>
  </>;
}

function DeviceRow({ device, selected, onClick, actions }) {
  return <button className={`device-row ${selected ? 'selected' : ''}`} onClick={onClick}>
    <DeviceGlyph device={device} />
    <span className="row-copy"><strong>{device.name}</strong><small>{device.ip || device.localIp || 'IP未設定'}</small><Status value={device.status} /></span>
    {actions || <ChevronRight size={18} />}
  </button>;
}

function DevicesView({ devices, selectedId, selectDevice, setView, hostInfo }) {
  return <>
    <AppHeader title="Devices" trailing={<IconButton label="デバイス追加" onClick={() => setView('add')}><Plus size={22} /></IconButton>} />
    <main className="screen-body">
      <HostBar hostInfo={hostInfo} onOpen={() => setView('host')} />
      <div className="section-label">Managed devices · {devices.length}</div>
      <section className="device-list squircle">
        {devices.map(d => <DeviceRow key={d.id} device={d} selected={d.id === selectedId} onClick={() => { selectDevice(d.id); setView('detail'); }} />)}
        {!devices.length && <div className="empty-row">まだデバイスがありません</div>}
      </section>
      <button className="secondary-action" onClick={() => setView('add')}><Plus size={18} /> Add device</button>
    </main>
  </>;
}

function ConnectionRow({ icon: Glyph, title, detail, accent, onClick }) {
  return <button className="connection-row" onClick={onClick}>
    <span className={accent ? 'connection-icon accent' : 'connection-icon'}><Glyph size={19} /></span>
    <span><strong>{title}</strong><small>{detail}</small></span><ChevronRight size={17} />
  </button>;
}

function DetailView({ device, setView, startWake, removeDevice, toast }) {
  if (!device) return null;
  const address = reachableAddress(device);
  return <>
    <AppHeader title={device.name} eyebrow="Managed device" onBack={() => setView('devices')} trailing={<IconButton label="デバイスを削除" onClick={() => removeDevice(device)}><Trash2 size={20} /></IconButton>} />
    <main className="screen-body detail-body">
      <section className="identity-block">
        <DeviceGlyph device={device} size={42} /><div><h1>{device.name}</h1><Status value={device.status} /></div>
      </section>
      {device.status !== 'online' && <button className="primary-action" onClick={() => startWake(device)}><Power size={20} />Wake and connect</button>}
      <div className="section-label">Connection stack</div>
      <section className="connection-list squircle">
        <ConnectionRow icon={Terminal} title="SSH" detail={`ssh ${device.user || 'pi'}@${address || '—'}`} accent onClick={() => openSsh(device, toast)} />
        <ConnectionRow icon={ExternalLink} title="Chrome Remote Desktop" detail="Open installed app or web client" onClick={() => openChromeRemoteDesktop(toast)} />
        <ConnectionRow icon={Desktop} title="RDP" detail={address ? `rdp://${address}` : 'Microsoft Remote Desktop'} onClick={() => openRdp(device, toast)} />
        <ConnectionRow icon={Globe2} title="Web service" detail="No service configured" onClick={() => setView('connections')} />
      </section>
      <div className="section-label">Device</div>
      <section className="facts detail-facts squircle">
        <div><dt>MAC</dt><dd>{device.mac}</dd></div>
        <div><dt>Local IP</dt><dd>{device.localIp || '未設定'}</dd></div>
        <div><dt>Tailscale IP</dt><dd>{device.ip || '未設定'}</dd></div>
        <div><dt>Last seen</dt><dd>{deviceLast(device)}</dd></div>
      </section>
      <section className="setting-list squircle">
        <button onClick={() => setView('connections')}><Network size={18} /><span>Wake & network settings</span><ChevronRight size={17} /></button>
      </section>
    </main>
  </>;
}

function WakeConfirm({ device, hostName, onCancel, onConfirm }) {
  return <div className="modal-layer" role="presentation" onMouseDown={event => event.target === event.currentTarget && onCancel()}><div className="confirm-sheet squircle" role="dialog" aria-modal="true" aria-labelledby="wake-dialog-title">
    <div className="confirm-icon"><Power size={26} /></div><h2 id="wake-dialog-title">Wake {device.name}?</h2>
    <p>自宅の {hostName} からMagic Packetを送信し、Tailscaleで到達可能になるまで確認します。</p>
    <div className="confirm-device"><DeviceGlyph device={device} /><span><strong>{device.name}</strong><small>{device.mac}</small></span></div>
    <button className="primary-action" onClick={onConfirm}>Wake and connect</button>
    <button className="quiet-action" onClick={onCancel}>Cancel</button>
  </div></div>;
}

function WakeProgress({ device, step, failed, cancel, finish }) {
  const steps = [
    ['Magic packet sent', 'Wake-on-LAN packet delivered.'],
    ['Device responding', 'Host is online on your home network.'],
    ['Tailscale reachable', 'Device reachable over your tailnet.'],
    ['Remote access ready', 'SSH and desktop services are available.'],
  ];
  return <>
    <AppHeader title={`Waking ${device.name}`} onBack={cancel} />
    <main className="screen-body progress-body"><p className="page-lead">{failed ? 'Wakeに失敗しました。電源とWOL設定を確認してください。' : 'This may take a few moments.'}</p>
      <section className="progress-rail squircle">{steps.map(([title, detail], i) => {
        const state = i < step ? 'done' : i === step ? 'current' : 'pending';
        return <div className={`progress-step ${state}`} key={title}><span className="step-dot">{state === 'done' ? <Check size={16} /> : i + 1}</span><div><strong>{title}</strong><small>{detail}</small></div></div>;
      })}</section>
      <div className="progress-device squircle"><DeviceGlyph device={device} /><span><strong>{device.name}</strong><small>{device.ip || device.localIp}</small></span><Status value={step >= 4 ? 'online' : 'asleep'}>{step >= 4 ? 'Ready' : failed ? 'Failed' : 'Preparing'}</Status></div>
      {step >= 4 ? <div className="ready-actions"><button className="primary-action" onClick={() => finish('desktop')}><Desktop size={19} />Open Desktop</button><button className="secondary-action" onClick={() => finish('ssh')}><Terminal size={18} />Open SSH</button></div> : <button className="secondary-action danger" onClick={cancel}>{failed ? 'Back' : 'Cancel'}</button>}
    </main>
  </>;
}

function AddDevice({ onBack, addDevice, setView, hostInfo, toast }) {
  const [tab, setTab] = useState('scan');
  const [scanning, setScanning] = useState(true);
  const [found, setFound] = useState(isApi ? [] : demoDiscovered);
  const runScan = useCallback(async () => {
    setScanning(true);
    if (!isApi) {
      setTimeout(() => setScanning(false), 1200);
      return;
    }
    try {
      const neighbours = await piwakeClient.scanNetwork();
      setFound((neighbours || [])
        .filter(entry => !entry.managed)
        .map(entry => ({ name: entry.name || entry.ip, ip: entry.ip, mac: entry.mac })));
    } catch {
      toast('ネットワークスキャンに失敗しました');
    } finally {
      setScanning(false);
    }
  }, [toast]);
  useEffect(() => { runScan(); }, [runScan]);
  return <>
    <AppHeader title="Add device" onBack={onBack} />
    <main className="screen-body">
      <HostBar hostInfo={hostInfo} onOpen={() => setView('host')} />
      <div className="segmented"><button className={tab === 'scan' ? 'active' : ''} onClick={() => setTab('scan')}><Search size={17} />Find on network</button><button className={tab === 'manual' ? 'active' : ''} onClick={() => setTab('manual')}><SlidersHorizontal size={17} />Manual</button></div>
      {tab === 'scan' ? <>
        <section className="scan-panel squircle"><span className={scanning ? 'radar spinning' : 'radar'}><Radio size={27} /></span><div><strong>{scanning ? 'Scanning your network' : `${found.length} devices found`}</strong><p>{scanning ? 'Looking for devices that support Wake-on-LAN.' : 'Select a device to configure Wake-on-LAN.'}</p></div><IconButton label="再検索" onClick={runScan}><RefreshCw size={18} /></IconButton></section>
        <div className="section-label">Discovered devices</div>
        <section className="device-list squircle">
          {found.map((d, i) => <div className="discovery-row" key={d.mac}><DeviceGlyph device={d} /><span><strong>{d.name}</strong><small>{d.ip} · {d.mac}</small></span><button onClick={() => addDevice({ name: d.name, localIp: d.ip, mac: d.mac, kind: d.kind || 'pc' })}>Add</button></div>)}
          {!found.length && !scanning && <div className="empty-row">WOL対応デバイスが見つかりませんでした</div>}
        </section>
        <button className="help-row squircle"><CircleHelp size={22} /><span><strong>Can’t find your device?</strong><small>同じネットワークとWOL設定を確認</small></span><ChevronRight size={17} /></button>
      </> : <ManualForm addDevice={addDevice} />}
    </main>
  </>;
}

function ManualForm({ addDevice }) {
  const [name, setName] = useState('New PC');
  const [localIp, setLocalIp] = useState('192.168.1.');
  const [tailscaleIp, setTailscaleIp] = useState('');
  const [mac, setMac] = useState('');
  const [user, setUser] = useState('');
  return <form className="manual-form squircle" onSubmit={e => {
    e.preventDefault();
    addDevice({ name: name.trim(), localIp: localIp.trim(), ip: tailscaleIp.trim() || null, mac: mac.toUpperCase(), user: user.trim() || null, kind: 'pc' });
  }}>
    <label>Device name<input required maxLength="48" autoComplete="off" value={name} onChange={e => setName(e.target.value)} /></label>
    <label>Local IP<input required inputMode="decimal" autoComplete="off" pattern="^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$" title="192.168.1.20 の形式で入力" value={localIp} onChange={e => setLocalIp(e.target.value)} /></label>
    <label>MAC address<input required autoCapitalize="characters" autoComplete="off" pattern="^([0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}$" title="AA:BB:CC:DD:EE:FF の形式で入力" placeholder="AA:BB:CC:DD:EE:FF" value={mac} onChange={e => setMac(e.target.value)} /></label>
    <label>Tailscale IP（任意）<input inputMode="decimal" autoComplete="off" placeholder="100.x.y.z" value={tailscaleIp} onChange={e => setTailscaleIp(e.target.value)} /></label>
    <label>SSH user（任意・既定は pi）<input autoComplete="off" placeholder="pi" value={user} onChange={e => setUser(e.target.value)} /></label>
    <button className="primary-action" type="submit">Continue</button>
  </form>;
}

function HostDetail({ setView, toast, hostInfo }) {
  const online = hostInfo.tailscaleOnline !== false;
  return <>
    <AppHeader title="Raspberry Pi host" onBack={() => setView('home')} />
    <main className="screen-body detail-body">
      <section className="host-hero"><span className="host-mark large"><Cpu size={34} /></span><div><h1>{hostInfo.name}</h1><Status value={online ? 'online' : 'offline'}>{online ? 'Tailscale connected' : 'Tailscale offline'}</Status></div></section>
      <section className="host-metrics squircle">
        <div><Thermometer /><strong>{hostInfo.tempC != null ? `${hostInfo.tempC}°` : '—'}</strong><span>CPU temp</span></div>
        <div><Activity /><strong>{hostInfo.cpuPercent != null ? `${hostInfo.cpuPercent}%` : '—'}</strong><span>CPU</span></div>
        <div><Clock3 /><strong>{formatUptime(hostInfo.uptimeSeconds)}</strong><span>Uptime</span></div>
      </section>
      <div className="section-label">Connect to this Pi</div>
      <section className="connection-list squircle">
        <ConnectionRow icon={Terminal} title="SSH" detail={`ssh pi@${hostInfo.tailscaleIp || hostInfo.name}`} accent onClick={() => openSsh({ user: 'pi', ip: hostInfo.tailscaleIp || hostInfo.name }, toast)} />
        <ConnectionRow icon={Desktop} title="Desktop" detail="Chrome Remote Desktop" onClick={() => openChromeRemoteDesktop(toast)} />
        <ConnectionRow icon={Globe2} title="PiWake Web" detail="Open host web console" onClick={() => toast('このWebコンソールです')} />
      </section>
      <div className="section-label">Host services</div>
      <section className="service-panel squircle">
        <div><ShieldCheck /><span><strong>PiWake API</strong><Status value={isApi ? 'online' : 'asleep'}>{isApi ? 'Online' : 'Demo'}</Status></span></div>
        <div><Network /><span><strong>LAN relay</strong><Status value="online" /></span></div>
        <div><Router /><span><strong>Tailscale</strong><Status value={online ? 'online' : 'offline'} /></span></div>
      </section>
      <p className="danger-note">ホストの停止・再起動はSSH経由で実行してください。</p>
    </main>
  </>;
}

const activityGlyphs = [
  [/packet|wake/i, Power],
  [/ssh/i, Terminal],
  [/desktop/i, Desktop],
  [/added/i, Plus],
  [/removed/i, X],
];

function activityGlyph(action) {
  const matched = activityGlyphs.find(([pattern]) => pattern.test(action));
  return matched ? matched[1] : Activity;
}

function formatActivityTime(iso) {
  const date = new Date(iso);
  const sameDay = new Date().toDateString() === date.toDateString();
  const time = date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `Today, ${time}` : `${date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}, ${time}`;
}

function ActivityView({ toast }) {
  const [logs, setLogs] = useState(null);
  useEffect(() => {
    if (!isApi) {
      setLogs([
        { id: 'd1', deviceName: 'Main PC', action: 'Wake succeeded', at: null, time: 'Today, 09:41', result: 'success' },
        { id: 'd2', deviceName: 'raspberrypi-5', action: 'SSH opened', at: null, time: 'Yesterday, 22:08', result: 'neutral' },
        { id: 'd3', deviceName: 'Sub PC', action: 'Wake timed out', at: null, time: 'Jul 8, 18:32', result: 'warning' },
        { id: 'd4', deviceName: 'Home Server', action: 'Desktop opened', at: null, time: 'Jul 7, 11:04', result: 'neutral' },
      ]);
      return;
    }
    let cancelled = false;
    piwakeClient.getActivity()
      .then(entries => { if (!cancelled) setLogs(entries || []); })
      .catch(() => { if (!cancelled) { setLogs([]); toast('履歴を取得できませんでした'); } });
    return () => { cancelled = true; };
  }, [toast]);
  return <><AppHeader title="Activity" /><main className="screen-body"><p className="page-lead">Recent activity across your tailnet.</p>
    <section className="timeline">
      {(logs || []).map(entry => {
        const Glyph = activityGlyph(entry.action);
        return <div className="timeline-row" key={entry.id}><span className={`timeline-icon ${entry.result}`}><Glyph size={18} /></span><span><strong>{entry.action}</strong><small>{entry.deviceName} · {entry.time || formatActivityTime(entry.at)}</small></span></div>;
      })}
      {logs && !logs.length && <div className="empty-row">まだ履歴がありません</div>}
    </section></main></>;
}

function SettingsView({ setView, toast, resetDemo }) {
  const [checking, setChecking] = useState(false);
  const [token, setToken] = useState(getApiToken());
  const checkConnection = async () => {
    setChecking(true);
    try {
      const health = await piwakeClient.checkHealth();
      toast(health.authRequired && !getApiToken() ? 'APIトークンが必要です' : `${runtime.label} is ready`);
    }
    catch (error) { toast(error.status === 401 ? 'APIトークンが正しくありません' : 'APIへ接続できませんでした'); }
    finally { setChecking(false); }
  };
  const saveToken = event => {
    event.preventDefault();
    setApiToken(token.trim());
    toast(token.trim() ? 'APIトークンを保存しました' : 'APIトークンを削除しました');
    checkConnection();
  };
  return <><AppHeader title="Settings" onBack={() => setView('home')} /><main className="screen-body">
    <section className="settings-intro"><ShieldCheck size={30} /><h1>Tailscale-first</h1><p>PiWakeは公開ポートを使わず、あなたのtailnet内だけで通信します。</p></section>
    <div className="section-label">Runtime</div><section className="runtime-panel squircle"><div><span className={`runtime-dot ${runtime.mode}`} /><span><strong>{runtime.label}</strong><small>{runtime.apiBaseUrl || 'Local state · no network calls'}</small></span></div><button type="button" onClick={checkConnection} disabled={checking}>{checking ? 'Checking…' : 'Check'}</button></section>
    {isApi && <>
      <div className="section-label">API token</div>
      <form className="manual-form squircle token-form" onSubmit={saveToken}>
        <label><span className="token-label"><KeyRound size={13} /> Bearer token（Piの PIWAKE_TOKEN と同じ値）</span>
          <input type="password" autoComplete="off" placeholder="未設定（Tailscale ACLで保護）" value={token} onChange={e => setToken(e.target.value)} /></label>
        <button className="secondary-action" type="submit">Save token</button>
      </form>
    </>}
    <div className="section-label">Security</div><section className="setting-list squircle"><button><ShieldCheck size={18} /><span>Tailnet access</span><Status value="online">Connected</Status></button><button onClick={checkConnection}><Network size={18} /><span>Connection diagnostics</span><ChevronRight size={17} /></button></section>
    {runtime.mode === 'demo' && <button className="quiet-action reset-demo" type="button" onClick={resetDemo}>Reset demo data</button>}
  </main></>;
}

function ConnectionSetup({ setView }) {
  const [selected, setSelected] = useState(['ssh', 'chrome']);
  const methods = [['ssh', Terminal, 'SSH', 'Terminal client'], ['chrome', ExternalLink, 'Chrome Remote Desktop', 'Browser or installed app'], ['rdp', Desktop, 'RDP', 'Microsoft Remote Desktop'], ['web', Globe2, 'Web URL', 'Custom service']];
  return <><AppHeader title="Connection setup" onBack={() => setView('detail')} /><main className="screen-body"><p className="page-lead">Choose what becomes available after the device wakes.</p><section className="method-list">{methods.map(([id, Glyph, name, detail]) => <button className={`method squircle ${selected.includes(id) ? 'selected' : ''}`} key={id} onClick={() => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])}><Glyph size={22} /><span><strong>{name}</strong><small>{detail}</small></span><span className="check-box">{selected.includes(id) && <Check size={14} />}</span></button>)}</section><button className="primary-action" onClick={() => setView('detail')}>Save connection stack</button></main></>;
}

const jobStateToStep = { packet_sent: 1, responding: 2, reachable: 3, ready: 4 };

function App() {
  const initialState = useMemo(() => loadAppState(seedDevices), []);
  const [view, setView] = useState('home');
  const [devices, setDevices] = useState(isApi ? [] : initialState.devices);
  const [selectedId, setSelectedId] = useState(initialState.selectedId);
  const [hostInfo, setHostInfo] = useState(demoHost);
  const [apiIssue, setApiIssue] = useState('');
  const [wakeDevice, setWakeDevice] = useState(null);
  const [wakeJobId, setWakeJobId] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [step, setStep] = useState(0);
  const [wakeFailed, setWakeFailed] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const toastTimer = useRef();
  const selected = devices.find(d => d.id === selectedId) || devices[0];
  const toast = useCallback(message => {
    clearTimeout(toastTimer.current);
    setToastMessage(message);
    toastTimer.current = setTimeout(() => setToastMessage(''), 2600);
  }, []);

  const refreshFromApi = useCallback(async () => {
    if (!isApi) return;
    try {
      const [list, host] = await Promise.all([piwakeClient.listDevices(), piwakeClient.getHost()]);
      if (Array.isArray(list)) {
        setDevices(list);
        setSelectedId(current => list.some(d => d.id === current) ? current : list[0]?.id);
      }
      if (host) setHostInfo(host);
      setApiIssue('');
    } catch (error) {
      setApiIssue(error.status === 401 ? 'APIトークンが必要です。Settingsで設定してください。' : 'PiWake APIに接続できません。');
    }
  }, []);

  useEffect(() => {
    if (!isApi) return;
    refreshFromApi();
    const id = setInterval(refreshFromApi, 15000);
    return () => clearInterval(id);
  }, [refreshFromApi]);

  const startWake = device => { setWakeDevice(device); setConfirming(true); };

  const confirmWake = async () => {
    setConfirming(false); setStep(0); setWakeFailed(false); setView('waking');
    try {
      const result = await piwakeClient.wakeDevice(wakeDevice);
      setWakeJobId(result?.jobId || null);
      if (isApi) setStep(1);
    }
    catch (error) { setView('home'); toast(error.status === 401 ? 'APIトークンが必要です' : 'Wakeリクエストを送信できませんでした'); }
  };

  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => { if (!isApi) saveAppState({ devices, selectedId }); }, [devices, selectedId]);

  // Demo mode: simulated progress. API mode: poll the wake job on the Pi.
  useEffect(() => {
    if (view !== 'waking' || step >= 4 || wakeFailed) return;
    if (!isApi) {
      const id = setTimeout(() => setStep(s => s + 1), 850);
      return () => clearTimeout(id);
    }
    if (!wakeJobId) return;
    const id = setInterval(async () => {
      try {
        const job = await piwakeClient.getWakeJob(wakeJobId);
        if (job.state in jobStateToStep) setStep(jobStateToStep[job.state]);
        if (['timeout', 'failed'].includes(job.state)) { setWakeFailed(true); toast(job.state === 'timeout' ? 'Wakeがタイムアウトしました' : 'Wakeに失敗しました'); }
        if (job.state === 'ready') refreshFromApi();
      } catch { /* transient poll error — keep trying until timeout */ }
    }, 1500);
    return () => clearInterval(id);
  }, [view, step, wakeJobId, wakeFailed, refreshFromApi, toast]);

  const cancelWake = () => {
    piwakeClient.cancelWakeJob(wakeJobId).catch(() => {});
    setWakeJobId(null);
    setView('home');
  };

  const finishWake = target => {
    if (isApi) refreshFromApi();
    else setDevices(ds => ds.map(d => d.id === wakeDevice.id ? { ...d, status: 'online', last: 'いま' } : d));
    setWakeJobId(null);
    setView('home');
    if (target === 'ssh') openSsh(wakeDevice, toast);
    else openChromeRemoteDesktop(toast);
  };

  const addDevice = async payload => {
    try {
      const created = await piwakeClient.addDevice({
        ...payload,
        id: isApi ? undefined : `added-${Date.now()}`,
        status: 'offline',
        location: payload.location || 'Home',
      });
      if (isApi) {
        await refreshFromApi();
        setSelectedId(created.id);
      } else {
        setDevices(ds => [...ds, created]);
        setSelectedId(created.id);
      }
      setView('connections');
      toast(`${payload.name}を追加しました`);
    } catch (error) {
      toast(error.message?.includes('already exists') ? 'このMACアドレスは登録済みです' : 'デバイスを追加できませんでした');
    }
  };

  const removeDevice = async device => {
    if (!window.confirm(`${device.name} を削除しますか？`)) return;
    try {
      await piwakeClient.removeDevice(device.id);
      if (isApi) await refreshFromApi();
      else setDevices(ds => ds.filter(d => d.id !== device.id));
      setView('devices');
      toast(`${device.name}を削除しました`);
    } catch {
      toast('デバイスを削除できませんでした');
    }
  };

  const resetDemo = () => { resetAppState(); setDevices(seedDevices); setSelectedId('main'); setView('home'); toast('デモデータをリセットしました'); };

  const content = (() => {
    if (view === 'home') return <HomeView devices={devices} selectedId={selectedId} setSelectedId={setSelectedId} setView={setView} startWake={startWake} toast={toast} hostInfo={hostInfo} />;
    if (view === 'devices') return <DevicesView devices={devices} selectedId={selectedId} selectDevice={setSelectedId} setView={setView} hostInfo={hostInfo} />;
    if (view === 'detail') return <DetailView device={selected} setView={setView} startWake={startWake} removeDevice={removeDevice} toast={toast} />;
    if (view === 'waking') return <WakeProgress device={wakeDevice || selected} step={step} failed={wakeFailed} cancel={cancelWake} finish={finishWake} />;
    if (view === 'add') return <AddDevice onBack={() => setView('devices')} addDevice={addDevice} setView={setView} hostInfo={hostInfo} toast={toast} />;
    if (view === 'host') return <HostDetail setView={setView} toast={toast} hostInfo={hostInfo} />;
    if (view === 'activity') return <ActivityView toast={toast} />;
    if (view === 'settings') return <SettingsView setView={setView} toast={toast} resetDemo={resetDemo} />;
    if (view === 'connections') return <ConnectionSetup setView={setView} />;
  })();
  const showNav = ['home', 'devices', 'activity'].includes(view);
  return <div className="site-shell"><div className="ambient" /><aside className="desktop-rail"><div className="brand"><Power size={20} /><span>PiWake</span></div><p>Home access,<br />quietly handled.</p><nav><button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}><Home />Home</button><button className={view === 'devices' ? 'active' : ''} onClick={() => setView('devices')}><Server />Devices</button><button className={view === 'activity' ? 'active' : ''} onClick={() => setView('activity')}><Activity />Activity</button></nav><div className="rail-footer"><div className="rail-runtime"><Status value={apiIssue ? 'offline' : 'online'}>{apiIssue ? 'API unreachable' : 'Tailnet connected'}</Status><small>{runtime.label}</small></div><button onClick={() => setView('settings')}><Settings size={17} />Settings</button></div></aside><div className="app-frame">{apiIssue && <button className="api-banner" onClick={() => setView('settings')}><Wifi size={14} />{apiIssue}<ChevronRight size={14} /></button>}{content}{showNav && <Nav view={view} setView={setView} />}{confirming && wakeDevice && <WakeConfirm device={wakeDevice} hostName={hostInfo.name} onCancel={() => setConfirming(false)} onConfirm={confirmWake} />}{toastMessage && <div className="toast" role="status" aria-live="polite"><Check size={16} />{toastMessage}</div>}</div></div>;
}

createRoot(document.getElementById('root')).render(<App />);
