<p align="center"><img src="docs/logo.png" width="460" alt="PiWake — Wake your home, from anywhere."></p>

<p>
  <img alt="Node.js 18+" src="https://img.shields.io/badge/node-%E2%89%A518-339933?logo=nodedotjs&logoColor=white">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue">
  <img alt="Zero server dependencies" src="https://img.shields.io/badge/server%20deps-zero-f04454">
  <img alt="PWA ready" src="https://img.shields.io/badge/PWA-ready-5a0fc8">
</p>

自宅の Raspberry Pi を Wake-on-LAN の中継ホストにして、外出先から家のデバイスを起動・接続するためのセルフホスト型プロダクトです。Tailscale 前提で、公開ポートは一切開けません。

**English README: [README.en.md](README.en.md)**

| Desktop | Mobile |
| --- | --- |
| ![PiWake desktop](docs/screenshot-desktop.png) | <img src="docs/screenshot-mobile.png" width="260" alt="PiWake mobile"> |

**シンプルモード(`/simple`)** — タブなしでデバイス操作だけを1画面に:

![PiWake simple mode](docs/screenshot-simple.png)

## できること

- **Wake-on-LAN**: Pi から Magic Packet を送信し、ping / SSH・RDP ポートの応答を段階的に確認しながら「起動 → 接続可能」まで追跡。完了時はブラウザ通知
- **スケジュールWake**: 「平日 07:30 に起動」のような曜日+時刻の自動起動(Pi のローカル時刻で実行)
- **ピン留め**: よく使うデバイスを一覧の先頭に固定
- **リモートシャットダウン**: 起動中のPCをSSH経由で停止(Pi からの鍵認証が前提)。Pi 本体の停止も可能
- **デバイス管理**: 追加・削除・状態監視(10秒ごとの自動 ping + SSE でリアルタイム反映)
- **ネットワークスキャン**: Pi の ARP テーブルから LAN 内デバイスを自動検出してワンタップ追加
- **接続導線**: SSH(`ssh -p` 対応・コマンド自動コピー)、Chrome Remote Desktop、RDP、任意の Web URL(NAS 管理画面など)。各接続の**稼働状態をポート死活で表示**
- **接続設定**: SSHユーザー・SSHポート・RDPポート・Web URL をデバイスごとにサーバー側へ保存(Web/モバイルで共有)
- **OSアイコン**: デバイスごとに Windows / macOS / Linux / Raspberry Pi のロゴを設定可能(Font Awesome Brands)
- **フォント設定**: 厳選した8つの日本語 Google Fonts(既定は M PLUS 1)から Settings で切り替え。フォントは埋め込み読み込みでバンドルしない
- **Discord Bot**: `/devices` で**操作パネル**(セレクトメニューでデバイス選択 → ⚡起動 / 📶Ping / 🌙停止ボタン、結果はパネルがその場で更新)。`/wake` `/shutdown` `/status` のスラッシュコマンドも利用可(Gateway接続=外向き通信のみなので公開ポート不要・依存ゼロのまま)
- **シンプルモード**: `/simple` を開くとタブなしの1画面ダッシュボード。全デバイスがカードで並び、起動・Ping・SSH・RDP・停止・詳細ボタンに直接アクセス(複数台の同時Wake進捗、詳細モーダル、デバイス追加も可能)
- **ホスト監視**: CPU 温度・ロードアベレージ・稼働時間・Tailscale 状態
- **PWA**: スマホのホーム画面に追加すればアプリのように起動(Service Workerによるオフラインシェル対応)
- **モバイルUI**: アイコンだけのカプセル型タブバー。選択中の背景は1つのインジケータがEaseOutで移動し、アイコンだけが発光
- **ネイティブアプリ**: React Native (Expo) 製のモバイルアプリを同梱([mobile/](mobile/)。Expo Go で即起動可能)
- **認証**: Tailscale ACL による保護を基本に、オプションで API トークン。DNS リバインディング / CSRF 対策済み

## スマホから使うには(はじめての方向け)

PiWake は「Tailscale」という無料アプリで、外出先からでも自宅のネットワークに安全につながる仕組みを使います。tailnet とは、Tailscale が作ってくれる自分専用の仮想的な家庭内ネットワークのことです。

1. スマホに [Tailscale アプリ](https://tailscale.com/download) をインストール
2. Raspberry Pi を設定したときと**同じアカウント**でログイン
3. ブラウザで `http://<PiのTailscale IP>:8787` を開く
   - Pi の Tailscale IP は、Tailscale アプリの機器一覧で Pi の名前をタップすると表示されます(`100.` で始まるアドレス)
4. 共有 →「ホーム画面に追加」でアプリとして使えます

## 起動したいPC側の準備(Wake-on-LAN の有効化)

Wake-on-LAN は PC 側で事前に有効化しないと動きません。

1. **BIOS/UEFI**: 「Wake on LAN」「Power On By PCI-E」などの項目をオン
2. **Windows**: デバイスマネージャー → ネットワークアダプター → 電源の管理 →「Magic Packet でのみスタンバイ解除」を許可。コントロールパネル → 電源オプションで**高速スタートアップをオフ**
3. **有線LAN 推奨**: Wi-Fi は Wake-on-LAN 非対応の機種が多いです

デスクトップ接続を使う場合は、PC 側で [Chrome Remote Desktop](https://remotedesktop.google.com/access) の事前設定も済ませておいてください。

## Raspberry Pi へのセットアップ

必要環境: Raspberry Pi OS(または任意の Linux)、Node.js 18+、Tailscale

```bash
git clone https://github.com/nisesimadao/PiWake.git
cd PiWake
bash deploy/install.sh
```

インストーラーが以下を行います:

1. `npm ci` と Web コンソールのビルド
2. `/etc/default/piwake` に設定ファイルを作成(既存なら保持)
3. systemd サービス `piwake` を登録して起動(データは `/var/lib/piwake` に保存)

完了後、tailnet 内の端末から `http://<PiのTailscale IP>:8787` を開くだけで使えます。

### 設定(`/etc/default/piwake`)

| 変数 | 既定値 | 説明 |
| --- | --- | --- |
| `PIWAKE_PORT` | `8787` | API / Web コンソールのポート |
| `PIWAKE_TOKEN` | (空) | API トークン(推奨。`openssl rand -hex 16` で生成し、Web コンソールの Settings にも同じ値を入力) |
| `PIWAKE_BROADCAST` | `255.255.255.255` | Magic Packet のブロードキャスト先(例: `192.168.1.255`) |
| `PIWAKE_WAKE_TIMEOUT` | `90` | Wake 完了を待つ秒数 |
| `PIWAKE_STATUS_INTERVAL` | `10` | デバイス状態を ping で確認する間隔(秒) |
| `PIWAKE_ALLOWED_HOSTS` | (空) | 追加で許可する Host ヘッダ(カンマ区切り)。IP・自ホスト名・MagicDNS は自動許可 |

変更後は `sudo systemctl restart piwake`。ログは `journalctl -u piwake -f`。

### Discord Bot(任意)

DiscordのスラッシュコマンドでPiWakeを操作できます。BotはPiから**外向きにGateway接続**するため、公開ポートは不要です(Node.js 22+ が必要。未満なら自動で無効化されます)。

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリを作成し、**Bot** を追加して Token を取得
2. OAuth2 → URL Generator で scope に `bot` と `applications.commands` を選び、生成されたURLで自分のサーバーに招待(Bot権限は不要=0でOK)
3. `/etc/default/piwake` に設定して再起動:

```bash
PIWAKE_DISCORD_TOKEN=<Botのトークン>
PIWAKE_DISCORD_APP_ID=<Application ID>
PIWAKE_DISCORD_GUILD=<サーバーID>            # 任意: コマンドが即時反映される
PIWAKE_DISCORD_ALLOWED_USERS=<自分のユーザーID> # 任意: 操作を許可するユーザーを制限
```

| コマンド | 動作 |
| --- | --- |
| `/devices` | **操作パネル**を表示。セレクトメニューでデバイスを選ぶと ⚡起動 / 📶Ping / 🌙停止 ボタン付きの詳細パネルに切り替わり、結果はパネルがその場で更新される |
| `/status` | ホストの温度・負荷・稼働時間・Tailscale状態(Embed表示) |
| `/wake device:<名前>` | Magic Packet送信 → 起動完了までパネルを更新して追跡 |
| `/shutdown device:<名前>` | SSH経由でシャットダウン |

デバイス名はオートコンプリートされます。`PIWAKE_DISCORD_ALLOWED_USERS` 未設定の場合、Botがいるサーバーの全員が操作できる点に注意してください。

### リモートシャットダウンを使う場合

- **管理対象PC**: Pi から鍵認証で SSH できるようにしておく(`ssh-copy-id user@pc`)。Linux は `sudo shutdown` をパスワードなしで実行できること
- **Pi 本体の停止**: サービス実行ユーザーに sudoers で許可を追加
  `pi ALL=(root) NOPASSWD: /usr/sbin/shutdown`

### セキュリティ

- ポートは公開しない前提です。アクセス制御は Tailscale ACL / Grants で行ってください(誰がアクセスできるかは Tailscale の共有設定で決まります)
- 追加の保護として `PIWAKE_TOKEN` の設定を推奨します
- Host ヘッダ検証(DNS リバインディング対策)と Content-Type 検証(CSRF 対策)は組み込み済みです

## 開発

```bash
npm install
npm run dev        # デモモード(APIなしで全画面を確認できる)
```

実 API に接続して開発する場合:

```bash
cp .env.example .env.local
# PIWAKE_PROXY_TARGET を Pi の Tailscale URL に変更
npm run dev
```

ローカルで API サーバーごと動かす場合:

```bash
npm run server     # API のみ(http://localhost:8787)
npm start          # ビルド + API + Web コンソール配信
```

本番ビルドは既定で**同一オリジンの API** に接続します。デモモードは `npm run dev`(API URL 未設定時)か、`VITE_PIWAKE_MODE=demo` を指定したときのみ有効です。`VITE_*` はブラウザへ埋め込まれる公開設定です。秘密情報は設定しないでください。

## API

フロントエンドの通信は `src/services/piwakeClient.js` に集約されています。

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | 疎通確認(認証不要。`authRequired` を返す) |
| `GET` | `/api/events` | SSE ストリーム(デバイス状態・Wake ジョブの更新) |
| `GET` | `/api/host` | ホストのメトリクス(温度・ロード・稼働時間・Tailscale) |
| `POST` | `/api/host/shutdown` | Pi 本体を停止 |
| `GET` | `/api/devices` | デバイス一覧(ping による状態つき) |
| `POST` | `/api/devices` | デバイス追加 |
| `PATCH` | `/api/devices/:id` | デバイス更新 |
| `DELETE` | `/api/devices/:id` | デバイス削除 |
| `POST` | `/api/devices/:id/wake` | Magic Packet 送信 + Wake ジョブ開始 |
| `POST` | `/api/devices/:id/shutdown` | SSH 経由でシャットダウン(カスタムポート対応) |
| `GET` | `/api/devices/:id/ping` | その場でping確認(結果に応じて状態も更新) |
| `GET` | `/api/devices/:id/services` | SSH / RDP / Web の稼働状態をポート死活で確認 |
| `GET` | `/api/jobs/:id` | Wake ジョブの進捗(`packet_sent` → `responding` → `reachable` → `ready`) |
| `DELETE` | `/api/jobs/:id` | Wake ジョブのキャンセル |
| `GET` / `POST` | `/api/schedules` | スケジュールWake の一覧 / 追加(`{deviceId, time: "07:30", days: [1,2,3,4,5]}`) |
| `PATCH` / `DELETE` | `/api/schedules/:id` | スケジュールの更新(有効/無効・時刻・曜日)/ 削除 |
| `GET` | `/api/activity` | 操作履歴(直近50件) |
| `GET` | `/api/scan` | ARP テーブルからの LAN スキャン |

## 技術構成

- サーバー: Node.js 標準ライブラリのみ(http / dgram / net / child_process)— npm 依存ゼロ
- フロントエンド: React + Vite + Lucide React + Google Fonts(M PLUS 1 ほか8書体、実行時埋め込み)
- デプロイ: systemd(`deploy/install.sh`)

## モバイルアプリ(React Native / Expo)

`mobile/` に Expo 製のネイティブアプリがあります。Web 版と同じ画面構成で、API URL とトークンをアプリ内で設定して使います。

```bash
cd mobile
npm install
npx expo start   # Expo Go でQRコードを読み取って起動
```

詳細は [mobile/README.md](mobile/README.md) を参照してください。

## テスト

```bash
npm test   # node:test によるユニット + API統合テスト(依存ゼロ)
```

## 今後の拡張候補

- Web Push / モバイルプッシュによるバックグラウンド通知
- EAS Build によるストア配布

## License

[MIT](LICENSE)
