import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Linking, Modal, Pressable, ScrollView,
  StyleSheet, Text, TextInput, Vibration, View,
} from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import {
  Activity, ArrowLeft, Check, ChevronRight, CircleHelp, Clock3, Cpu,
  MonitorUp, ExternalLink, Gauge, Globe2, Home, KeyRound, Monitor,
  CalendarClock, Pin, Plus, Power, RefreshCw, Radio, Search, Server, Settings, ShieldCheck,
  SlidersHorizontal, Terminal, Thermometer, Trash2,
} from 'lucide-react-native';
import { colors } from './src/theme';
import { getConfig, isDemo, loadConfig, piwakeClient, saveConfig } from './src/piwakeClient';

const demoHost = { name: 'raspberrypi-5', tempC: 46, load1: 0.2, uptimeSeconds: 195000, tailscaleIp: '100.100.1.1', tailscaleOnline: true };
const seedDevices = [
  { id: 'main', name: 'Main PC', kind: 'pc', ip: '100.100.1.23', mac: 'D4:5D:64:12:34:56', status: 'offline', last: '3日前', location: 'Home Office' },
  { id: 'sub', name: 'Sub PC', kind: 'pc', ip: '100.100.1.42', mac: '8C:47:BE:20:11:08', status: 'offline', last: '昨日', location: 'Desk' },
  { id: 'server', name: 'Home Server', kind: 'server', ip: '100.100.1.10', mac: '60:A4:B7:09:CF:2A', status: 'online', last: 'いま', location: 'Rack' },
];
const demoDiscovered = [
  { name: 'Office PC', ip: '192.168.1.66', mac: '3C:52:82:9A:11:22' },
  { name: 'Gaming PC', ip: '192.168.1.88', mac: '70:85:C2:55:AA:33' },
  { name: 'NAS', ip: '192.168.1.90', mac: '1C:69:7A:10:B8:44', kind: 'server' },
];
const demoActivity = [
  { id: 'd1', deviceName: 'Main PC', action: 'Wake succeeded', time: 'Today, 09:41', result: 'success' },
  { id: 'd2', deviceName: 'raspberrypi-5', action: 'SSH opened', time: 'Yesterday, 22:08', result: 'neutral' },
  { id: 'd3', deviceName: 'Sub PC', action: 'Wake timed out', time: 'Jul 8, 18:32', result: 'warning' },
];

const statusText = { online: 'Online', offline: 'Offline', asleep: 'Asleep' };
const statusColor = { online: colors.green, offline: colors.muted, asleep: colors.amber };
const jobStateToStep = { packet_sent: 1, responding: 2, reachable: 3, ready: 4 };
const WAKE_UI_DEADLINE_MS = 150000;

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

function formatActivityTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const sameDay = new Date().toDateString() === date.toDateString();
  const time = date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `Today, ${time}` : `${date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}, ${time}`;
}

function deviceLast(device) {
  return device.last || timeAgo(device.lastSeenAt);
}

function reachableAddress(device) {
  return device.ip || device.localIp;
}

async function openSsh(device, toast) {
  const address = reachableAddress(device);
  if (!address) return toast('接続先IPが設定されていません');
  const target = `${device.user || 'pi'}@${address}`;
  await Clipboard.setStringAsync(`ssh ${target}`);
  try { await Linking.openURL(`ssh://${target}`); } catch { /* no ssh app installed */ }
  toast(`「ssh ${target}」をコピーしました`);
}

async function openChromeRemoteDesktop(toast) {
  try { await Linking.openURL('https://remotedesktop.google.com/access'); } catch { /* no browser */ }
  toast('Chrome Remote Desktopを開きました（PC側の事前設定が必要です）');
}

async function openRdp(device, toast) {
  const address = reachableAddress(device);
  if (!address) return toast('接続先IPが設定されていません');
  await Clipboard.setStringAsync(address);
  try { await Linking.openURL(`rdp://full%20address=s:${address}`); } catch { /* no rdp app installed */ }
  toast(`${address} をコピーしました。RDPアプリで貼り付けて接続`);
}

function DeviceGlyph({ device, size = 26, color }) {
  const Glyph = device.kind === 'host' ? Cpu : device.kind === 'server' ? Server : Monitor;
  return <Glyph size={size} strokeWidth={1.7} color={color || (device.kind === 'host' ? '#ff5b68' : '#a8b0bc')} />;
}

function StatusPill({ value = 'offline', label }) {
  return (
    <View style={s.statusRow}>
      <View style={[s.statusDot, { backgroundColor: statusColor[value] || colors.muted }]} />
      <Text style={[s.statusLabel, { color: statusColor[value] || colors.muted }]}>{label || statusText[value]}</Text>
    </View>
  );
}

function Header({ title, eyebrow, onBack, right }) {
  return (
    <View style={s.header}>
      <View style={s.headerSide}>{onBack && <Pressable hitSlop={10} onPress={onBack}><ArrowLeft size={22} color={colors.text} /></Pressable>}</View>
      <View style={s.headerCenter}>
        {eyebrow ? <Text style={s.headerEyebrow}>{eyebrow}</Text> : null}
        <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
      </View>
      <View style={[s.headerSide, { alignItems: 'flex-end' }]}>{right}</View>
    </View>
  );
}

function PrimaryButton({ icon: Glyph, label, onPress }) {
  return (
    <Pressable style={({ pressed }) => [s.primaryBtn, pressed && s.pressed]} onPress={onPress}>
      {Glyph && <Glyph size={19} color="#fff" />}
      <Text style={s.primaryBtnText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ icon: Glyph, label, onPress, danger }) {
  return (
    <Pressable style={({ pressed }) => [s.secondaryBtn, danger && s.secondaryDanger, pressed && s.pressed]} onPress={onPress}>
      {Glyph && <Glyph size={17} color={danger ? '#ff6258' : '#d9dce2'} />}
      <Text style={[s.secondaryBtnText, danger && { color: '#ff6258' }]}>{label}</Text>
    </Pressable>
  );
}

function HostBar({ hostInfo, onOpen }) {
  const online = hostInfo.tailscaleOnline !== false;
  return (
    <Pressable style={({ pressed }) => [s.hostBar, pressed && s.pressed]} onPress={onOpen}>
      <View style={s.hostMark}><Cpu size={20} color="#ff5b68" /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.hostName}>{hostInfo.name}</Text>
        <StatusPill value={online ? 'online' : 'offline'} label={online ? 'Tailscale connected' : 'Tailscale offline'} />
      </View>
      {hostInfo.tempC != null && (
        <View style={s.hostMeta}><Thermometer size={13} color={colors.muted} /><Text style={s.hostMetaText}>{hostInfo.tempC}°</Text></View>
      )}
      <ChevronRight size={18} color={colors.muted} />
    </Pressable>
  );
}

function ConnectionRow({ icon: Glyph, title, detail, accent, onPress }) {
  return (
    <Pressable style={({ pressed }) => [s.connRow, pressed && s.pressed]} onPress={onPress}>
      <View style={[s.connIcon, accent && { backgroundColor: 'rgba(105,156,255,0.1)' }]}>
        <Glyph size={18} color={accent ? colors.blue : '#aeb5c0'} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.connTitle}>{title}</Text>
        <Text style={s.connDetail}>{detail}</Text>
      </View>
      <ChevronRight size={16} color={colors.muted} />
    </Pressable>
  );
}

function Card({ children, style }) {
  return <View style={[s.card, style]}>{children}</View>;
}

function SectionLabel({ children }) {
  return <Text style={s.sectionLabel}>{children}</Text>;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <PiWakeApp />
    </SafeAreaProvider>
  );
}

function PiWakeApp() {
  const [booted, setBooted] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [view, setView] = useState('home');
  const [devices, setDevices] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [hostInfo, setHostInfo] = useState(demoHost);
  const [apiIssue, setApiIssue] = useState('');
  const [wakeDevice, setWakeDevice] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [wakeJobId, setWakeJobId] = useState(null);
  const [step, setStep] = useState(0);
  const [wakeFailed, setWakeFailed] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const toastTimer = useRef();
  const wakeStartRef = useRef(0);
  const jobMissesRef = useRef(0);
  const selected = devices.find(d => d.id === selectedId) || devices[0];

  const toast = useCallback(message => {
    clearTimeout(toastTimer.current);
    setToastMessage(message);
    toastTimer.current = setTimeout(() => setToastMessage(''), 3200);
  }, []);

  const refresh = useCallback(async () => {
    if (isDemo()) return;
    try {
      const [list, host] = await Promise.all([piwakeClient.listDevices(), piwakeClient.getHost()]);
      if (Array.isArray(list)) {
        setDevices(list);
        setSelectedId(current => list.some(d => d.id === current) ? current : list[0]?.id);
      }
      if (host) setHostInfo(host);
      setApiIssue('');
    } catch (error) {
      setApiIssue(error.status === 401 ? 'APIトークンが必要です' : 'PiWake APIに接続できません');
    }
  }, []);

  useEffect(() => {
    (async () => {
      const config = await loadConfig();
      const has = Boolean(config.url);
      setConfigured(has);
      if (!has) {
        setDevices(seedDevices);
        setSelectedId('main');
        setView('setup');
      } else {
        refresh();
      }
      setBooted(true);
    })();
  }, [refresh]);

  useEffect(() => {
    if (!configured) return;
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [configured, refresh]);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const startWake = device => { setWakeDevice(device); setConfirming(true); };

  const confirmWake = async () => {
    setConfirming(false); setStep(0); setWakeFailed(false); setView('waking');
    wakeStartRef.current = Date.now();
    jobMissesRef.current = 0;
    try {
      const result = await piwakeClient.wakeDevice(wakeDevice);
      setWakeJobId(result?.jobId || null);
      if (!isDemo()) setStep(1);
    } catch (error) {
      setView('home');
      toast(error.status === 401 ? 'APIトークンが必要です' : 'Wakeリクエストを送信できませんでした');
    }
  };

  useEffect(() => {
    if (view !== 'waking' || step >= 4 || wakeFailed) return;
    if (isDemo()) {
      const id = setTimeout(() => setStep(v => v + 1), 850);
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
        if (job.state in jobStateToStep) setStep(jobStateToStep[job.state]);
        if (['timeout', 'failed'].includes(job.state)) {
          setWakeFailed(true);
          toast(job.state === 'timeout' ? 'Wakeがタイムアウトしました' : 'Wakeに失敗しました');
        }
        if (job.state === 'ready') refresh();
      } catch (error) {
        if (error.status === 404 && ++jobMissesRef.current >= 4) {
          setWakeFailed(true);
          toast('Wakeジョブが見つかりません');
        }
      }
    }, 1500);
    return () => clearInterval(id);
  }, [view, step, wakeJobId, wakeFailed, refresh, toast]);

  useEffect(() => {
    if (view === 'waking' && step >= 4) Vibration.vibrate(200);
  }, [view, step]);

  const cancelWake = () => {
    piwakeClient.cancelWakeJob(wakeJobId).catch(() => {});
    setWakeJobId(null);
    setView('home');
  };

  const finishWake = async target => {
    if (isDemo()) setDevices(ds => ds.map(d => d.id === wakeDevice.id ? { ...d, status: 'online', last: 'いま' } : d));
    else refresh();
    setWakeJobId(null);
    setView('home');
    if (target === 'ssh') openSsh(wakeDevice, toast);
    else openChromeRemoteDesktop(toast);
  };

  const addDevice = async payload => {
    try {
      const created = await piwakeClient.addDevice({
        ...payload,
        id: isDemo() ? `added-${Date.now()}` : undefined,
        status: 'offline',
        location: payload.location || 'Home',
      });
      if (isDemo()) setDevices(ds => [...ds, created]);
      else await refresh();
      setSelectedId(created.id);
      setView('detail');
      toast(`${payload.name}を追加しました`);
    } catch (error) {
      toast(error.message?.includes('already exists') ? 'このMACアドレスは登録済みです' : 'デバイスを追加できませんでした');
    }
  };

  const removeDevice = device => {
    Alert.alert('デバイスを削除', `${device.name} を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除', style: 'destructive',
        onPress: async () => {
          try {
            await piwakeClient.removeDevice(device.id);
            if (isDemo()) setDevices(ds => ds.filter(d => d.id !== device.id));
            else await refresh();
            setView('devices');
            toast(`${device.name}を削除しました`);
          } catch { toast('デバイスを削除できませんでした'); }
        },
      },
    ]);
  };

  const shutdownDevice = device => {
    Alert.alert('シャットダウン', `${device.name} をシャットダウンしますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: 'シャットダウン', style: 'destructive',
        onPress: async () => {
          if (isDemo()) return toast('（デモ）シャットダウン導線を確認しました');
          try { await piwakeClient.shutdownDevice(device.id); toast('シャットダウン信号を送信しました'); }
          catch { toast('シャットダウンできませんでした（PiからのSSH鍵設定が必要です）'); }
        },
      },
    ]);
  };

  const togglePin = async device => {
    const next = !device.pinned;
    try {
      if (isDemo()) setDevices(ds => ds.map(d => d.id === device.id ? { ...d, pinned: next } : d));
      else { await piwakeClient.updateDevice(device.id, { pinned: next }); await refresh(); }
      toast(next ? 'ピン留めしました' : 'ピン留めを解除しました');
    } catch { toast('更新できませんでした'); }
  };

  const shutdownHost = () => {
    Alert.alert('ホストを停止', `${hostInfo.name} を停止しますか？Wake機能とリモート接続が使えなくなります。`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '停止', style: 'destructive',
        onPress: async () => {
          if (isDemo()) return toast('（デモ）ホスト停止の導線を確認しました');
          try { await piwakeClient.shutdownHost(); toast('Raspberry Piを停止しています…'); }
          catch { toast('停止できませんでした（sudoersの設定が必要です）'); }
        },
      },
    ]);
  };

  if (!booted) {
    return <View style={[s.screen, s.center]}><ActivityIndicator color={colors.accent} /></View>;
  }

  const navItems = [
    ['home', Home, 'Home'],
    ['devices', Server, 'Devices'],
    ['activity', Activity, 'Activity'],
  ];
  const showNav = ['home', 'devices', 'activity'].includes(view);
  // The server already sorts pinned-first; re-sorting keeps demo mode consistent.
  const orderedDevices = [...devices].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      {apiIssue && configured ? (
        <Pressable style={s.apiBanner} onPress={() => setView('settings')}>
          <Text style={s.apiBannerText}>{apiIssue} — 設定を確認</Text>
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        {view === 'home' && <HomeView devices={orderedDevices} {...{ selectedId, setSelectedId, setView, startWake, toast, hostInfo, selected }} />}
        {view === 'devices' && <DevicesView devices={orderedDevices} {...{ selectedId, setSelectedId, setView, hostInfo }} />}
        {view === 'detail' && <DetailView device={selected} {...{ setView, startWake, removeDevice, shutdownDevice, togglePin, toast }} />}
        {view === 'waking' && <WakeProgress device={wakeDevice || selected} {...{ step, wakeFailed, cancelWake, finishWake }} />}
        {view === 'add' && <AddDeviceView {...{ setView, addDevice, toast }} />}
        {view === 'host' && <HostDetail {...{ setView, toast, hostInfo, shutdownHost }} />}
        {view === 'activity' && <ActivityScreen toast={toast} />}
        {(view === 'settings' || view === 'setup') && (
          <SettingsView
            firstRun={view === 'setup'}
            onSaved={async () => {
              const config = getConfig();
              const has = Boolean(config.url);
              setConfigured(has);
              if (has) { setDevices([]); await refresh(); }
              else { setDevices(seedDevices); setSelectedId('main'); }
              setView('home');
            }}
            onDemo={() => { setDevices(seedDevices); setSelectedId('main'); setView('home'); }}
            {...{ setView, toast, apiIssue }}
          />
        )}
      </View>
      {showNav && (
        <View style={s.bottomNav}>
          {navItems.map(([id, Glyph, label]) => (
            <Pressable key={id} style={s.navItem} onPress={() => setView(id)}>
              <Glyph size={21} color={view === id ? '#ff5665' : '#777f8c'} />
              <Text style={[s.navLabel, view === id && { color: '#ff5665' }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Modal visible={confirming && Boolean(wakeDevice)} transparent animationType="slide" onRequestClose={() => setConfirming(false)}>
        <Pressable style={s.modalLayer} onPress={() => setConfirming(false)}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <View style={s.confirmIcon}><Power size={26} color="#ff5866" /></View>
            <Text style={s.sheetTitle}>{wakeDevice?.name} を起動しますか？</Text>
            <Text style={s.sheetBody}>自宅の {hostInfo.name} からMagic Packet（起動信号）を送信し、接続できるようになるまで確認します。</Text>
            <View style={{ alignSelf: 'stretch', gap: 6 }}>
              <PrimaryButton label="Wake and connect" onPress={confirmWake} />
              <Pressable style={s.quietBtn} onPress={() => setConfirming(false)}><Text style={s.quietBtnText}>キャンセル</Text></Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      {toastMessage ? (
        <View style={s.toast} pointerEvents="none">
          <Check size={15} color="#121418" />
          <Text style={s.toastText} numberOfLines={2}>{toastMessage}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function HomeView({ devices, selectedId, setSelectedId, setView, startWake, toast, hostInfo, selected }) {
  const online = selected?.status === 'online';
  return (
    <View style={{ flex: 1 }}>
      <Header title="PiWake" right={<Pressable hitSlop={10} onPress={() => setView('settings')}><Settings size={21} color={colors.text} /></Pressable>} />
      <ScrollView contentContainerStyle={s.body}>
        <HostBar hostInfo={hostInfo} onOpen={() => setView('host')} />
        {selected ? (
          <Card style={[s.stage, online && { borderColor: 'rgba(66,214,138,0.45)' }]}>
            <View style={s.stageHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.overline}>SELECTED DEVICE</Text>
                <Text style={s.stageName}>{selected.name}</Text>
                <StatusPill value={selected.status} />
              </View>
              <DeviceGlyph device={selected} size={40} />
            </View>
            <View style={s.facts}>
              <View style={s.factRow}><Text style={s.factKey}>Tailscale IP</Text><Text style={s.factValue}>{selected.ip || '未設定'}</Text></View>
              <View style={s.factRow}><Text style={s.factKey}>Last seen</Text><Text style={s.factValue}>{deviceLast(selected)}</Text></View>
              <View style={[s.factRow, { borderBottomWidth: 0 }]}><Text style={s.factKey}>Location</Text><Text style={s.factValue}>{selected.location || 'Home'}</Text></View>
            </View>
            <PrimaryButton
              icon={online ? MonitorUp : Power}
              label={online ? 'Open Desktop' : 'Wake and connect'}
              onPress={online ? () => openChromeRemoteDesktop(toast) : () => startWake(selected)}
            />
            <View style={s.actionPair}>
              <Pressable style={s.pairBtn} onPress={() => openSsh(selected, toast)}><Terminal size={16} color={colors.blue} /><Text style={s.pairBtnText}>Open SSH</Text></Pressable>
              <Pressable style={s.pairBtn} onPress={() => openChromeRemoteDesktop(toast)}><ExternalLink size={16} color={colors.blue} /><Text style={s.pairBtnText}>Chrome RDP</Text></Pressable>
            </View>
            <Pressable style={s.textLink} onPress={() => setView('detail')}>
              <Text style={s.textLinkText}>接続方法と設定</Text><ChevronRight size={14} color={colors.muted} />
            </Pressable>
          </Card>
        ) : (
          <Card style={[s.stage, s.center, { paddingVertical: 34 }]}>
            <Text style={s.stageName}>デバイスがありません</Text>
            <Text style={[s.sheetBody, { marginBottom: 16 }]}>最初の管理対象デバイスを追加してください。</Text>
            <View style={{ alignSelf: 'stretch' }}><PrimaryButton icon={Plus} label="Add device" onPress={() => setView('add')} /></View>
          </Card>
        )}
        <SectionLabel>QUICK SWITCH</SectionLabel>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {devices.map(d => (
            <Pressable key={d.id} style={[s.quickDevice, selectedId === d.id && s.quickSelected]} onPress={() => setSelectedId(d.id)}>
              <DeviceGlyph device={d} size={24} />
              <Text style={s.quickName} numberOfLines={1}>{d.name}</Text>
              <StatusPill value={d.status} />
            </Pressable>
          ))}
          <Pressable style={[s.quickDevice, s.center, { gap: 8 }]} onPress={() => setView('add')}>
            <Plus size={22} color={colors.muted} /><Text style={[s.quickName, { color: colors.muted }]}>Add</Text>
          </Pressable>
        </ScrollView>
      </ScrollView>
    </View>
  );
}

function DevicesView({ devices, selectedId, setSelectedId, setView, hostInfo }) {
  return (
    <View style={{ flex: 1 }}>
      <Header title="Devices" right={<Pressable hitSlop={10} onPress={() => setView('add')}><Plus size={22} color={colors.text} /></Pressable>} />
      <ScrollView contentContainerStyle={s.body}>
        <HostBar hostInfo={hostInfo} onOpen={() => setView('host')} />
        <SectionLabel>MANAGED DEVICES · {devices.length}</SectionLabel>
        <Card>
          {devices.map((d, i) => (
            <Pressable key={d.id} style={[s.deviceRow, i < devices.length - 1 && s.rowBorder, selectedId === d.id && { backgroundColor: '#181b20' }]}
              onPress={() => { setSelectedId(d.id); setView('detail'); }}>
              <DeviceGlyph device={d} />
              <View style={{ flex: 1 }}>
                <Text style={s.connTitle}>{d.name}</Text>
                <Text style={s.connDetail}>{d.ip || d.localIp || 'IP未設定'}</Text>
                <StatusPill value={d.status} />
              </View>
              <ChevronRight size={17} color={colors.muted} />
            </Pressable>
          ))}
          {!devices.length && <Text style={s.emptyRow}>まだデバイスがありません</Text>}
        </Card>
        <SecondaryButton icon={Plus} label="Add device" onPress={() => setView('add')} />
      </ScrollView>
    </View>
  );
}

function DetailView({ device, setView, startWake, removeDevice, shutdownDevice, togglePin, toast }) {
  if (!device) return null;
  const address = reachableAddress(device);
  const online = device.status === 'online';
  return (
    <View style={{ flex: 1 }}>
      <Header title={device.name} eyebrow="MANAGED DEVICE" onBack={() => setView('devices')}
        right={<View style={{ flexDirection: 'row', gap: 16 }}>
          <Pressable hitSlop={10} onPress={() => togglePin(device)}><Pin size={19} color={device.pinned ? '#ff6874' : colors.text} /></Pressable>
          <Pressable hitSlop={10} onPress={() => removeDevice(device)}><Trash2 size={19} color={colors.text} /></Pressable>
        </View>} />
      <ScrollView contentContainerStyle={s.body}>
        <View style={s.identity}>
          <DeviceGlyph device={device} size={40} />
          <View>
            <Text style={s.stageName}>{device.name}</Text>
            <StatusPill value={device.status} />
          </View>
        </View>
        {!online && <PrimaryButton icon={Power} label="Wake and connect" onPress={() => startWake(device)} />}
        <SectionLabel>CONNECTION STACK</SectionLabel>
        <Card>
          <ConnectionRow icon={Terminal} title="SSH" detail={`ssh ${device.user || 'pi'}@${address || '—'}`} accent onPress={() => openSsh(device, toast)} />
          <View style={s.divider} />
          <ConnectionRow icon={ExternalLink} title="Chrome Remote Desktop" detail="要・PC側の事前設定" onPress={() => openChromeRemoteDesktop(toast)} />
          <View style={s.divider} />
          <ConnectionRow icon={MonitorUp} title="RDP" detail={address ? `rdp://${address}` : 'Microsoft Remote Desktop'} onPress={() => openRdp(device, toast)} />
        </Card>
        <SectionLabel>DEVICE</SectionLabel>
        <Card style={{ paddingHorizontal: 15 }}>
          <View style={s.factRow}><Text style={s.factKey}>MAC</Text><Text style={s.factValue}>{device.mac}</Text></View>
          <View style={s.factRow}><Text style={s.factKey}>Local IP</Text><Text style={s.factValue}>{device.localIp || '未設定'}</Text></View>
          <View style={s.factRow}><Text style={s.factKey}>Tailscale IP</Text><Text style={s.factValue}>{device.ip || '未設定'}</Text></View>
          <View style={[s.factRow, { borderBottomWidth: 0 }]}><Text style={s.factKey}>Last seen</Text><Text style={s.factValue}>{deviceLast(device)}</Text></View>
        </Card>
        {!isDemo() && <ScheduleSection device={device} toast={toast} />}
        {online && (
          <>
            <SecondaryButton icon={Power} label={`Shut down ${device.name}`} danger onPress={() => shutdownDevice(device)} />
            <Text style={s.dangerNote}>SSH経由でシャットダウンします（PiからのSSH鍵設定が必要）。</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

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
  const add = async () => {
    if (!TIME_PATTERN.test(time.trim())) return Alert.alert('入力エラー', '時刻は 07:30 のような24時間形式で入力してください');
    if (!days.length) return Alert.alert('入力エラー', '曜日を選択してください');
    try {
      await piwakeClient.addSchedule({ deviceId: device.id, time: time.trim(), days });
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
  return (
    <>
      <SectionLabel>SCHEDULED WAKE</SectionLabel>
      <Card>
        {(schedules || []).map((schedule, i) => (
          <View key={schedule.id} style={[s.deviceRow, s.rowBorder]}>
            <CalendarClock size={18} color={colors.muted} />
            <View style={{ flex: 1 }}>
              <Text style={s.connTitle}>{schedule.time}</Text>
              <Text style={s.connDetail}>{schedule.days.map(day => DAY_LABELS[day]).join('・')}曜日</Text>
            </View>
            <Pressable style={[s.scheduleToggle, schedule.enabled && s.scheduleToggleOn]} onPress={() => toggle(schedule)}>
              <Text style={[s.scheduleToggleText, schedule.enabled && { color: colors.green }]}>{schedule.enabled ? 'ON' : 'OFF'}</Text>
            </Pressable>
            <Pressable hitSlop={8} onPress={() => remove(schedule)}><Trash2 size={16} color={colors.muted} /></Pressable>
          </View>
        ))}
        {schedules && !schedules.length && <Text style={s.emptyRow}>スケジュールはまだありません</Text>}
        <View style={s.scheduleForm}>
          <TextInput style={[s.input, { width: 84, textAlign: 'center' }]} value={time} onChangeText={setTime}
            placeholder="07:30" placeholderTextColor={colors.muted} maxLength={5} autoCapitalize="none" />
          <View style={s.dayChips}>
            {DAY_LABELS.map((label, index) => (
              <Pressable key={label} style={[s.dayChip, days.includes(index) && s.dayChipActive]}
                onPress={() => setDays(current => current.includes(index) ? current.filter(d => d !== index) : [...current, index].sort())}>
                <Text style={[s.dayChipText, days.includes(index) && { color: colors.text }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={s.scheduleAdd} onPress={add}><Plus size={15} color="#d9dce2" /><Text style={s.secondaryBtnText}>追加</Text></Pressable>
        </View>
        <Text style={[s.dangerNote, { paddingBottom: 12 }]}>指定した時刻（Piのローカル時刻）に自動でWakeします。</Text>
      </Card>
    </>
  );
}

const wakeSteps = [
  ['起動信号を送信', 'PiからMagic Packet（起動信号）を送信しました。'],
  ['デバイスが応答', '自宅ネットワーク内で起動を確認しています。'],
  ['外部から到達可能', 'Tailscale経由で接続できるか確認しています。'],
  ['リモート接続の準備完了', 'SSHとデスクトップ接続が利用できます。'],
];

function WakeProgress({ device, step, wakeFailed, cancelWake, finishWake }) {
  return (
    <View style={{ flex: 1 }}>
      <Header title={`Waking ${device?.name || ''}`} onBack={cancelWake} />
      <ScrollView contentContainerStyle={s.body}>
        <Text style={s.pageLead}>
          {wakeFailed
            ? 'PCが起動しませんでした。電源ケーブルと、PC側のWake-on-LAN（遠隔起動）設定を確認してください。'
            : '起動には1〜2分かかることがあります。'}
        </Text>
        <Card style={{ padding: 22 }}>
          {wakeSteps.map(([title, detail], i) => {
            const state = i < step ? 'done' : i === step ? 'current' : 'pending';
            const color = state === 'done' ? colors.green : state === 'current' ? colors.blue : '#4d5560';
            return (
              <View key={title} style={[s.progressStep, i === wakeSteps.length - 1 && { minHeight: 52 }]}>
                <View style={[s.stepDot, { borderColor: color }]}>
                  {state === 'done' ? <Check size={15} color={colors.green} /> : <Text style={[s.stepNum, { color }]}>{i + 1}</Text>}
                </View>
                <View style={{ flex: 1, paddingTop: 4 }}>
                  <Text style={[s.stepTitle, { color: state === 'pending' ? '#6e7682' : colors.text }]}>{title}</Text>
                  <Text style={s.stepDetail}>{detail}</Text>
                </View>
              </View>
            );
          })}
        </Card>
        <Card style={s.progressDevice}>
          <DeviceGlyph device={device} />
          <View style={{ flex: 1 }}>
            <Text style={s.connTitle}>{device?.name}</Text>
            <Text style={s.connDetail}>{device?.ip || device?.localIp}</Text>
          </View>
          <StatusPill value={step >= 4 ? 'online' : 'asleep'} label={step >= 4 ? 'Ready' : wakeFailed ? 'Failed' : 'Preparing'} />
        </Card>
        {step >= 4 ? (
          <>
            <PrimaryButton icon={MonitorUp} label="Open Desktop" onPress={() => finishWake('desktop')} />
            <SecondaryButton icon={Terminal} label="Open SSH" onPress={() => finishWake('ssh')} />
          </>
        ) : (
          <SecondaryButton danger label={wakeFailed ? '戻る' : 'キャンセル'} onPress={cancelWake} />
        )}
      </ScrollView>
    </View>
  );
}

function AddDeviceView({ setView, addDevice, toast }) {
  const [tab, setTab] = useState('scan');
  const [scanning, setScanning] = useState(true);
  const [found, setFound] = useState(isDemo() ? demoDiscovered : []);
  const [showHelp, setShowHelp] = useState(false);
  const runScan = useCallback(async () => {
    setScanning(true);
    if (isDemo()) {
      setTimeout(() => setScanning(false), 1200);
      return;
    }
    try {
      const neighbours = await piwakeClient.scanNetwork();
      setFound((neighbours || []).filter(entry => !entry.managed).map(entry => ({ name: entry.name || entry.ip, ip: entry.ip, mac: entry.mac })));
    } catch { toast('ネットワークスキャンに失敗しました'); }
    finally { setScanning(false); }
  }, [toast]);
  useEffect(() => { runScan(); }, [runScan]);
  return (
    <View style={{ flex: 1 }}>
      <Header title="Add device" onBack={() => setView('devices')} />
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <View style={s.segmented}>
          <Pressable style={[s.segment, tab === 'scan' && s.segmentActive]} onPress={() => setTab('scan')}>
            <Search size={15} color={tab === 'scan' ? colors.text : colors.muted} /><Text style={[s.segmentText, tab === 'scan' && { color: colors.text }]}>Find on network</Text>
          </Pressable>
          <Pressable style={[s.segment, tab === 'manual' && s.segmentActive]} onPress={() => setTab('manual')}>
            <SlidersHorizontal size={15} color={tab === 'manual' ? colors.text : colors.muted} /><Text style={[s.segmentText, tab === 'manual' && { color: colors.text }]}>Manual</Text>
          </Pressable>
        </View>
        {tab === 'scan' ? (
          <>
            <Card style={s.scanPanel}>
              <View style={s.radar}>{scanning ? <ActivityIndicator color="#ff5b68" /> : <Radio size={24} color="#ff5b68" />}</View>
              <View style={{ flex: 1 }}>
                <Text style={s.connTitle}>{scanning ? 'ネットワークをスキャン中' : `${found.length} 台見つかりました`}</Text>
                <Text style={s.connDetail}>{scanning ? '起動中のデバイスを探しています。' : '起動したいPCを選んで追加してください。'}</Text>
              </View>
              <Pressable hitSlop={10} onPress={runScan}><RefreshCw size={17} color={colors.text} /></Pressable>
            </Card>
            <SectionLabel>DISCOVERED DEVICES</SectionLabel>
            <Card>
              {found.map((d, i) => (
                <View key={d.mac} style={[s.deviceRow, i < found.length - 1 && s.rowBorder]}>
                  <DeviceGlyph device={d} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.connTitle}>{d.name}</Text>
                    <Text style={s.connDetail}>{d.ip} · {d.mac}</Text>
                  </View>
                  <Pressable hitSlop={8} onPress={() => addDevice({ name: d.name, localIp: d.ip, mac: d.mac, kind: d.kind || 'pc' })}>
                    <Text style={s.addLink}>Add</Text>
                  </Pressable>
                </View>
              ))}
              {!found.length && !scanning && <Text style={s.emptyRow}>デバイスが見つかりませんでした</Text>}
            </Card>
            <Pressable style={s.helpRow} onPress={() => setShowHelp(true)}>
              <CircleHelp size={20} color={colors.muted} />
              <View style={{ flex: 1 }}>
                <Text style={s.connTitle}>デバイスが見つからない？</Text>
                <Text style={s.connDetail}>電源・ネットワーク・WOL設定のチェックリスト</Text>
              </View>
              <ChevronRight size={16} color={colors.muted} />
            </Pressable>
          </>
        ) : (
          <ManualForm addDevice={addDevice} />
        )}
      </ScrollView>
      <Modal visible={showHelp} transparent animationType="slide" onRequestClose={() => setShowHelp(false)}>
        <Pressable style={s.modalLayer} onPress={() => setShowHelp(false)}>
          <Pressable style={[s.sheet, { alignItems: 'stretch' }]} onPress={() => {}}>
            <View style={[s.confirmIcon, { alignSelf: 'center' }]}><CircleHelp size={26} color="#ff5866" /></View>
            <Text style={s.sheetTitle}>デバイスが見つからないときは</Text>
            {[
              ['スキャンは起動中のデバイスだけを検出します', '一度PCの電源を手で入れた状態で再スキャンしてください。'],
              ['PiとPCが同じルーターにつながっているか', '有線LAN接続を推奨。Wi-FiはWOL非対応の機種が多いです。'],
              ['PC側でWake-on-LAN（遠隔起動）を有効化', 'BIOS/UEFIで「Wake on LAN」をオン。Windowsはデバイスマネージャーの電源管理でMagic Packetを許可し、高速スタートアップをオフに。'],
              ['それでも見つからない場合は手動追加', 'MACアドレスは 設定 → ネットワーク → ハードウェアのプロパティ の「物理アドレス」に載っています。'],
            ].map(([title, detail], i) => (
              <View key={title} style={s.helpStep}>
                <View style={s.helpNum}><Text style={s.helpNumText}>{i + 1}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.stepTitle}>{title}</Text>
                  <Text style={s.stepDetail}>{detail}</Text>
                </View>
              </View>
            ))}
            <PrimaryButton label="閉じる" onPress={() => setShowHelp(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function ManualForm({ addDevice }) {
  const [name, setName] = useState('New PC');
  const [localIp, setLocalIp] = useState('192.168.1.');
  const [tailscaleIp, setTailscaleIp] = useState('');
  const [mac, setMac] = useState('');
  const [user, setUser] = useState('');
  const submit = () => {
    if (!name.trim()) return Alert.alert('入力エラー', 'デバイス名を入力してください');
    if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(localIp.trim())) return Alert.alert('入力エラー', 'ローカルIPは 192.168.1.20 の形式で入力してください');
    if (!/^([0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}$/.test(mac.trim())) return Alert.alert('入力エラー', 'MACアドレスは AA:BB:CC:DD:EE:FF の形式で入力してください');
    addDevice({ name: name.trim(), localIp: localIp.trim(), ip: tailscaleIp.trim() || null, mac: mac.trim().toUpperCase(), user: user.trim() || null, kind: 'pc' });
  };
  return (
    <Card style={{ padding: 18, gap: 14 }}>
      <View>
        <Text style={s.fieldLabel}>デバイス名</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} maxLength={48} placeholderTextColor={colors.muted} />
      </View>
      <View>
        <Text style={s.fieldLabel}>ローカルIP</Text>
        <TextInput style={s.input} value={localIp} onChangeText={setLocalIp} keyboardType="decimal-pad" placeholderTextColor={colors.muted} />
        <Text style={s.fieldHint}>PCの「ネットワークのプロパティ」に載っている 192.168.x.x のアドレス</Text>
      </View>
      <View>
        <Text style={s.fieldLabel}>MACアドレス</Text>
        <TextInput style={s.input} value={mac} onChangeText={setMac} autoCapitalize="characters" placeholder="AA:BB:CC:DD:EE:FF" placeholderTextColor={colors.muted} />
        <Text style={s.fieldHint}>Windows: 設定 → ネットワーク → ハードウェアのプロパティ「物理アドレス (MAC)」</Text>
      </View>
      <View>
        <Text style={s.fieldLabel}>Tailscale IP（任意）</Text>
        <TextInput style={s.input} value={tailscaleIp} onChangeText={setTailscaleIp} keyboardType="decimal-pad" placeholder="100.x.y.z" placeholderTextColor={colors.muted} />
      </View>
      <View>
        <Text style={s.fieldLabel}>SSHユーザー名（任意・既定は pi）</Text>
        <TextInput style={s.input} value={user} onChangeText={setUser} autoCapitalize="none" placeholder="pi" placeholderTextColor={colors.muted} />
      </View>
      <PrimaryButton label="追加する" onPress={submit} />
    </Card>
  );
}

function HostDetail({ setView, toast, hostInfo, shutdownHost }) {
  const online = hostInfo.tailscaleOnline !== false;
  return (
    <View style={{ flex: 1 }}>
      <Header title="Raspberry Pi host" onBack={() => setView('home')} />
      <ScrollView contentContainerStyle={s.body}>
        <View style={s.identity}>
          <View style={[s.hostMark, { width: 56, height: 56, borderRadius: 20 }]}><Cpu size={32} color="#ff5b68" /></View>
          <View>
            <Text style={s.stageName}>{hostInfo.name}</Text>
            <StatusPill value={online ? 'online' : 'offline'} label={online ? 'Tailscale connected' : 'Tailscale offline'} />
          </View>
        </View>
        <Card style={s.metrics}>
          <View style={s.metric}><Thermometer size={16} color={colors.muted} /><Text style={s.metricValue}>{hostInfo.tempC != null ? `${hostInfo.tempC}°` : '—'}</Text><Text style={s.metricLabel}>CPU temp</Text></View>
          <View style={[s.metric, s.metricBorder]}><Gauge size={16} color={colors.muted} /><Text style={s.metricValue}>{hostInfo.load1 != null ? String(hostInfo.load1) : '—'}</Text><Text style={s.metricLabel}>Load avg</Text></View>
          <View style={s.metric}><Clock3 size={16} color={colors.muted} /><Text style={s.metricValue}>{formatUptime(hostInfo.uptimeSeconds)}</Text><Text style={s.metricLabel}>Uptime</Text></View>
        </Card>
        <SectionLabel>CONNECT TO THIS PI</SectionLabel>
        <Card>
          <ConnectionRow icon={Terminal} title="SSH" detail={`ssh pi@${hostInfo.tailscaleIp || hostInfo.name}`} accent onPress={() => openSsh({ user: 'pi', ip: hostInfo.tailscaleIp || hostInfo.name }, toast)} />
          <View style={s.divider} />
          <ConnectionRow icon={MonitorUp} title="Desktop" detail="Chrome Remote Desktop" onPress={() => openChromeRemoteDesktop(toast)} />
          <View style={s.divider} />
          <ConnectionRow icon={Globe2} title="PiWake Web" detail="ブラウザ版コンソールを開く" onPress={async () => {
            const config = getConfig();
            if (config.url) { try { await Linking.openURL(config.url); } catch { toast('開けませんでした'); } }
            else toast('API URLが未設定です');
          }} />
        </Card>
        <SecondaryButton icon={Power} label="Shut down Raspberry Pi" danger onPress={shutdownHost} />
        <Text style={s.dangerNote}>停止すると、すべてのWake-on-LANとリモート接続が使えなくなります。</Text>
      </ScrollView>
    </View>
  );
}

function ActivityScreen({ toast }) {
  const [logs, setLogs] = useState(null);
  useEffect(() => {
    if (isDemo()) { setLogs(demoActivity); return; }
    let cancelled = false;
    piwakeClient.getActivity()
      .then(entries => { if (!cancelled) setLogs(entries || []); })
      .catch(() => { if (!cancelled) { setLogs([]); toast('履歴を取得できませんでした'); } });
    return () => { cancelled = true; };
  }, [toast]);
  const glyphFor = action => {
    if (/packet|wake|shutdown/i.test(action)) return Power;
    if (/ssh/i.test(action)) return Terminal;
    if (/desktop/i.test(action)) return MonitorUp;
    if (/added/i.test(action)) return Plus;
    return Activity;
  };
  return (
    <View style={{ flex: 1 }}>
      <Header title="Activity" />
      <ScrollView contentContainerStyle={s.body}>
        <Text style={s.pageLead}>Recent activity across your tailnet.</Text>
        {(logs || []).map(entry => {
          const Glyph = glyphFor(entry.action);
          const tint = entry.result === 'success' ? colors.green : entry.result === 'warning' ? colors.amber : colors.muted;
          return (
            <View key={entry.id} style={s.timelineRow}>
              <View style={s.timelineIcon}><Glyph size={17} color={tint} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.connTitle}>{entry.action}</Text>
                <Text style={s.connDetail}>{entry.deviceName} · {entry.time || formatActivityTime(entry.at)}</Text>
              </View>
            </View>
          );
        })}
        {logs && !logs.length && <Text style={s.emptyRow}>まだ履歴がありません</Text>}
      </ScrollView>
    </View>
  );
}

function SettingsView({ firstRun, onSaved, onDemo, setView, toast, apiIssue }) {
  const config = getConfig();
  const [url, setUrl] = useState(config.url);
  const [token, setToken] = useState(config.token);
  const [checking, setChecking] = useState(false);
  const save = async () => {
    const trimmed = url.trim();
    if (trimmed && !/^https?:\/\//.test(trimmed)) {
      return Alert.alert('入力エラー', 'URLは http:// から始まる形式で入力してください（例: http://100.100.1.1:8787）');
    }
    setChecking(true);
    await saveConfig({ url: trimmed, token });
    if (trimmed) {
      try {
        const health = await piwakeClient.checkHealth();
        toast(health.authRequired && !token.trim() ? '接続OK。ただしAPIトークンが必要です' : 'PiWake APIに接続しました');
      } catch (error) {
        toast(error.status === 401 ? 'APIトークンが正しくありません' : 'APIへ接続できませんでした。URLを確認してください');
      }
    } else {
      toast('デモモードに切り替えました');
    }
    setChecking(false);
    onSaved();
  };
  return (
    <View style={{ flex: 1 }}>
      <Header title={firstRun ? 'Welcome to PiWake' : 'Settings'} onBack={firstRun ? undefined : () => setView('home')} />
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <View style={[s.center, { paddingVertical: 18, gap: 10 }]}>
          <ShieldCheck size={30} color={colors.green} />
          <Text style={s.stageName}>Tailscale-first</Text>
          <Text style={[s.sheetBody, { marginBottom: 0 }]}>
            {firstRun
              ? 'このスマホにTailscaleアプリを入れて、Piと同じアカウントでログインしてから、Piのアドレスをここに入力してください。'
              : 'PiWakeは公開ポートを使わず、あなたのtailnet内だけで通信します。'}
          </Text>
        </View>
        <SectionLabel>PIWAKE API</SectionLabel>
        <Card style={{ padding: 18, gap: 14 }}>
          <View>
            <Text style={s.fieldLabel}>API URL</Text>
            <TextInput style={s.input} value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false}
              keyboardType="url" placeholder="http://100.100.1.1:8787" placeholderTextColor={colors.muted} />
            <Text style={s.fieldHint}>PiのTailscale IP（Tailscaleアプリの機器一覧でPiをタップすると表示される 100. で始まるアドレス）+ ポート8787</Text>
          </View>
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 }}>
              <KeyRound size={12} color={colors.muted} /><Text style={[s.fieldLabel, { marginBottom: 0 }]}>APIトークン（合言葉・任意）</Text>
            </View>
            <TextInput style={s.input} value={token} onChangeText={setToken} secureTextEntry autoCapitalize="none"
              placeholder="未設定（Tailscale ACLで保護）" placeholderTextColor={colors.muted} />
            <Text style={s.fieldHint}>Piをセットアップした人が決めた PIWAKE_TOKEN の値。わからない場合は設定した人に確認してください。</Text>
          </View>
          <PrimaryButton label={checking ? '確認中…' : '保存して接続'} onPress={checking ? () => {} : save} />
        </Card>
        {firstRun && (
          <Pressable style={s.quietBtn} onPress={onDemo}>
            <Text style={s.quietBtnText}>あとで設定する（デモで試す）</Text>
          </Pressable>
        )}
        {!firstRun && apiIssue ? <Text style={[s.dangerNote, { marginTop: 14 }]}>{apiIssue}</Text> : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.75 },
  header: { height: 64, flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 20, paddingBottom: 12 },
  headerSide: { minWidth: 44, justifyContent: 'flex-end' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerEyebrow: { color: colors.muted, fontSize: 10, letterSpacing: 1.4, marginBottom: 2 },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  body: { padding: 16, paddingBottom: 40, gap: 12 },
  apiBanner: { marginHorizontal: 16, marginTop: 8, borderWidth: 1, borderColor: 'rgba(244,184,74,0.5)', backgroundColor: 'rgba(244,184,74,0.08)', borderRadius: 13, paddingVertical: 9, paddingHorizontal: 13 },
  apiBannerText: { color: colors.amber, fontSize: 12, fontWeight: '600' },
  hostBar: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, borderRadius: 20, padding: 13 },
  hostMark: { width: 38, height: 38, borderRadius: 13, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  hostName: { color: colors.text, fontSize: 14, fontWeight: '700', marginBottom: 2 },
  hostMeta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  hostMetaText: { color: colors.muted, fontSize: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusLabel: { fontSize: 11, fontWeight: '500' },
  card: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, borderRadius: 20, overflow: 'hidden' },
  stage: { borderColor: '#353b45', padding: 18 },
  stageHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  overline: { color: '#ff6874', fontSize: 10, fontWeight: '700', letterSpacing: 1.3, marginBottom: 5 },
  stageName: { color: colors.text, fontSize: 26, fontWeight: '700', letterSpacing: -0.5, marginBottom: 3 },
  facts: { borderTopWidth: 1, borderTopColor: colors.line, marginBottom: 14 },
  factRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: 'rgba(41,46,54,0.7)' },
  factKey: { color: colors.muted, fontSize: 12 },
  factValue: { color: '#c6cbd3', fontSize: 12 },
  primaryBtn: { minHeight: 48, borderRadius: 15, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryBtn: { minHeight: 46, borderRadius: 15, borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 2 },
  secondaryDanger: { borderColor: 'rgba(255,69,58,0.55)' },
  secondaryBtnText: { color: '#d9dce2', fontSize: 14, fontWeight: '600' },
  quietBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  quietBtnText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  actionPair: { flexDirection: 'row', gap: 8, marginTop: 8 },
  pairBtn: { flex: 1, height: 44, borderWidth: 1, borderColor: colors.line, backgroundColor: '#12151a', borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  pairBtnText: { color: colors.blue, fontSize: 13, fontWeight: '600' },
  textLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, marginTop: 12 },
  textLinkText: { color: colors.muted, fontSize: 12 },
  sectionLabel: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.3, marginTop: 8, marginBottom: -2, marginLeft: 4 },
  quickDevice: { width: 96, minHeight: 106, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, borderRadius: 18, padding: 11, justifyContent: 'space-between' },
  quickSelected: { borderColor: colors.accent },
  quickName: { color: colors.text, fontSize: 11, fontWeight: '700' },
  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 14, paddingVertical: 12, minHeight: 70 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.line },
  emptyRow: { color: colors.muted, fontSize: 12, textAlign: 'center', paddingVertical: 24 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 15, marginVertical: 8 },
  connRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 62 },
  connIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#20242a', alignItems: 'center', justifyContent: 'center' },
  connTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  connDetail: { color: colors.muted, fontSize: 11, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.line, marginLeft: 14 },
  dangerNote: { color: colors.muted, fontSize: 10, textAlign: 'center', lineHeight: 15, marginTop: 6 },
  pageLead: { color: colors.muted, fontSize: 13, marginHorizontal: 3 },
  progressStep: { flexDirection: 'row', gap: 14, minHeight: 84 },
  stepDot: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  stepNum: { fontSize: 12, fontWeight: '700' },
  stepTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 4 },
  stepDetail: { fontSize: 11, color: colors.muted, lineHeight: 15 },
  progressDevice: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  segmented: { flexDirection: 'row', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 15, padding: 4 },
  segment: { flex: 1, height: 38, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  segmentActive: { backgroundColor: '#252a31' },
  segmentText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  scanPanel: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 15 },
  radar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  addLink: { color: '#ff5b68', fontSize: 14, fontWeight: '700' },
  helpRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 18, padding: 14, marginTop: 4 },
  helpStep: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  helpNum: { width: 24, height: 24, borderRadius: 9, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  helpNumText: { color: '#ff5b68', fontSize: 12, fontWeight: '700' },
  metrics: { flexDirection: 'row' },
  metric: { flex: 1, minHeight: 100, alignItems: 'center', justifyContent: 'center', gap: 5 },
  metricBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.line },
  metricValue: { color: colors.text, fontSize: 20, fontWeight: '700' },
  metricLabel: { color: colors.muted, fontSize: 10 },
  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 68 },
  timelineIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  scheduleToggle: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, minWidth: 46, height: 30, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  scheduleToggleOn: { borderColor: 'rgba(66,214,138,0.5)', backgroundColor: 'rgba(66,214,138,0.08)' },
  scheduleToggleText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  scheduleForm: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: 13 },
  dayChips: { flexDirection: 'row', gap: 4, flex: 1 },
  dayChip: { width: 29, height: 29, borderRadius: 10, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  dayChipActive: { backgroundColor: '#252a31', borderColor: '#465061' },
  dayChipText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  scheduleAdd: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: colors.line, borderRadius: 12, height: 36, paddingHorizontal: 12 },
  fieldLabel: { color: colors.muted, fontSize: 11, marginBottom: 6 },
  fieldHint: { color: '#6d7684', fontSize: 10, lineHeight: 14, marginTop: 5 },
  input: { height: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: '#0f1215', color: colors.text, paddingHorizontal: 13, fontSize: 14 },
  bottomNav: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: 'rgba(17,20,24,0.96)', paddingVertical: 8 },
  navItem: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 4 },
  navLabel: { color: '#777f8c', fontSize: 10 },
  modalLayer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.68)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#171a1f', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: '#383e48', padding: 24, paddingBottom: 34, alignItems: 'center' },
  confirmIcon: { width: 56, height: 56, borderRadius: 19, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  sheetTitle: { color: colors.text, fontSize: 21, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  sheetBody: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginBottom: 18 },
  toast: { position: 'absolute', bottom: 96, alignSelf: 'center', maxWidth: '88%', backgroundColor: '#f5f7fa', borderRadius: 13, paddingVertical: 10, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 7 },
  toastText: { color: '#121418', fontSize: 12, fontWeight: '700', flexShrink: 1 },
});
