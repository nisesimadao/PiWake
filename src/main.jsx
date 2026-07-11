import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, ArrowLeft, Check, ChevronRight, CircleHelp, Clock3, Cpu,
  MonitorUp as Desktop, Ellipsis, ExternalLink, Globe2, Home, Laptop, Monitor,
  Network, Plus, Power, Radio, RefreshCw, Router, Search, Server,
  Settings, ShieldCheck, SlidersHorizontal, Smartphone, Terminal,
  Thermometer, Wifi, X
} from 'lucide-react';
import './styles.css';
import { loadAppState, resetAppState, saveAppState } from './lib/appState';
import { piwakeClient, runtime } from './services/piwakeClient';

const host = { id: 'host', name: 'raspberrypi-5', kind: 'host', ip: '100.100.1.1', localIp: '192.168.1.8', status: 'online', icon: Cpu };
const seedDevices = [
  { id: 'main', name: 'Main PC', kind: 'pc', ip: '100.100.1.23', mac: 'D4:5D:64:12:34:56', status: 'offline', last: '3日前', location: 'Home Office', icon: Monitor },
  { id: 'sub', name: 'Sub PC', kind: 'pc', ip: '100.100.1.42', mac: '8C:47:BE:20:11:08', status: 'offline', last: '昨日', location: 'Desk', icon: Desktop },
  { id: 'server', name: 'Home Server', kind: 'server', ip: '100.100.1.10', mac: '60:A4:B7:09:CF:2A', status: 'online', last: 'いま', location: 'Rack', icon: Server },
];

const discovered = [
  { name: 'Office PC', ip: '192.168.1.66', mac: '3C:52:82:9A:11:22', icon: Monitor },
  { name: 'Gaming PC', ip: '192.168.1.88', mac: '70:85:C2:55:AA:33', icon: Desktop },
  { name: 'NAS', ip: '192.168.1.90', mac: '1C:69:7A:10:B8:44', icon: Server },
];

const statusText = { online: 'Online', offline: 'Offline', asleep: 'Asleep' };

function IconButton({ children, label, onClick, className = '' }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} onClick={onClick}>{children}</button>;
}

function Status({ value = 'offline', children }) {
  return <span className={`status status-${value}`}><i />{children || statusText[value]}</span>;
}

function HostBar({ onOpen }) {
  return (
    <button className="host-bar squircle" onClick={onOpen}>
      <span className="host-mark"><Cpu size={20} /></span>
      <span className="host-copy"><strong>{host.name}</strong><Status value="online">Tailscale connected</Status></span>
      <span className="host-meta"><Thermometer size={14} /> 46°</span>
      <ChevronRight size={18} />
    </button>
  );
}

function DeviceGlyph({ device, size = 26 }) {
  const fallbackGlyphs = { host: Cpu, server: Server, pc: Monitor };
  const Glyph = device.icon?.$$typeof || typeof device.icon === 'function' ? device.icon : fallbackGlyphs[device.kind] || Monitor;
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
      <div><dt>Tailscale IP</dt><dd>{device.ip}</dd></div>
      <div><dt>Last seen</dt><dd>{device.last}</dd></div>
      <div><dt>Location</dt><dd>{device.location}</dd></div>
    </dl>
    <button className="primary-action" onClick={online ? () => toast('Desktopを開く導線を確認しました') : onWake}>
      {online ? <Desktop size={20} /> : <Power size={20} />}{online ? 'Open Desktop' : 'Wake and connect'}
    </button>
    <div className="action-pair">
      <button onClick={() => toast('SSHクライアントを開く導線を確認しました')}><Terminal size={18} />Open SSH</button>
      <button onClick={() => toast('Chrome Remote Desktopを開く導線を確認しました')}><ExternalLink size={18} />Chrome RDP</button>
    </div>
    <button className="text-link" onClick={onDetail}>接続方法と設定 <ChevronRight size={15} /></button>
  </section>;
}

function HomeView({ devices, selectedId, setSelectedId, setView, startWake, toast }) {
  const selected = devices.find(d => d.id === selectedId) || devices[0];
  return <>
    <AppHeader title="PiWake" onSettings={() => setView('settings')} />
    <HostBar onOpen={() => setView('host')} />
    <main className="screen-body home-body">
      <p className="greeting" aria-hidden="true">Away from home.<br /><span>Your machines are still within reach.</span></p>
      <DeviceStage device={selected} onWake={() => startWake(selected)} onDetail={() => setView('detail')} toast={toast} />
      <QuickSwitch devices={devices} selectedId={selectedId} onSelect={setSelectedId} onAdd={() => setView('add')} />
    </main>
  </>;
}

function DeviceRow({ device, selected, onClick, actions }) {
  return <button className={`device-row ${selected ? 'selected' : ''}`} onClick={onClick}>
    <DeviceGlyph device={device} />
    <span className="row-copy"><strong>{device.name}</strong><small>{device.ip}</small><Status value={device.status} /></span>
    {actions || <ChevronRight size={18} />}
  </button>;
}

function DevicesView({ devices, selectedId, selectDevice, setView }) {
  return <>
    <AppHeader title="Devices" trailing={<IconButton label="デバイス追加" onClick={() => setView('add')}><Plus size={22} /></IconButton>} />
    <main className="screen-body">
      <HostBar onOpen={() => setView('host')} />
      <div className="section-label">Managed devices · {devices.length}</div>
      <section className="device-list squircle">
        {devices.map(d => <DeviceRow key={d.id} device={d} selected={d.id === selectedId} onClick={() => { selectDevice(d.id); setView('detail'); }} />)}
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

function DetailView({ device, setView, startWake, toast }) {
  if (!device) return null;
  return <>
    <AppHeader title={device.name} eyebrow="Managed device" onBack={() => setView('devices')} trailing={<IconButton label="その他"><Ellipsis size={22} /></IconButton>} />
    <main className="screen-body detail-body">
      <section className="identity-block">
        <DeviceGlyph device={device} size={42} /><div><h1>{device.name}</h1><Status value={device.status} /></div>
      </section>
      {device.status !== 'online' && <button className="primary-action" onClick={() => startWake(device)}><Power size={20} />Wake and connect</button>}
      <div className="section-label">Connection stack</div>
      <section className="connection-list squircle">
        <ConnectionRow icon={Terminal} title="SSH" detail={`ssh pi@${device.ip}`} accent onClick={() => toast('SSHクライアントを開く導線を確認しました')} />
        <ConnectionRow icon={ExternalLink} title="Chrome Remote Desktop" detail="Open installed app or web client" onClick={() => toast('Chrome Remote Desktopを開く導線を確認しました')} />
        <ConnectionRow icon={Desktop} title="RDP" detail="Microsoft Remote Desktop" onClick={() => toast('RDPクライアントを開く導線を確認しました')} />
        <ConnectionRow icon={Globe2} title="Web service" detail="No service configured" onClick={() => setView('connections')} />
      </section>
      <div className="section-label">Device</div>
      <section className="setting-list squircle">
        <button onClick={() => setView('connections')}><Network size={18} /><span>Wake & network settings</span><ChevronRight size={17} /></button>
        <button><Activity size={18} /><span>Monitoring</span><ChevronRight size={17} /></button>
        <button><Clock3 size={18} /><span>Automation</span><ChevronRight size={17} /></button>
      </section>
    </main>
  </>;
}

function WakeConfirm({ device, onCancel, onConfirm }) {
  return <div className="modal-layer" role="presentation" onMouseDown={event => event.target === event.currentTarget && onCancel()}><div className="confirm-sheet squircle" role="dialog" aria-modal="true" aria-labelledby="wake-dialog-title">
    <div className="confirm-icon"><Power size={26} /></div><h2 id="wake-dialog-title">Wake {device.name}?</h2>
    <p>自宅の {host.name} からMagic Packetを送信し、Tailscaleで到達可能になるまで確認します。</p>
    <div className="confirm-device"><DeviceGlyph device={device} /><span><strong>{device.name}</strong><small>{device.mac}</small></span></div>
    <button className="primary-action" onClick={onConfirm}>Wake and connect</button>
    <button className="quiet-action" onClick={onCancel}>Cancel</button>
  </div></div>;
}

function WakeProgress({ device, step, cancel, finish }) {
  const steps = [
    ['Magic packet sent', 'Wake-on-LAN packet delivered.'],
    ['Device responding', 'Host is online on your home network.'],
    ['Tailscale reachable', 'Device reachable over your tailnet.'],
    ['Remote access ready', 'SSH and desktop services are available.'],
  ];
  return <>
    <AppHeader title={`Waking ${device.name}`} onBack={cancel} />
    <main className="screen-body progress-body"><p className="page-lead">This may take a few moments.</p>
      <section className="progress-rail squircle">{steps.map(([title, detail], i) => {
        const state = i < step ? 'done' : i === step ? 'current' : 'pending';
        return <div className={`progress-step ${state}`} key={title}><span className="step-dot">{state === 'done' ? <Check size={16} /> : i + 1}</span><div><strong>{title}</strong><small>{detail}</small></div></div>;
      })}</section>
      <div className="progress-device squircle"><DeviceGlyph device={device} /><span><strong>{device.name}</strong><small>{device.ip}</small></span><Status value={step >= 4 ? 'online' : 'asleep'}>{step >= 4 ? 'Ready' : 'Preparing'}</Status></div>
      {step >= 4 ? <div className="ready-actions"><button className="primary-action" onClick={() => finish('desktop')}><Desktop size={19} />Open Desktop</button><button className="secondary-action" onClick={() => finish('ssh')}><Terminal size={18} />Open SSH</button></div> : <button className="secondary-action danger" onClick={cancel}>Cancel</button>}
    </main>
  </>;
}

function AddDevice({ onBack, addDevice, setView }) {
  const [tab, setTab] = useState('scan');
  const [scanning, setScanning] = useState(true);
  useEffect(() => { const id = setTimeout(() => setScanning(false), 1200); return () => clearTimeout(id); }, []);
  return <>
    <AppHeader title="Add device" onBack={onBack} />
    <main className="screen-body">
      <HostBar onOpen={() => setView('host')} />
      <div className="segmented"><button className={tab === 'scan' ? 'active' : ''} onClick={() => setTab('scan')}><Search size={17} />Find on network</button><button className={tab === 'manual' ? 'active' : ''} onClick={() => setTab('manual')}><SlidersHorizontal size={17} />Manual</button></div>
      {tab === 'scan' ? <>
        <section className="scan-panel squircle"><span className={scanning ? 'radar spinning' : 'radar'}><Radio size={27} /></span><div><strong>{scanning ? 'Scanning your network' : '3 devices found'}</strong><p>{scanning ? 'Looking for devices that support Wake-on-LAN.' : 'Select a device to configure Wake-on-LAN.'}</p></div><IconButton label="再検索" onClick={() => { setScanning(true); setTimeout(() => setScanning(false), 900); }}><RefreshCw size={18} /></IconButton></section>
        <div className="section-label">Discovered devices</div>
        <section className="device-list squircle">{discovered.map((d, i) => <div className="discovery-row" key={d.mac}><DeviceGlyph device={d} /><span><strong>{d.name}</strong><small>{d.ip} · {d.mac}</small></span><button onClick={() => addDevice(d, i)}>Add</button></div>)}</section>
        <button className="help-row squircle"><CircleHelp size={22} /><span><strong>Can’t find your device?</strong><small>同じネットワークとWOL設定を確認</small></span><ChevronRight size={17} /></button>
      </> : <ManualForm addDevice={addDevice} />}
    </main>
  </>;
}

function ManualForm({ addDevice }) {
  const [name, setName] = useState('New PC');
  const [ip, setIp] = useState('192.168.1.');
  const [mac, setMac] = useState('');
  return <form className="manual-form squircle" onSubmit={e => { e.preventDefault(); addDevice({ name: name.trim(), ip: ip.trim(), mac: mac.toUpperCase(), icon: Monitor }, 9); }}>
    <label>Device name<input required maxLength="48" autoComplete="off" value={name} onChange={e => setName(e.target.value)} /></label>
    <label>Local IP<input required inputMode="decimal" autoComplete="off" pattern="^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}$" title="192.168.1.20 の形式で入力" value={ip} onChange={e => setIp(e.target.value)} /></label>
    <label>MAC address<input required autoCapitalize="characters" autoComplete="off" pattern="^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$" title="AA:BB:CC:DD:EE:FF の形式で入力" placeholder="AA:BB:CC:DD:EE:FF" value={mac} onChange={e => setMac(e.target.value)} /></label>
    <button className="primary-action" type="submit">Continue</button>
  </form>;
}

function HostDetail({ setView, toast }) {
  return <>
    <AppHeader title="Raspberry Pi host" onBack={() => setView('home')} />
    <main className="screen-body detail-body">
      <section className="host-hero"><span className="host-mark large"><Cpu size={34} /></span><div><h1>{host.name}</h1><Status value="online">Tailscale connected</Status></div></section>
      <section className="host-metrics squircle"><div><Thermometer /><strong>46°</strong><span>CPU temp</span></div><div><Activity /><strong>2%</strong><span>CPU</span></div><div><Wifi /><strong>-49</strong><span>dBm</span></div></section>
      <div className="section-label">Connect to this Pi</div>
      <section className="connection-list squircle">
        <ConnectionRow icon={Terminal} title="SSH" detail="ssh pi@raspberrypi-5" accent onClick={() => toast('PiへのSSH導線を確認しました')} />
        <ConnectionRow icon={Desktop} title="Desktop" detail="Chrome Remote Desktop" onClick={() => toast('Piのデスクトップ導線を確認しました')} />
        <ConnectionRow icon={Globe2} title="PiWake Web" detail="Open host web console" onClick={() => toast('このWebコンソールです')} />
      </section>
      <div className="section-label">Host services</div>
      <section className="service-panel squircle"><div><ShieldCheck /><span><strong>PiWake API</strong><Status value="online" /></span></div><div><Network /><span><strong>LAN relay</strong><Status value="online" /></span></div><div><Router /><span><strong>Tailscale</strong><Status value="online" /></span></div></section>
      <button className="secondary-action danger" onClick={() => toast('ホスト停止は確認ダイアログが必要です')}>Shut down Raspberry Pi</button>
      <p className="danger-note">停止すると、すべてのWake-on-LANとリモート接続が使えなくなります。</p>
    </main>
  </>;
}

function ActivityView() {
  const logs = [
    ['Main PC', 'Wake succeeded', 'Today, 09:41', Power, 'success'],
    ['raspberrypi-5', 'SSH opened', 'Yesterday, 22:08', Terminal, 'neutral'],
    ['Sub PC', 'Wake timed out', 'Jul 8, 18:32', Clock3, 'warning'],
    ['Home Server', 'Desktop opened', 'Jul 7, 11:04', Desktop, 'neutral'],
  ];
  return <><AppHeader title="Activity" /><main className="screen-body"><p className="page-lead">Recent activity across your tailnet.</p><section className="timeline">{logs.map(([name, action, time, Glyph, state]) => <div className="timeline-row" key={time}><span className={`timeline-icon ${state}`}><Glyph size={18} /></span><span><strong>{action}</strong><small>{name} · {time}</small></span></div>)}</section></main></>;
}

function SettingsView({ setView, toast, resetDemo }) {
  const [checking, setChecking] = useState(false);
  const checkConnection = async () => {
    setChecking(true);
    try { await piwakeClient.checkHealth(); toast(`${runtime.label} is ready`); }
    catch { toast('APIへ接続できませんでした'); }
    finally { setChecking(false); }
  };
  return <><AppHeader title="Settings" onBack={() => setView('home')} /><main className="screen-body">
    <section className="settings-intro"><ShieldCheck size={30} /><h1>Tailscale-first</h1><p>PiWakeは公開ポートを使わず、あなたのtailnet内だけで通信します。</p></section>
    <div className="section-label">Runtime</div><section className="runtime-panel squircle"><div><span className={`runtime-dot ${runtime.mode}`} /><span><strong>{runtime.label}</strong><small>{runtime.apiBaseUrl || 'Local state · no network calls'}</small></span></div><button type="button" onClick={checkConnection} disabled={checking}>{checking ? 'Checking…' : 'Check'}</button></section>
    <div className="section-label">App</div><section className="setting-list squircle"><button><Smartphone size={18} /><span>External app links</span><ChevronRight size={17} /></button><button><Activity size={18} /><span>Notifications</span><ChevronRight size={17} /></button><button><SlidersHorizontal size={18} /><span>Appearance</span><ChevronRight size={17} /></button></section>
    <div className="section-label">Security</div><section className="setting-list squircle"><button><ShieldCheck size={18} /><span>Tailnet access</span><Status value="online">Connected</Status></button><button><Network size={18} /><span>Connection diagnostics</span><ChevronRight size={17} /></button></section>
    {runtime.mode === 'demo' && <button className="quiet-action reset-demo" type="button" onClick={resetDemo}>Reset demo data</button>}
  </main></>;
}

function ConnectionSetup({ setView }) {
  const [selected, setSelected] = useState(['ssh', 'chrome']);
  const methods = [['ssh', Terminal, 'SSH', 'Terminal client'], ['chrome', ExternalLink, 'Chrome Remote Desktop', 'Browser or installed app'], ['rdp', Desktop, 'RDP', 'Microsoft Remote Desktop'], ['web', Globe2, 'Web URL', 'Custom service']];
  return <><AppHeader title="Connection setup" onBack={() => setView('detail')} /><main className="screen-body"><p className="page-lead">Choose what becomes available after the device wakes.</p><section className="method-list">{methods.map(([id, Glyph, name, detail]) => <button className={`method squircle ${selected.includes(id) ? 'selected' : ''}`} key={id} onClick={() => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])}><Glyph size={22} /><span><strong>{name}</strong><small>{detail}</small></span><span className="check-box">{selected.includes(id) && <Check size={14} />}</span></button>)}</section><button className="primary-action" onClick={() => setView('detail')}>Save connection stack</button></main></>;
}

function App() {
  const initialState = useMemo(() => loadAppState(seedDevices), []);
  const [view, setView] = useState('home');
  const [devices, setDevices] = useState(initialState.devices);
  const [selectedId, setSelectedId] = useState(initialState.selectedId);
  const [wakeDevice, setWakeDevice] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [step, setStep] = useState(0);
  const [toastMessage, setToastMessage] = useState('');
  const toastTimer = useRef();
  const selected = devices.find(d => d.id === selectedId) || devices[0];
  const toast = message => { clearTimeout(toastTimer.current); setToastMessage(message); toastTimer.current = setTimeout(() => setToastMessage(''), 2600); };
  const startWake = device => { setWakeDevice(device); setConfirming(true); };
  const confirmWake = async () => {
    setConfirming(false); setStep(0); setView('waking');
    try { await piwakeClient.wakeDevice(wakeDevice); }
    catch { setView('home'); toast('Wakeリクエストを送信できませんでした'); }
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => { saveAppState({ devices, selectedId }); }, [devices, selectedId]);
  useEffect(() => {
    if (view !== 'waking' || step >= 4) return;
    const id = setTimeout(() => setStep(s => s + 1), 850);
    return () => clearTimeout(id);
  }, [view, step]);
  const finishWake = target => {
    setDevices(ds => ds.map(d => d.id === wakeDevice.id ? { ...d, status: 'online', last: 'いま' } : d));
    setView('home'); toast(target === 'ssh' ? 'SSHを開く準備ができました' : 'Desktopを開く準備ができました');
  };
  const addDevice = async (d, i) => {
    const id = `added-${Date.now()}`;
    const nextDevice = { ...d, id, kind: i === 2 ? 'server' : 'pc', status: 'offline', last: '未接続', location: 'Home' };
    try { await piwakeClient.addDevice(nextDevice); }
    catch { toast('デバイスを追加できませんでした'); return; }
    setDevices(ds => [...ds, nextDevice]);
    setSelectedId(id); setView('connections'); toast(`${d.name}を追加しました`);
  };
  const resetDemo = () => { resetAppState(); setDevices(seedDevices); setSelectedId('main'); setView('home'); toast('デモデータをリセットしました'); };
  const content = (() => {
    if (view === 'home') return <HomeView devices={devices} selectedId={selectedId} setSelectedId={setSelectedId} setView={setView} startWake={startWake} toast={toast} />;
    if (view === 'devices') return <DevicesView devices={devices} selectedId={selectedId} selectDevice={setSelectedId} setView={setView} />;
    if (view === 'detail') return <DetailView device={selected} setView={setView} startWake={startWake} toast={toast} />;
    if (view === 'waking') return <WakeProgress device={wakeDevice || selected} step={step} cancel={() => setView('home')} finish={finishWake} />;
    if (view === 'add') return <AddDevice onBack={() => setView('devices')} addDevice={addDevice} setView={setView} />;
    if (view === 'host') return <HostDetail setView={setView} toast={toast} />;
    if (view === 'activity') return <ActivityView />;
    if (view === 'settings') return <SettingsView setView={setView} toast={toast} resetDemo={resetDemo} />;
    if (view === 'connections') return <ConnectionSetup setView={setView} />;
  })();
  const showNav = ['home', 'devices', 'activity'].includes(view);
  return <div className="site-shell"><div className="ambient" /><aside className="desktop-rail"><div className="brand"><Power size={20} /><span>PiWake</span></div><p>Home access,<br />quietly handled.</p><nav><button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}><Home />Home</button><button className={view === 'devices' ? 'active' : ''} onClick={() => setView('devices')}><Server />Devices</button><button className={view === 'activity' ? 'active' : ''} onClick={() => setView('activity')}><Activity />Activity</button></nav><div className="rail-footer"><div className="rail-runtime"><Status value="online">Tailnet connected</Status><small>{runtime.label}</small></div><button onClick={() => setView('settings')}><Settings size={17} />Settings</button></div></aside><div className="app-frame">{content}{showNav && <Nav view={view} setView={setView} />}{confirming && wakeDevice && <WakeConfirm device={wakeDevice} onCancel={() => setConfirming(false)} onConfirm={confirmWake} />}{toastMessage && <div className="toast" role="status" aria-live="polite"><Check size={16} />{toastMessage}</div>}</div></div>;
}

createRoot(document.getElementById('root')).render(<App />);
