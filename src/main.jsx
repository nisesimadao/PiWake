import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, ArrowLeft, CalendarClock, Check, ChevronRight, CircleHelp, Clock3, Cpu,
  MonitorUp as Desktop, ExternalLink, Gauge, Globe2, Home, KeyRound, Monitor,
  Network, Pin, Plus, Power, Radio, RefreshCw, RotateCcw, Router, Search, Server,
  Settings, ShieldCheck, SlidersHorizontal, Terminal,
  Thermometer, Trash2, Wifi, X
} from 'lucide-react';
import './styles.css';
import { loadAppState, resetAppState, saveAppState } from './lib/appState';
import { FONT_OPTIONS, getFontId, initFont, loadFontPreviews, setFont } from './lib/fonts';
import { OsIcon, OS_OPTIONS } from './components/osIcons';
import { eventsUrl, getApiToken, piwakeClient, runtime, setApiToken } from './services/piwakeClient';

const isApi = runtime.mode === 'api';

const demoHost = { name: 'raspberrypi-5', tempC: 46, load1: 0.2, uptimeSeconds: 195000, tailscaleIp: '100.100.1.1', tailscaleOnline: true };
const seedDevices = [
  { id: 'main', name: 'Main PC', kind: 'pc', os: 'windows', osSource: 'inferred', ip: '100.100.1.23', mac: 'D4:5D:64:12:34:56', status: 'offline', last: '3日前', location: 'Home Office' },
  { id: 'sub', name: 'Sub Mac', kind: 'pc', os: 'macos', osSource: 'inferred', ip: '100.100.1.42', mac: '8C:47:BE:20:11:08', status: 'offline', last: '昨日', location: 'Desk' },
  { id: 'server', name: 'Home Server', kind: 'server', os: 'linux', osSource: 'inferred', ip: '100.100.1.10', mac: '60:A4:B7:09:CF:2A', status: 'online', last: 'いま', location: 'Rack' },
];

const demoDiscovered = [
  { name: 'Office PC', ip: '192.168.1.66', mac: '3C:52:82:9A:11:22' },
  { name: 'Gaming PC', ip: '192.168.1.88', mac: '70:85:C2:55:AA:33', kind: 'pc' },
  { name: 'NAS', ip: '192.168.1.90', mac: '1C:69:7A:10:B8:44', kind: 'server' },
];

const statusText = { online: 'オンライン', offline: 'オフライン', asleep: 'スリープ中' };

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

function inferDeviceOs(device) {
  const name = String(device?.name || '').toLowerCase();
  if (/raspberry|raspi|rpi/.test(name)) return { os: 'raspberrypi', reason: 'ホスト名にRaspberry Piの特徴があります' };
  if (/macbook|imac|mac mini|mac$/.test(name)) return { os: 'macos', reason: 'ホスト名にMacの特徴があります' };
  if (/windows|win\d*|surface/.test(name) || device?.rdpPort) return { os: 'windows', reason: device?.rdpPort ? 'RDP設定が見つかりました' : 'ホスト名にWindowsの特徴があります' };
  if (/linux|ubuntu|debian|fedora|arch|nas/.test(name) || device?.kind === 'server') return { os: 'linux', reason: device?.kind === 'server' ? 'サーバーとして登録されています' : 'ホスト名にLinuxの特徴があります' };
  return { os: 'windows', reason: 'PCとして登録されているためWindowsと推定しました' };
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function sshCommand(device) {
  const address = reachableAddress(device);
  if (!address) return null;
  return `ssh ${device.sshPort ? `-p ${device.sshPort} ` : ''}${device.user || 'pi'}@${address}`;
}

async function openSsh(device, toast) {
  const command = sshCommand(device);
  if (!command) return toast('接続先IPが設定されていません');
  const copied = await copyText(command);
  window.location.href = `ssh://${device.user || 'pi'}@${reachableAddress(device)}${device.sshPort ? `:${device.sshPort}` : ''}`;
  toast(copied ? `「${command}」をコピーしました。開かない場合はターミナルに貼り付け` : command);
}

function openChromeRemoteDesktop(toast) {
  window.open('https://remotedesktop.google.com/access', '_blank', 'noopener');
  toast('Chrome Remote Desktopを開きました（PC側の事前設定が必要です）');
}

async function openRdp(device, toast) {
  const address = reachableAddress(device);
  if (!address) return toast('接続先IPが設定されていません');
  const target = device.rdpPort ? `${address}:${device.rdpPort}` : address;
  const copied = await copyText(target);
  window.location.href = `rdp://full%20address=s:${target}`;
  toast(copied ? `${target} をコピーしました。開かない場合はRDPアプリに貼り付け` : `RDP先: ${target}`);
}

function notifyReady(name) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('PiWake', { body: `${name} が起動しました`, icon: '/icon-192.png' });
    }
    navigator.vibrate?.(200);
  } catch { /* notifications are best-effort */ }
}

function IconButton({ children, label, onClick, className = '' }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} onClick={onClick}>{children}</button>;
}

function Status({ value = 'offline', children }) {
  return <span className={`status status-${value}`}><i />{children || statusText[value]}</span>;
}

function hostTailscaleState(hostInfo) {
  if (hostInfo.tailscaleOnline === true) return { value: 'online', label: 'Tailscale 接続中' };
  if (hostInfo.tailscaleOnline === false) return { value: 'offline', label: 'Tailscale 未接続' };
  return { value: 'asleep', label: '接続確認中…' };
}

function HostBar({ hostInfo, onOpen }) {
  const tailscale = hostTailscaleState(hostInfo);
  return (
    <button className="host-bar squircle" onClick={onOpen}>
      <span className="host-mark"><OsIcon os="raspberrypi" size={20} /></span>
      <span className="host-copy"><strong>{hostInfo.name}</strong><Status value={tailscale.value}>{tailscale.label}</Status></span>
      {hostInfo.tempC != null && <span className="host-meta"><Thermometer size={14} /> {hostInfo.tempC}°</span>}
      <ChevronRight size={18} />
    </button>
  );
}

function DeviceGlyph({ device, size = 26 }) {
  const os = device.os || (device.kind === 'host' ? 'raspberrypi' : inferDeviceOs(device).os);
  if (os) return <span className={`device-glyph ${device.kind === 'host' ? 'host-glyph' : ''}`}><OsIcon os={os} size={size * 0.92} /></span>;
  const Glyph = device.kind === 'server' ? Server : Monitor;
  return <span className="device-glyph"><Glyph size={size} strokeWidth={1.7} /></span>;
}

function Nav({ view, setView }) {
  const items = [
    ['home', Home, 'ホーム'],
    ['devices', Server, 'デバイス'],
    ['activity', Activity, '履歴'],
  ];
  const activeIndex = Math.max(0, items.findIndex(([id]) => id === view));
  return <nav className="bottom-nav" aria-label="Primary navigation" data-active={activeIndex}>{items.map(([id, Glyph, label]) => (
    <button key={id} className={view === id ? 'active' : ''} aria-label={label} aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}><Glyph size={20} /></button>
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
    <div className="section-label">デバイスを切り替え</div>
    <div className="quick-switch">
      {devices.map(d => <button key={d.id} className={`quick-device squircle ${selectedId === d.id ? 'selected' : ''}`} onClick={() => onSelect(d.id)}>
        {d.pinned && <Pin size={11} className="pin-mark" />}
        <DeviceGlyph device={d} size={25} /><span>{d.name}</span><Status value={d.status} />
      </button>)}
      <button className="quick-device add squircle" onClick={onAdd}><Plus size={24} /><span>追加</span></button>
    </div>
  </section>;
}

function DeviceStage({ device, onWake, onDetail, toast }) {
  const online = device.status === 'online';
  return <section className={`device-stage squircle ${online ? 'is-online' : ''}`}>
    <div className="stage-heading">
      <div><span className="overline">選択中のデバイス</span><h1>{device.name}</h1><Status value={device.status} /></div>
      <DeviceGlyph device={device} size={42} />
    </div>
    <dl className="facts">
      <div><dt>Tailscale IP</dt><dd>{device.ip || '未設定'}</dd></div>
      <div><dt>最終確認</dt><dd>{deviceLast(device)}</dd></div>
      <div><dt>設置場所</dt><dd>{device.location || '自宅'}</dd></div>
    </dl>
    <p className={`action-context ${online ? 'ready' : ''}`}>
      {online ? '接続できます' : '現在は応答していません。起動パケットを送信できます。'}
    </p>
    <button className="primary-action" onClick={online ? () => openChromeRemoteDesktop(toast) : onWake}>
      {online ? <Desktop size={20} /> : <Power size={20} />}{online ? 'デスクトップを開く' : 'このPCを起動'}
    </button>
    <div className="action-pair">
      <button onClick={() => openSsh(device, toast)}><Terminal size={18} />SSH接続</button>
      <button onClick={() => openChromeRemoteDesktop(toast)}><ExternalLink size={18} />Chrome Remote</button>
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
      <div className="home-intro"><span>REMOTE ACCESS</span><p>外出先から、自宅のPCへ。</p><small>起動して、状態を確かめて、安全に接続。</small></div>
      {selected
        ? <DeviceStage device={selected} onWake={() => startWake(selected)} onDetail={() => setView('detail')} toast={toast} />
        : <section className="device-stage squircle empty-stage"><h1>デバイスがありません</h1><p className="page-lead">最初の管理対象デバイスを追加してください。</p><button className="primary-action" onClick={() => setView('add')}><Plus size={20} />デバイスを追加</button></section>}
      <QuickSwitch devices={devices} selectedId={selectedId} onSelect={setSelectedId} onAdd={() => setView('add')} />
    </main>
  </>;
}

function DeviceRow({ device, selected, onClick, actions }) {
  return <button className={`device-row ${selected ? 'selected' : ''}`} onClick={onClick}>
    <DeviceGlyph device={device} />
    <span className="row-copy"><strong>{device.name}{device.pinned && <Pin size={11} className="row-pin" />}</strong><small>{device.ip || device.localIp || 'IP未設定'}</small><Status value={device.status} /></span>
    {actions || <ChevronRight size={18} />}
  </button>;
}

function DevicesView({ devices, selectedId, selectDevice, setView, hostInfo }) {
  return <>
    <AppHeader title="デバイス" trailing={<IconButton label="デバイス追加" onClick={() => setView('add')}><Plus size={22} /></IconButton>} />
    <main className="screen-body">
      <HostBar hostInfo={hostInfo} onOpen={() => setView('host')} />
      <div className="section-label">登録済み · {devices.length}台</div>
      <section className="device-list squircle">
        {devices.map(d => <DeviceRow key={d.id} device={d} selected={d.id === selectedId} onClick={() => { selectDevice(d.id); setView('detail'); }} />)}
        {!devices.length && <div className="empty-row">まだデバイスがありません</div>}
      </section>
      <button className="secondary-action" onClick={() => setView('add')}><Plus size={18} /> デバイスを追加</button>
    </main>
  </>;
}

function ConnectionRow({ icon: Glyph, title, detail, accent, right, onClick }) {
  return <button className="connection-row" onClick={onClick}>
    <span className={accent ? 'connection-icon accent' : 'connection-icon'}><Glyph size={19} /></span>
    <span><strong>{title}</strong><small>{detail}</small></span>{right}<ChevronRight size={17} />
  </button>;
}

function ServiceDot({ state }) {
  if (state == null) return null;
  return <Status value={state ? 'online' : 'offline'}>{state ? 'Up' : 'Down'}</Status>;
}

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function ScheduleSection({ device, toast }) {
  const [schedules, setSchedules] = useState(null);
  const [time, setTime] = useState('07:00');
  const [days, setDays] = useState([1, 2, 3, 4, 5]);
  const load = useCallback(async () => {
    try {
      const all = await piwakeClient.listSchedules();
      setSchedules((all || []).filter(item => item.deviceId === device.id));
    } catch { setSchedules([]); }
  }, [device.id]);
  useEffect(() => { load(); }, [load]);
  const add = async event => {
    event.preventDefault();
    if (!days.length) return toast('曜日を選択してください');
    try {
      await piwakeClient.addSchedule({ deviceId: device.id, time, days });
      toast('スケジュールを追加しました');
      load();
    } catch { toast('スケジュールを追加できませんでした'); }
  };
  const toggle = async schedule => {
    try { await piwakeClient.updateSchedule(schedule.id, { enabled: !schedule.enabled }); load(); }
    catch { toast('更新できませんでした'); }
  };
  const remove = async schedule => {
    try { await piwakeClient.removeSchedule(schedule.id); load(); }
    catch { toast('削除できませんでした'); }
  };
  return <>
    <div className="section-label">Scheduled wake</div>
    <section className="schedule-list squircle">
      {(schedules || []).map(schedule => (
        <div className="schedule-row" key={schedule.id}>
          <CalendarClock size={18} />
          <span><strong>{schedule.time}</strong><small>{schedule.days.map(day => DAY_LABELS[day]).join('・')}曜日</small></span>
          <button type="button" className={`schedule-toggle ${schedule.enabled ? 'on' : ''}`} onClick={() => toggle(schedule)}>{schedule.enabled ? 'ON' : 'OFF'}</button>
          <IconButton label="スケジュールを削除" onClick={() => remove(schedule)}><X size={16} /></IconButton>
        </div>
      ))}
      {schedules && !schedules.length && <div className="empty-row">スケジュールはまだありません</div>}
      <form className="schedule-form" onSubmit={add}>
        <input type="time" required value={time} onChange={e => setTime(e.target.value)} aria-label="起動時刻" />
        <div className="day-chips">
          {DAY_LABELS.map((label, index) => (
            <button type="button" key={label} className={days.includes(index) ? 'active' : ''}
              onClick={() => setDays(current => current.includes(index) ? current.filter(d => d !== index) : [...current, index].sort())}>{label}</button>
          ))}
        </div>
        <button className="secondary-action schedule-add" type="submit"><Plus size={15} />追加</button>
      </form>
    </section>
    <p className="danger-note schedule-note">指定した時刻（Piのローカル時刻）に自動でWakeします。</p>
  </>;
}

function DetailView({ device, setView, startWake, removeDevice, shutdownDevice, togglePin, patchDevice, toast }) {
  const [services, setServices] = useState(null);
  const deviceId = device?.id;
  const deviceStatus = device?.status;
  useEffect(() => {
    if (!isApi || !deviceId) return;
    let cancelled = false;
    setServices(null);
    piwakeClient.getServices(deviceId)
      .then(result => { if (!cancelled) setServices(result); })
      .catch(() => { /* probe is best-effort */ });
    return () => { cancelled = true; };
  }, [deviceId, deviceStatus]);
  if (!device) return null;
  const address = reachableAddress(device);
  const online = device.status === 'online';
  const inferredOs = inferDeviceOs(device);
  const effectiveOs = device.os || inferredOs.os;
  const osIsManual = device.osSource === 'manual';
  return <>
    <AppHeader title={device.name} eyebrow="Managed device" onBack={() => setView('devices')} trailing={<>
      <IconButton label={device.pinned ? 'ピン留めを解除' : 'ピン留め'} className={device.pinned ? 'pinned' : ''} onClick={() => togglePin(device)}><Pin size={19} /></IconButton>
      <IconButton label="デバイスを削除" onClick={() => removeDevice(device)}><Trash2 size={19} /></IconButton>
    </>} />
    <main className="screen-body detail-body">
      <section className="identity-block">
        <DeviceGlyph device={device} size={42} /><div><h1>{device.name}</h1><Status value={device.status} /></div>
      </section>
      <button className={online ? 'secondary-action detail-wake-action' : 'primary-action'} onClick={() => startWake(device)}><Power size={20} />{online ? '起動信号をもう一度送る' : 'Wake and connect'}</button>
      <div className="section-label">Connection stack</div>
      <section className="connection-list squircle">
        <ConnectionRow icon={Terminal} title="SSH" detail={sshCommand(device) || 'IP未設定'} accent right={<ServiceDot state={services?.ssh?.up} />} onClick={() => openSsh(device, toast)} />
        <ConnectionRow icon={ExternalLink} title="Chrome Remote Desktop" detail="要・PC側の事前設定" onClick={() => openChromeRemoteDesktop(toast)} />
        <ConnectionRow icon={Desktop} title="RDP" detail={address ? `${address}:${device.rdpPort || 3389}` : 'Microsoft Remote Desktop'} right={<ServiceDot state={services?.rdp?.up} />} onClick={() => openRdp(device, toast)} />
        {device.webUrl && <ConnectionRow icon={Globe2} title="Web service" detail={device.webUrl} right={<ServiceDot state={services?.web?.up} />} onClick={() => window.open(device.webUrl, '_blank', 'noopener')} />}
      </section>
      <div className="section-label">OS</div>
      <div className="os-detection-note">
        <span><strong>{osIsManual ? '手動設定' : '自動推定'}</strong><small>{osIsManual ? '必要なら変更できます' : inferredOs.reason}</small></span>
        {osIsManual && <button type="button" onClick={() => patchDevice(device, { os: null, osSource: 'inferred' })}>自動判定に戻す</button>}
      </div>
      <div className="os-chips">
        {OS_OPTIONS.map(option => (
          <button key={option.id} type="button" className={`os-chip squircle ${effectiveOs === option.id ? 'active' : ''}`}
            onClick={() => patchDevice(device, { os: option.id, osSource: 'manual' })}>
            <OsIcon os={option.id} size={17} /><span>{option.label}</span>
          </button>
        ))}
      </div>
      <div className="section-label">Device</div>
      <section className="facts detail-facts squircle">
        <div><dt>MAC</dt><dd>{device.mac}</dd></div>
        <div><dt>Local IP</dt><dd>{device.localIp || '未設定'}</dd></div>
        <div><dt>Tailscale IP</dt><dd>{device.ip || '未設定'}</dd></div>
        <div><dt>Last seen</dt><dd>{deviceLast(device)}</dd></div>
      </section>
      <section className="setting-list squircle">
        <button onClick={() => setView('connections')}><Network size={18} /><span>接続設定（SSHユーザー・ポート・Web URL）</span><ChevronRight size={17} /></button>
      </section>
      {isApi && <ScheduleSection device={device} toast={toast} />}
      {online && <button className="secondary-action danger" onClick={() => shutdownDevice(device)}><Power size={18} />Shut down {device.name}</button>}
      {online && <p className="danger-note">SSH経由でシャットダウンします（PiからのSSH鍵設定が必要）。</p>}
    </main>
  </>;
}

function WakeConfirm({ device, hostName, onCancel, onConfirm }) {
  return <div className="modal-layer" role="presentation" onMouseDown={event => event.target === event.currentTarget && onCancel()}><div className="confirm-sheet squircle" role="dialog" aria-modal="true" aria-labelledby="wake-dialog-title">
    <div className="confirm-icon"><Power size={26} /></div><h2 id="wake-dialog-title">{device.name} を起動しますか？</h2>
    <p>自宅の {hostName} からMagic Packet（起動信号）を送信し、接続できるようになるまで確認します。</p>
    <div className="confirm-device"><DeviceGlyph device={device} /><span><strong>{device.name}</strong><small>{device.mac}</small></span></div>
    <button className="primary-action" onClick={onConfirm}>Wake and connect</button>
    <button className="quiet-action" onClick={onCancel}>キャンセル</button>
  </div></div>;
}

function ShutdownConfirm({ target, onCancel, onConfirm }) {
  const isHost = target.kind === 'host';
  const device = target.device;
  const name = isHost ? target.name : device.name;
  return <div className="modal-layer" role="presentation" onMouseDown={event => event.target === event.currentTarget && onCancel()}><div className="confirm-sheet squircle" role="dialog" aria-modal="true" aria-labelledby="shutdown-dialog-title">
    <div className="confirm-icon shutdown"><Power size={26} /></div><h2 id="shutdown-dialog-title">{name} を停止しますか？</h2>
    <p>{isHost ? '停止すると、すべてのWake-on-LANとリモート接続が使えなくなります。再開にはRaspberry Pi本体の電源操作が必要です。' : 'Raspberry PiからSSH経由で安全なシャットダウンを要求します。保存していない作業がないことを確認してください。'}</p>
    <div className="confirm-device">{isHost ? <span className="host-mark"><OsIcon os="raspberrypi" size={20} /></span> : <DeviceGlyph device={device} />}<span><strong>{name}</strong><small>{isHost ? 'Wake relay host' : (device.ip || device.localIp || 'IP未設定')}</small></span></div>
    <button className="primary-action shutdown-action" onClick={onConfirm}>{isHost ? 'Raspberry Piを停止' : 'シャットダウンする'}</button>
    <button className="quiet-action" onClick={onCancel}>キャンセル</button>
  </div></div>;
}

function WakeProgress({ device, step, failed, cancel, finish }) {
  const steps = [
    ['起動信号を送信', 'PiからMagic Packet（起動信号）を送信しました。'],
    ['デバイスが応答', '自宅ネットワーク内で起動を確認しています。'],
    ['外部から到達可能', 'Tailscale経由で接続できるか確認しています。'],
    ['リモート接続の準備完了', 'SSHとデスクトップ接続が利用できます。'],
  ];
  return <>
    <AppHeader title={`Waking ${device.name}`} onBack={cancel} />
    <main className="screen-body progress-body"><p className="page-lead">{failed ? 'PCが起動しませんでした。電源ケーブルと、PC側のWake-on-LAN（遠隔起動）設定を確認してください。' : '起動には1〜2分かかることがあります。'}</p>
      <section className="progress-rail squircle">{steps.map(([title, detail], i) => {
        const state = i < step ? 'done' : i === step ? 'current' : 'pending';
        return <div className={`progress-step ${state}`} key={title}><span className="step-dot">{state === 'done' ? <Check size={16} /> : i + 1}</span><div><strong>{title}</strong><small>{detail}</small></div></div>;
      })}</section>
      <div className="progress-device squircle"><DeviceGlyph device={device} /><span><strong>{device.name}</strong><small>{device.ip || device.localIp}</small></span><Status value={step >= 4 ? 'online' : 'asleep'}>{step >= 4 ? 'Ready' : failed ? 'Failed' : 'Preparing'}</Status></div>
      {step >= 4 ? <div className="ready-actions"><button className="primary-action" onClick={() => finish('desktop')}><Desktop size={19} />Open Desktop</button><button className="secondary-action" onClick={() => finish('ssh')}><Terminal size={18} />Open SSH</button></div> : <button className="secondary-action danger" onClick={cancel}>{failed ? '戻る' : 'キャンセル'}</button>}
    </main>
  </>;
}

function WolHelpSheet({ onClose }) {
  const items = [
    ['スキャンは起動中のデバイスだけを検出します', '一度PCの電源を手で入れた状態で再スキャンしてください。'],
    ['PiとPCが同じルーターにつながっているか', '有線LAN接続を推奨します。Wi-FiはWake-on-LAN非対応の機種が多いです。'],
    ['PC側でWake-on-LAN（遠隔起動）を有効化', 'BIOS/UEFIで「Wake on LAN」をオン。Windowsはデバイスマネージャー → ネットワークアダプター → 電源の管理で「Magic Packetでのみ解除」を許可し、コントロールパネルで高速スタートアップをオフにします。'],
    ['それでも見つからない場合は手動追加', 'MACアドレスは、Windowsなら 設定 → ネットワーク → ハードウェアのプロパティ の「物理アドレス (MAC)」に載っています。'],
  ];
  return <div className="modal-layer" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div className="confirm-sheet squircle help-sheet" role="dialog" aria-modal="true" aria-labelledby="wol-help-title">
      <div className="confirm-icon"><CircleHelp size={26} /></div>
      <h2 id="wol-help-title">デバイスが見つからないときは</h2>
      <ol className="help-steps">
        {items.map(([title, detail]) => <li key={title}><strong>{title}</strong><small>{detail}</small></li>)}
      </ol>
      <button className="primary-action" onClick={onClose}>閉じる</button>
    </div>
  </div>;
}

function AddDevice({ onBack, addDevice, setView, hostInfo, toast }) {
  const [tab, setTab] = useState('scan');
  const [scanning, setScanning] = useState(true);
  const [found, setFound] = useState(isApi ? [] : demoDiscovered);
  const [showHelp, setShowHelp] = useState(false);
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
        <section className="scan-panel squircle"><span className={scanning ? 'radar spinning' : 'radar'}><Radio size={27} /></span><div><strong>{scanning ? 'ネットワークをスキャン中' : `${found.length} 台見つかりました`}</strong><p>{scanning ? '起動中のデバイスを探しています。' : '起動したいPCを選んで追加してください。名前はあとで変更できます。'}</p></div><IconButton label="再検索" onClick={runScan}><RefreshCw size={18} /></IconButton></section>
        <div className="section-label">Discovered devices</div>
        <section className="device-list squircle">
          {found.map(d => <div className="discovery-row" key={d.mac}><DeviceGlyph device={d} /><span><strong>{d.name}</strong><small>{d.ip} · {d.mac}</small></span><button onClick={() => addDevice({ name: d.name, localIp: d.ip, mac: d.mac, kind: d.kind || 'pc' })}>Add</button></div>)}
          {!found.length && !scanning && <div className="empty-row">デバイスが見つかりませんでした</div>}
        </section>
        <button className="help-row squircle" onClick={() => setShowHelp(true)}><CircleHelp size={22} /><span><strong>デバイスが見つからない？</strong><small>電源・ネットワーク・WOL設定のチェックリスト</small></span><ChevronRight size={17} /></button>
      </> : <ManualForm addDevice={addDevice} />}
      {showHelp && <WolHelpSheet onClose={() => setShowHelp(false)} />}
    </main>
  </>;
}

function ManualForm({ addDevice }) {
  const [name, setName] = useState('New PC');
  const [localIp, setLocalIp] = useState('192.168.1.');
  const [tailscaleIp, setTailscaleIp] = useState('');
  const [mac, setMac] = useState('');
  const [user, setUser] = useState('');
  const [os, setOs] = useState(null);
  return <form className="manual-form squircle" onSubmit={e => {
    e.preventDefault();
    addDevice({ name: name.trim(), localIp: localIp.trim(), ip: tailscaleIp.trim() || null, mac: mac.toUpperCase(), user: user.trim() || null, os, kind: os === 'linux' ? 'server' : 'pc' });
  }}>
    <label>OS（アイコンに使われます・任意）</label>
    <div className="os-chips in-form">
      {OS_OPTIONS.map(option => (
        <button key={option.id} type="button" className={`os-chip squircle ${os === option.id ? 'active' : ''}`}
          onClick={() => setOs(current => current === option.id ? null : option.id)}>
          <OsIcon os={option.id} size={16} /><span>{option.label}</span>
        </button>
      ))}
    </div>
    <label>デバイス名<input required maxLength="48" autoComplete="off" value={name} onChange={e => setName(e.target.value)} /></label>
    <label>ローカルIP
      <input required inputMode="decimal" autoComplete="off" pattern="^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$" title="192.168.1.20 の形式で入力" value={localIp} onChange={e => setLocalIp(e.target.value)} />
      <small className="field-hint">PCの「ネットワークのプロパティ」に載っている 192.168.x.x のアドレス</small>
    </label>
    <label>MACアドレス
      <input required autoCapitalize="characters" autoComplete="off" pattern="^([0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}$" title="AA:BB:CC:DD:EE:FF の形式で入力" placeholder="AA:BB:CC:DD:EE:FF" value={mac} onChange={e => setMac(e.target.value)} />
      <small className="field-hint">Windows: 設定 → ネットワーク → ハードウェアのプロパティ「物理アドレス (MAC)」/ Mac: システム設定 → ネットワーク → 詳細</small>
    </label>
    <label>Tailscale IP（任意）<input inputMode="decimal" autoComplete="off" placeholder="100.x.y.z" value={tailscaleIp} onChange={e => setTailscaleIp(e.target.value)} /></label>
    <label>SSHユーザー名（任意・既定は pi）<input autoComplete="off" placeholder="pi" value={user} onChange={e => setUser(e.target.value)} /></label>
    <button className="primary-action" type="submit">追加する</button>
  </form>;
}

function HostDetail({ setView, toast, hostInfo, apiOk, shutdownHost }) {
  const tailscale = hostTailscaleState(hostInfo);
  return <>
    <AppHeader title="Raspberry Pi host" onBack={() => setView('home')} />
    <main className="screen-body detail-body">
      <section className="host-hero"><span className="host-mark large"><OsIcon os="raspberrypi" size={32} /></span><div><h1>{hostInfo.name}</h1><Status value={tailscale.value}>{tailscale.label}</Status></div></section>
      <section className="host-metrics squircle">
        <div><Thermometer /><strong>{hostInfo.tempC != null ? `${hostInfo.tempC}°` : '—'}</strong><span>CPU temp</span></div>
        <div><Gauge /><strong>{hostInfo.load1 != null ? hostInfo.load1 : '—'}</strong><span>Load avg</span></div>
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
        <div><ShieldCheck /><span><strong>PiWake API</strong><Status value={apiOk == null ? 'asleep' : apiOk ? 'online' : 'offline'}>{apiOk == null ? 'Demo' : apiOk ? 'Online' : 'Unreachable'}</Status></span></div>
        <div><Network /><span><strong>LAN relay</strong><Status value={apiOk == null ? 'asleep' : apiOk ? 'online' : 'offline'}>{apiOk == null ? 'Demo' : apiOk ? 'Online' : 'Unknown'}</Status></span></div>
        <div><Router /><span><strong>Tailscale</strong><Status value={tailscale.value} /></span></div>
      </section>
      <button className="secondary-action danger" onClick={shutdownHost}><Power size={18} />Shut down Raspberry Pi</button>
      <p className="danger-note">停止すると、すべてのWake-on-LANとリモート接続が使えなくなります。</p>
    </main>
  </>;
}

const activityGlyphs = [
  [/packet|wake/i, Power],
  [/shutdown/i, Power],
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

function activityLabel(action) {
  if (/wake succeeded/i.test(action)) return '起動しました';
  if (/wake timed out/i.test(action)) return '起動がタイムアウトしました';
  if (/wake failed/i.test(action)) return '起動に失敗しました';
  if (/scheduled wake/i.test(action)) return 'スケジュール起動を実行しました';
  if (/magic packet/i.test(action)) return '起動パケットを送信しました';
  if (/shutdown requested/i.test(action)) return 'シャットダウンを実行しました';
  if (/ssh opened/i.test(action)) return 'SSHを開きました';
  if (/desktop opened/i.test(action)) return 'デスクトップを開きました';
  if (/device added/i.test(action)) return 'デバイスを追加しました';
  if (/device removed/i.test(action)) return 'デバイスを削除しました';
  return action;
}

function ActivityView({ toast, devices, startWake, shutdownDevice }) {
  const [logs, setLogs] = useState(null);
  useEffect(() => {
    if (!isApi) {
      setLogs([
        { id: 'd1', deviceId: 'main', deviceName: 'Main PC', action: 'Wake succeeded', at: null, time: '今日 09:41', result: 'success' },
        { id: 'd2', deviceId: 'main', deviceName: 'Main PC', action: 'SSH opened', at: null, time: '昨日 22:08', result: 'neutral' },
        { id: 'd3', deviceId: 'sub', deviceName: 'Sub PC', action: 'Wake timed out', at: null, time: '7月8日 18:32', result: 'warning' },
        { id: 'd4', deviceId: 'server', deviceName: 'Home Server', action: 'Desktop opened', at: null, time: '7月7日 11:04', result: 'neutral' },
      ]);
      return;
    }
    let cancelled = false;
    piwakeClient.getActivity()
      .then(entries => { if (!cancelled) setLogs(entries || []); })
      .catch(() => { if (!cancelled) { setLogs([]); toast('履歴を取得できませんでした'); } });
    return () => { cancelled = true; };
  }, [toast]);
  const runConnectionAgain = (entry, device) => {
    if (/ssh/i.test(entry.action)) openSsh(device, toast);
    else openChromeRemoteDesktop(toast);
  };
  return <><AppHeader title="アクティビティ" /><main className="screen-body"><p className="page-lead">過去の操作を確認し、その場でもう一度実行できます。</p>
    <section className="timeline">
      {(logs || []).map(entry => {
        const Glyph = activityGlyph(entry.action);
        const device = devices.find(item => item.id === entry.deviceId) || devices.find(item => item.name === entry.deviceName);
        const isWake = /wake|magic packet/i.test(entry.action);
        const isShutdown = /shutdown/i.test(entry.action) && !/host/i.test(entry.action);
        const isConnection = /ssh|desktop/i.test(entry.action);
        return <div className="timeline-row" key={entry.id}>
          <span className={`timeline-icon ${entry.result}`}><Glyph size={18} /></span>
          <span className="timeline-copy"><strong>{activityLabel(entry.action)}</strong><small>{entry.deviceName} · {entry.time || formatActivityTime(entry.at)}</small></span>
          {device && (isWake || isShutdown || isConnection) && <span className="timeline-actions">
            {isWake && <button type="button" aria-label={`${entry.deviceName}をもう一度起動`} onClick={() => startWake(device)}><RotateCcw size={14} />再実行</button>}
            {isWake && device.status === 'online' && <button type="button" className="inverse" aria-label={`${entry.deviceName}を停止`} onClick={() => shutdownDevice(device)}><Power size={14} />停止</button>}
            {isShutdown && <button type="button" className="inverse" aria-label={`${entry.deviceName}を起動`} onClick={() => startWake(device)}><Power size={14} />起動</button>}
            {isShutdown && device.status === 'online' && <button type="button" aria-label={`${entry.deviceName}の停止を再実行`} onClick={() => shutdownDevice(device)}><RotateCcw size={14} />再実行</button>}
            {isConnection && <button type="button" aria-label={`${entry.deviceName}への接続を再実行`} onClick={() => runConnectionAgain(entry, device)}><RotateCcw size={14} />再実行</button>}
          </span>}
        </div>;
      })}
      {logs && !logs.length && <div className="empty-row">まだ履歴がありません</div>}
    </section></main></>;
}

function SettingsView({ setView, toast, resetDemo, apiIssue }) {
  const [checking, setChecking] = useState(false);
  const [token, setToken] = useState(getApiToken());
  const [fontId, setFontId] = useState(getFontId());
  useEffect(() => { loadFontPreviews(); }, []);
  const chooseFont = option => {
    setFont(option.id);
    setFontId(option.id);
    toast(`フォントを ${option.label} に変更しました`);
  };
  const checkConnection = async () => {
    setChecking(true);
    try {
      const health = await piwakeClient.checkHealth();
      toast(health.authRequired && !getApiToken() ? 'APIトークン（合言葉）が必要です' : `${runtime.label} is ready`);
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
  const tailnetOk = isApi ? !apiIssue : true;
  return <><AppHeader title="Settings" onBack={() => setView('home')} /><main className="screen-body">
    <section className="settings-intro"><ShieldCheck size={30} /><h1>Tailscale-first</h1><p>PiWakeは公開ポートを使わず、あなたのtailnet内だけで通信します。</p></section>
    <div className="section-label">Runtime</div><section className="runtime-panel squircle"><div><span className={`runtime-dot ${runtime.mode}${isApi && apiIssue ? ' down' : ''}`} /><span><strong>{runtime.label}</strong><small>{isApi && apiIssue ? apiIssue : (runtime.apiBaseUrl || 'Local state · no network calls')}</small></span></div><button type="button" onClick={checkConnection} disabled={checking}>{checking ? 'Checking…' : 'Check'}</button></section>
    {isApi && <>
      <div className="section-label">API token</div>
      <form className="manual-form squircle token-form" onSubmit={saveToken}>
        <label><span className="token-label"><KeyRound size={13} /> APIトークン（合言葉）</span>
          <input type="password" autoComplete="off" placeholder="未設定（Tailscale ACLで保護）" value={token} onChange={e => setToken(e.target.value)} />
          <small className="field-hint">Piをセットアップした人が決めた PIWAKE_TOKEN の値です。わからない場合は設定した人に確認してください。</small></label>
        <button className="secondary-action" type="submit">保存</button>
      </form>
    </>}
    <div className="section-label">Appearance</div>
    <section className="font-list squircle">
      {FONT_OPTIONS.map(option => (
        <button key={option.id} type="button" className={`font-row ${fontId === option.id ? 'selected' : ''}`} onClick={() => chooseFont(option)}>
          <span className="font-copy" style={{ fontFamily: `"${option.family}", sans-serif` }}>
            <strong>{option.label}</strong><small>家のPCを、外から起こす。 Wake 0123</small>
          </span>
          <span className="check-box">{fontId === option.id && <Check size={14} />}</span>
        </button>
      ))}
    </section>
    <p className="danger-note font-note">フォントはGoogle Fontsから都度読み込まれます（端末やPiには保存されません）。</p>
    <section className="setting-list squircle">
      <button onClick={() => { window.location.href = '/simple'; }}><Monitor size={18} /><span>シンプルモードを開く（/simple）</span><ChevronRight size={17} /></button>
    </section>
    <div className="section-label">Security</div><section className="setting-list squircle"><button><ShieldCheck size={18} /><span>Tailnet access</span><Status value={!isApi ? 'asleep' : tailnetOk ? 'online' : 'offline'}>{!isApi ? 'Demo' : tailnetOk ? 'Connected' : 'Unreachable'}</Status></button><button onClick={() => setView('diagnostics')}><Network size={18} /><span>Connection diagnostics</span><ChevronRight size={17} /></button></section>
    {runtime.mode === 'demo' && <button className="quiet-action reset-demo" type="button" onClick={resetDemo}>Reset demo data</button>}
  </main></>;
}

function ConnectionDiagnosticsView({ setView, apiIssue, hostInfo }) {
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState(null);
  const runDiagnostics = useCallback(async () => {
    setChecking(true);
    const checkedAt = new Date();
    if (!isApi) {
      setReport({ api: true, host: true, authRequired: false, latencyMs: null, checkedAt, note: 'デモモードでは通信を行わないため、応答時間は計測できません。' });
      setChecking(false);
      return;
    }
    try {
      const startedAt = performance.now();
      const health = await piwakeClient.checkHealth();
      const latencyMs = Math.max(1, Math.round(performance.now() - startedAt));
      const host = await piwakeClient.getHost();
      setReport({ api: true, host: Boolean(host), authRequired: Boolean(health.authRequired), latencyMs, checkedAt, note: '' });
    } catch (error) {
      setReport({ api: false, host: false, authRequired: error.status === 401, latencyMs: null, checkedAt, note: error.status === 401 ? 'APIトークンを確認してください。' : 'PiWake APIから応答がありません。' });
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => { runDiagnostics(); }, [runDiagnostics]);
  const apiState = report ? (report.api ? 'online' : 'offline') : 'asleep';
  const tailscale = hostTailscaleState(hostInfo);
  return <><AppHeader title="接続診断" eyebrow="Settings" onBack={() => setView('settings')} /><main className="screen-body diagnostics-body">
    <p className="page-lead">ブラウザからRaspberry Piまでの接続経路と、現在の設定を確認します。</p>
    <section className="diagnostics-summary squircle">
      <span className={`diagnostics-mark ${apiState}`}><Network size={23} /></span>
      <div><strong>{checking ? '診断しています…' : report?.api ? '接続は正常です' : '接続を確認してください'}</strong><small>{report?.checkedAt ? `最終確認 ${report.checkedAt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : '確認待ち'}</small></div>
      <Status value={apiState}>{checking ? '確認中' : report?.api ? '正常' : '未接続'}</Status>
    </section>
    <div className="section-label">Connection path</div>
    <section className="diagnostics-list squircle">
      <div><span><Globe2 size={17} /><strong>Web UI</strong></span><small>{window.location.origin}</small><Status value="online">表示中</Status></div>
      <div><span><ShieldCheck size={17} /><strong>PiWake API</strong></span><small>{runtime.apiBaseUrl || '同一オリジン'}</small><Status value={apiState}>{report?.api ? '応答あり' : checking ? '確認中' : '応答なし'}</Status></div>
      <div><span><Gauge size={17} /><strong>Pi応答時間</strong></span><small>ブラウザ → /api/health → ブラウザ</small><Status value={report?.latencyMs != null ? 'online' : 'asleep'}>{report?.latencyMs != null ? `${report.latencyMs} ms` : '未計測'}</Status></div>
      <div><span><Router size={17} /><strong>Tailscale</strong></span><small>{hostInfo.tailscaleIp || 'IPを取得できません'}</small><Status value={tailscale.value}>{tailscale.label}</Status></div>
      <div><span><KeyRound size={17} /><strong>API認証</strong></span><small>{getApiToken() ? 'トークン保存済み' : 'トークン未設定'}</small><Status value={!isApi ? 'asleep' : report?.authRequired && !getApiToken() ? 'offline' : 'online'}>{!isApi ? 'Demo' : report?.authRequired ? '必須' : '任意'}</Status></div>
      <div><span><Server size={17} /><strong>Wake relay</strong></span><small>{hostInfo.name}</small><Status value={report?.host ? 'online' : apiState}>{report?.host ? '利用可能' : '不明'}</Status></div>
    </section>
    {report?.note && <p className="diagnostics-note">{report.note}</p>}
    {apiIssue && <p className="diagnostics-note warning">{apiIssue}</p>}
    <button type="button" className="secondary-action" onClick={runDiagnostics} disabled={checking}><RefreshCw size={17} className={checking ? 'spinning' : ''} />{checking ? '診断中…' : 'もう一度診断'}</button>
  </main></>;
}

function ConnectionSetup({ device, setView, patchDevice, toast }) {
  const [user, setUser] = useState(device?.user || '');
  const [sshPort, setSshPort] = useState(device?.sshPort || '');
  const [rdpPort, setRdpPort] = useState(device?.rdpPort || '');
  const [webUrl, setWebUrl] = useState(device?.webUrl || '');
  const [saving, setSaving] = useState(false);
  if (!device) return null;
  const save = async event => {
    event.preventDefault();
    setSaving(true);
    const ok = await patchDevice(device, {
      user: user.trim() || null,
      sshPort: sshPort ? Number(sshPort) : null,
      rdpPort: rdpPort ? Number(rdpPort) : null,
      webUrl: webUrl.trim() || null,
    });
    setSaving(false);
    if (ok) {
      toast('接続設定を保存しました');
      setView('detail');
    }
  };
  return <><AppHeader title="Connection setup" eyebrow={device.name} onBack={() => setView('detail')} /><main className="screen-body">
    <p className="page-lead">SSH・RDP・Webサービスの接続情報です。接続コマンドと稼働状態の判定に使われます。</p>
    <form className="manual-form squircle" onSubmit={save}>
      <label>SSHユーザー名（既定は pi）<input autoComplete="off" placeholder="pi" value={user} onChange={e => setUser(e.target.value)} /></label>
      <label>SSHポート（既定は 22）<input type="number" min="1" max="65535" inputMode="numeric" placeholder="22" value={sshPort} onChange={e => setSshPort(e.target.value)} /></label>
      <label>RDPポート（既定は 3389）<input type="number" min="1" max="65535" inputMode="numeric" placeholder="3389" value={rdpPort} onChange={e => setRdpPort(e.target.value)} /></label>
      <label>Web URL（NASの管理画面など・任意）
        <input type="url" autoComplete="off" placeholder="http://192.168.1.90:5000" value={webUrl} onChange={e => setWebUrl(e.target.value)} />
        <small className="field-hint">設定するとデバイス詳細に「Web service」の接続導線と稼働状態が表示されます</small>
      </label>
      <button className="primary-action" type="submit" disabled={saving}>{saving ? '保存中…' : '保存する'}</button>
    </form>
  </main></>;
}

const jobStateToStep = { packet_sent: 1, responding: 2, reachable: 3, ready: 4 };
const WAKE_UI_DEADLINE_MS = 150000;

// ---------------------------------------------------------- simple mode

const WAKE_TERMINAL = ['ready', 'timeout', 'failed', 'cancelled'];
const wakeStateLabels = {
  packet_sent: '⚡ 起動信号を送信しました…',
  responding: '📡 デバイスが応答しています…',
  reachable: '🔗 接続を確認しています…',
  ready: '✅ 起動しました',
  timeout: '⏱ 応答がありません(電源・WOL設定を確認)',
  failed: '⚠️ 起動に失敗しました',
  cancelled: 'キャンセルしました',
};

function SimpleCard({ device, wake, pingState, onWake, onPing, onShutdown, toast }) {
  const online = device.status === 'online';
  const waking = wake && !WAKE_TERMINAL.includes(wake.state);
  return <article className={`simple-card squircle ${online ? 'is-online' : ''}`}>
    {device.pinned && <Pin size={11} className="pin-mark" />}
    <div className="simple-head">
      <DeviceGlyph device={device} size={30} />
      <div><strong>{device.name}</strong><Status value={device.status} /></div>
    </div>
    <p className="simple-meta">{device.ip || device.localIp || 'IP未設定'} · {deviceLast(device)}</p>
    {(wake || pingState) && <p className="simple-note">
      {wake && wakeStateLabels[wake.state]}
      {wake && pingState && ' · '}
      {pingState === 'busy' ? 'Ping中…' : pingState === 'alive' ? '📶 Ping応答あり' : pingState === 'dead' ? '📴 Ping応答なし' : ''}
    </p>}
    <div className="simple-actions">
      {!online && <button className="sa sa-primary" disabled={waking} onClick={onWake}><Power size={14} />{waking ? '起動中…' : '起動'}</button>}
      <button className="sa" disabled={pingState === 'busy'} onClick={onPing}><Radio size={14} />Ping</button>
      <button className="sa" onClick={() => openSsh(device, toast)}><Terminal size={14} />SSH</button>
      <button className="sa" onClick={() => openRdp(device, toast)}><Desktop size={14} />RDP</button>
      <button className="sa" onClick={() => openChromeRemoteDesktop(toast)}><ExternalLink size={14} />CRD</button>
      {device.webUrl && <button className="sa" onClick={() => window.open(device.webUrl, '_blank', 'noopener')}><Globe2 size={14} />Web</button>}
      {online && <button className="sa sa-danger" onClick={onShutdown}><Power size={14} />停止</button>}
    </div>
  </article>;
}

function SimpleApp() {
  const [devices, setDevices] = useState(() => isApi ? [] : loadAppState(seedDevices).devices);
  const [hostInfo, setHostInfo] = useState(isApi
    ? { name: 'Raspberry Pi', tempC: null, load1: null, uptimeSeconds: NaN, tailscaleIp: null, tailscaleOnline: null }
    : demoHost);
  const [apiIssue, setApiIssue] = useState('');
  const [wakes, setWakes] = useState({});   // deviceId -> { jobId, state, startedAt }
  const [pings, setPings] = useState({});   // deviceId -> 'busy' | 'alive' | 'dead'
  const [toastMessage, setToastMessage] = useState('');
  const toastTimer = useRef();
  const toast = useCallback(message => {
    clearTimeout(toastTimer.current);
    setToastMessage(message);
    toastTimer.current = setTimeout(() => setToastMessage(''), 3200);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const refresh = useCallback(async () => {
    if (!isApi) return;
    try {
      const [list, host] = await Promise.all([piwakeClient.listDevices(), piwakeClient.getHost()]);
      if (Array.isArray(list)) setDevices(list);
      if (host) setHostInfo(host);
      setApiIssue('');
    } catch (error) {
      setApiIssue(error.status === 401 ? 'APIトークンが必要です(通常表示のSettingsで設定)' : 'PiWake APIに接続できません');
    }
  }, []);

  useEffect(() => {
    if (!isApi) return;
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  // SSE: instant device list + wake-job updates (keyed by deviceId).
  useEffect(() => {
    if (!isApi || typeof EventSource === 'undefined') return;
    let source;
    try { source = new EventSource(eventsUrl()); } catch { return; }
    source.addEventListener('devices', event => {
      try { setDevices(JSON.parse(event.data)); } catch { /* malformed */ }
    });
    source.addEventListener('job', event => {
      try {
        const job = JSON.parse(event.data);
        setWakes(current => current[job.deviceId] ? { ...current, [job.deviceId]: { ...current[job.deviceId], state: job.state } } : current);
      } catch { /* malformed */ }
    });
    return () => source.close();
  }, []);

  // Drive active wakes: poll jobs in API mode, simulate steps in demo mode.
  useEffect(() => {
    const active = Object.entries(wakes).filter(([, wake]) => !WAKE_TERMINAL.includes(wake.state));
    if (!active.length) return;
    const id = setInterval(() => {
      for (const [deviceId, wake] of active) {
        if (!isApi) {
          setWakes(current => {
            const entry = current[deviceId];
            if (!entry || WAKE_TERMINAL.includes(entry.state)) return current;
            const order = ['packet_sent', 'responding', 'reachable', 'ready'];
            const next = order[Math.min(order.indexOf(entry.state) + 1, 3)];
            if (next === 'ready') {
              setDevices(ds => ds.map(d => d.id === deviceId ? { ...d, status: 'online', last: 'いま' } : d));
              notifyReady(devices.find(d => d.id === deviceId)?.name || 'デバイス');
            }
            return { ...current, [deviceId]: { ...entry, state: next } };
          });
          continue;
        }
        if (Date.now() - wake.startedAt > WAKE_UI_DEADLINE_MS) {
          setWakes(current => ({ ...current, [deviceId]: { ...current[deviceId], state: 'timeout' } }));
          continue;
        }
        if (!wake.jobId) continue;
        piwakeClient.getWakeJob(wake.jobId).then(job => {
          setWakes(current => {
            const entry = current[deviceId];
            if (!entry || entry.state === job.state) return current;
            if (job.state === 'ready') {
              notifyReady(devices.find(d => d.id === deviceId)?.name || 'デバイス');
              refresh();
            }
            return { ...current, [deviceId]: { ...entry, state: job.state } };
          });
        }).catch(() => { /* transient — deadline will cover it */ });
      }
    }, isApi ? 2000 : 900);
    return () => clearInterval(id);
  }, [wakes, devices, refresh]);

  const startWake = async device => {
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* optional */ }
    try {
      const result = await piwakeClient.wakeDevice(device);
      setWakes(current => ({ ...current, [device.id]: { jobId: result?.jobId || null, state: 'packet_sent', startedAt: Date.now() } }));
    } catch (error) {
      toast(error.status === 401 ? 'APIトークンが必要です' : 'Wakeリクエストを送信できませんでした');
    }
  };

  const doPing = async device => {
    setPings(current => ({ ...current, [device.id]: 'busy' }));
    const finish = alive => {
      setPings(current => ({ ...current, [device.id]: alive ? 'alive' : 'dead' }));
      setTimeout(() => setPings(current => {
        const { [device.id]: _gone, ...rest } = current;
        return rest;
      }), 6000);
    };
    if (!isApi) {
      setTimeout(() => finish(device.status === 'online'), 700);
      return;
    }
    try {
      const result = await piwakeClient.pingDevice(device.id);
      finish(Boolean(result?.alive));
    } catch {
      finish(false);
      toast('Pingを実行できませんでした');
    }
  };

  const doShutdown = device => {
    if (!window.confirm(`${device.name} をシャットダウンしますか？`)) return;
    if (!isApi) return toast('（デモ）シャットダウン導線を確認しました');
    piwakeClient.shutdownDevice(device.id)
      .then(() => toast('シャットダウン信号を送信しました'))
      .catch(() => toast('シャットダウンできませんでした（PiからのSSH鍵設定が必要です）'));
  };

  const hostView = isApi && apiIssue ? { ...hostInfo, tailscaleOnline: false, tempC: null } : hostInfo;
  const tailscale = hostTailscaleState(hostView);
  const ordered = [...devices].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  return <div className="simple-shell">
    <header className="simple-top">
      <img src="/icon.svg" alt="" className="brand-mark" />
      <div className="simple-title"><strong>PiWake</strong><small>Simple mode</small></div>
      <div className="simple-host">
        <span>{hostView.name}</span>
        <Status value={tailscale.value}>{tailscale.label}</Status>
        {hostView.tempC != null && <span className="simple-temp"><Thermometer size={12} /> {hostView.tempC}°</span>}
      </div>
      <a className="simple-back" href="/">通常表示 <ChevronRight size={14} /></a>
    </header>
    {apiIssue && <button className="api-banner simple-banner" onClick={() => { window.location.href = '/'; }}><Wifi size={14} />{apiIssue}<ChevronRight size={14} /></button>}
    <main className="simple-grid">
      {ordered.map(device => (
        <SimpleCard key={device.id} device={device} wake={wakes[device.id]} pingState={pings[device.id]}
          onWake={() => startWake(device)} onPing={() => doPing(device)} onShutdown={() => doShutdown(device)} toast={toast} />
      ))}
      {!ordered.length && <p className="empty-row">デバイスがありません。通常表示から追加してください。</p>}
    </main>
    {toastMessage && <div className="toast simple-toast" role="status" aria-live="polite"><Check size={16} />{toastMessage}</div>}
  </div>;
}

function App() {
  const initialState = useMemo(() => loadAppState(seedDevices), []);
  const [view, setView] = useState('home');
  const [devices, setDevices] = useState(isApi ? [] : initialState.devices);
  const [selectedId, setSelectedId] = useState(initialState.selectedId);
  const [hostInfo, setHostInfo] = useState(isApi
    ? { name: 'Raspberry Pi', tempC: null, load1: null, uptimeSeconds: NaN, tailscaleIp: null, tailscaleOnline: null }
    : demoHost);
  const [apiIssue, setApiIssue] = useState('');
  const [wakeDevice, setWakeDevice] = useState(null);
  const [wakeJobId, setWakeJobId] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [shutdownTarget, setShutdownTarget] = useState(null);
  const [step, setStep] = useState(0);
  const [wakeFailed, setWakeFailed] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const toastTimer = useRef();
  const wakeJobRef = useRef(null);
  const wakeStartRef = useRef(0);
  const jobMissesRef = useRef(0);
  const notifiedRef = useRef(false);
  const selected = devices.find(d => d.id === selectedId) || devices[0];
  const toast = useCallback(message => {
    clearTimeout(toastTimer.current);
    setToastMessage(message);
    toastTimer.current = setTimeout(() => setToastMessage(''), 3200);
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

  const applyJobUpdate = useCallback(job => {
    if (!job || job.id !== wakeJobRef.current) return;
    if (job.state in jobStateToStep) setStep(jobStateToStep[job.state]);
    if (['timeout', 'failed'].includes(job.state)) setWakeFailed(true);
    if (job.state === 'ready') refreshFromApi();
  }, [refreshFromApi]);

  // Live updates over SSE; the 15s poll above stays on as a fallback.
  useEffect(() => {
    if (!isApi || typeof EventSource === 'undefined') return;
    let source;
    try { source = new EventSource(eventsUrl()); } catch { return; }
    source.addEventListener('devices', event => {
      try {
        const list = JSON.parse(event.data);
        setDevices(list);
        setSelectedId(current => list.some(d => d.id === current) ? current : list[0]?.id);
      } catch { /* malformed event */ }
    });
    source.addEventListener('job', event => {
      try { applyJobUpdate(JSON.parse(event.data)); } catch { /* malformed event */ }
    });
    return () => source.close();
  }, [applyJobUpdate]);

  const startWake = device => { setWakeDevice(device); setConfirming(true); };

  const confirmWake = async () => {
    setConfirming(false); setStep(0); setWakeFailed(false); setView('waking');
    wakeStartRef.current = Date.now();
    jobMissesRef.current = 0;
    notifiedRef.current = false;
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* optional */ }
    try {
      const result = await piwakeClient.wakeDevice(wakeDevice);
      wakeJobRef.current = result?.jobId || null;
      setWakeJobId(result?.jobId || null);
      if (isApi) setStep(1);
    }
    catch (error) { setView('home'); toast(error.status === 401 ? 'APIトークンが必要です' : 'Wakeリクエストを送信できませんでした'); }
  };

  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => { if (!isApi) saveAppState({ devices, selectedId }); }, [devices, selectedId]);

  // Notify once when the machine becomes ready.
  useEffect(() => {
    if (view === 'waking' && step >= 4 && !notifiedRef.current) {
      notifiedRef.current = true;
      notifyReady((wakeDevice || selected)?.name || 'デバイス');
    }
  }, [view, step, wakeDevice, selected]);

  // Demo mode: simulated progress. API mode: poll the wake job (SSE is faster
  // when available; polling is the guaranteed path).
  useEffect(() => {
    if (view !== 'waking' || step >= 4 || wakeFailed) return;
    if (!isApi) {
      const id = setTimeout(() => setStep(s => s + 1), 850);
      return () => clearTimeout(id);
    }
    if (!wakeJobId) return;
    const id = setInterval(async () => {
      if (Date.now() - wakeStartRef.current > WAKE_UI_DEADLINE_MS) {
        setWakeFailed(true);
        toast('Wakeがタイムアウトしました');
        return;
      }
      try {
        const job = await piwakeClient.getWakeJob(wakeJobId);
        jobMissesRef.current = 0;
        applyJobUpdate(job);
        if (['timeout', 'failed'].includes(job.state)) toast(job.state === 'timeout' ? 'Wakeがタイムアウトしました' : 'Wakeに失敗しました');
      } catch (error) {
        if (error.status === 404 && ++jobMissesRef.current >= 4) {
          setWakeFailed(true);
          toast('Wakeジョブが見つかりません（Piが再起動した可能性があります）');
        }
        // Other errors are transient — keep trying until the deadline.
      }
    }, 1500);
    return () => clearInterval(id);
  }, [view, step, wakeJobId, wakeFailed, applyJobUpdate, toast]);

  const cancelWake = () => {
    piwakeClient.cancelWakeJob(wakeJobId).catch(() => {});
    wakeJobRef.current = null;
    setWakeJobId(null);
    setView('home');
  };

  const finishWake = target => {
    if (isApi) refreshFromApi();
    else setDevices(ds => ds.map(d => d.id === wakeDevice.id ? { ...d, status: 'online', last: 'いま' } : d));
    wakeJobRef.current = null;
    setWakeJobId(null);
    setView('home');
    if (target === 'ssh') openSsh(wakeDevice, toast);
    else openChromeRemoteDesktop(toast);
  };

  const addDevice = async payload => {
    try {
      const created = await piwakeClient.addDevice({
        ...payload,
        osSource: payload.os ? 'manual' : 'inferred',
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

  const shutdownDevice = device => setShutdownTarget({ kind: 'device', device });

  const shutdownHost = () => setShutdownTarget({ kind: 'host', name: hostInfo.name });

  const confirmShutdown = async () => {
    const target = shutdownTarget;
    setShutdownTarget(null);
    if (!target) return;
    if (!isApi) return toast(`（デモ）${target.kind === 'host' ? 'ホスト停止' : 'シャットダウン'}の確認が完了しました`);
    try {
      if (target.kind === 'host') {
        await piwakeClient.shutdownHost();
        toast('Raspberry Piを停止しています…');
      } else {
        await piwakeClient.shutdownDevice(target.device.id);
        toast('シャットダウン信号を送信しました');
      }
    } catch {
      toast(target.kind === 'host' ? '停止できませんでした（sudoersでshutdownの許可が必要です）' : 'シャットダウンできませんでした（PiからのSSH鍵設定が必要です）');
    }
  };

  const patchDevice = async (device, patch) => {
    try {
      if (isApi) {
        await piwakeClient.updateDevice(device.id, patch);
        await refreshFromApi();
      } else {
        setDevices(ds => ds.map(d => d.id === device.id ? { ...d, ...patch } : d));
      }
      return true;
    } catch (error) {
      toast(error.status === 400 ? error.message : '更新できませんでした');
      return false;
    }
  };

  const togglePin = async device => {
    const next = !device.pinned;
    if (await patchDevice(device, { pinned: next })) {
      toast(next ? 'ピン留めしました' : 'ピン留めを解除しました');
    }
  };

  const resetDemo = () => { resetAppState(); setDevices(seedDevices); setSelectedId('main'); setView('home'); toast('デモデータをリセットしました'); };

  // The server already sorts pinned-first; re-sorting keeps demo mode consistent.
  const orderedDevices = useMemo(
    () => [...devices].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)),
    [devices],
  );

  // Keep every status indicator consistent: when the API is unreachable, the
  // host cannot be claimed online no matter what the last snapshot said.
  const hostView = isApi && apiIssue ? { ...hostInfo, tailscaleOnline: false, tempC: null } : hostInfo;
  const apiOk = isApi ? !apiIssue : null;

  const content = (() => {
    if (view === 'home') return <HomeView devices={orderedDevices} selectedId={selectedId} setSelectedId={setSelectedId} setView={setView} startWake={startWake} toast={toast} hostInfo={hostView} />;
    if (view === 'devices') return <DevicesView devices={orderedDevices} selectedId={selectedId} selectDevice={setSelectedId} setView={setView} hostInfo={hostView} />;
    if (view === 'detail') return <DetailView device={selected} setView={setView} startWake={startWake} removeDevice={removeDevice} shutdownDevice={shutdownDevice} togglePin={togglePin} patchDevice={patchDevice} toast={toast} />;
    if (view === 'waking') return <WakeProgress device={wakeDevice || selected} step={step} failed={wakeFailed} cancel={cancelWake} finish={finishWake} />;
    if (view === 'add') return <AddDevice onBack={() => setView('devices')} addDevice={addDevice} setView={setView} hostInfo={hostView} toast={toast} />;
    if (view === 'host') return <HostDetail setView={setView} toast={toast} hostInfo={hostView} apiOk={apiOk} shutdownHost={shutdownHost} />;
    if (view === 'activity') return <ActivityView toast={toast} devices={orderedDevices} startWake={startWake} shutdownDevice={shutdownDevice} />;
    if (view === 'settings') return <SettingsView setView={setView} toast={toast} resetDemo={resetDemo} apiIssue={apiIssue} />;
    if (view === 'diagnostics') return <ConnectionDiagnosticsView setView={setView} apiIssue={apiIssue} hostInfo={hostView} />;
    if (view === 'connections') return <ConnectionSetup device={selected} setView={setView} patchDevice={patchDevice} toast={toast} />;
  })();
  const showNav = ['home', 'devices', 'activity'].includes(view);
  return <div className="site-shell"><div className="ambient" /><aside className="desktop-rail"><div className="brand"><img src="/icon.svg" alt="" className="brand-mark" /><span>PiWake</span></div><p>自宅のPCを、<br />必要なときだけ。</p><nav><button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}><Home />ホーム</button><button className={view === 'devices' ? 'active' : ''} onClick={() => setView('devices')}><Server />デバイス</button><button className={view === 'activity' ? 'active' : ''} onClick={() => setView('activity')}><Activity />履歴</button></nav><div className="rail-footer"><div className="rail-runtime"><Status value={!isApi ? 'asleep' : apiIssue ? 'offline' : 'online'}>{!isApi ? 'デモモード' : apiIssue ? 'APIに接続できません' : 'Tailnet 接続中'}</Status><small>{runtime.label}</small></div><button onClick={() => setView('settings')}><Settings size={17} />設定</button></div></aside><div className="app-frame">{apiIssue && <button className="api-banner" onClick={() => setView('settings')}><Wifi size={14} />{apiIssue}<ChevronRight size={14} /></button>}{content}{showNav && <Nav view={view} setView={setView} />}{confirming && wakeDevice && <WakeConfirm device={wakeDevice} hostName={hostInfo.name} onCancel={() => setConfirming(false)} onConfirm={confirmWake} />}{shutdownTarget && <ShutdownConfirm target={shutdownTarget} onCancel={() => setShutdownTarget(null)} onConfirm={confirmShutdown} />}{toastMessage && <div className="toast" role="status" aria-live="polite"><Check size={16} />{toastMessage}</div>}</div></div>;
}

initFont();
const simpleMode = window.location.pathname.replace(/\/+$/, '') === '/simple';
createRoot(document.getElementById('root')).render(simpleMode ? <SimpleApp /> : <App />);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline shell is optional */ });
  });
}
