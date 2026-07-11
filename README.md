# PiWake

自宅の Raspberry Pi を Wake-on-LAN の中継ホストにして、外出先から家のデバイスを起動・接続するためのセルフホスト型プロダクトです。Tailscale 前提で、公開ポートは一切開けません。

Raspberry Pi 上で動く API サーバー(依存ゼロの Node.js 製)と、その Pi 自身が配信する Web コンソール(React)で構成されています。

## できること

- **Wake-on-LAN**: Pi から Magic Packet を送信し、ping / SSH・RDP ポートの応答を段階的に確認しながら起動完了まで追跡
- **デバイス管理**: 追加・削除・状態監視(30秒ごとの自動 ping)。データは Pi 上の `~/.piwake/` に永続化
- **ネットワークスキャン**: Pi の ARP テーブルから LAN 内デバイスを自動検出してワンタップ追加
- **接続導線**: SSH(`ssh://`)、Chrome Remote Desktop、RDP への起動リンク
- **ホスト監視**: CPU 温度・負荷・稼働時間・Tailscale 状態
- **アクティビティ履歴**: Wake の成功・タイムアウト、デバイス追加などを記録
- **認証**: Tailscale ACL による保護を基本に、オプションで Bearer トークン(`PIWAKE_TOKEN`)

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
3. systemd サービス `piwake` を登録して起動

完了後、tailnet 内の端末から `http://<PiのTailscale IP>:8787` を開くだけで使えます。

### 設定(`/etc/default/piwake`)

| 変数 | 既定値 | 説明 |
| --- | --- | --- |
| `PIWAKE_PORT` | `8787` | API / Web コンソールのポート |
| `PIWAKE_TOKEN` | (空) | 設定すると API に Bearer トークン認証を要求 |
| `PIWAKE_BROADCAST` | `255.255.255.255` | Magic Packet のブロードキャスト先(例: `192.168.1.255`) |
| `PIWAKE_WAKE_TIMEOUT` | `90` | Wake 完了を待つ秒数 |

変更後は `sudo systemctl restart piwake`。ログは `journalctl -u piwake -f`。

### セキュリティ

- ポートは公開しない前提です。アクセス制御は Tailscale ACL / Grants で行ってください
- 追加の保護が必要なら `PIWAKE_TOKEN` を設定し、Web コンソールの Settings → API token に同じ値を入力します(トークンはブラウザの localStorage に保存されます)

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

`VITE_*` はブラウザへ埋め込まれる公開設定です。秘密情報は設定しないでください。

## API

フロントエンドの通信は `src/services/piwakeClient.js` に集約されています。

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | 疎通確認(認証不要。`authRequired` を返す) |
| `GET` | `/api/host` | ホストのメトリクス(温度・CPU・稼働時間・Tailscale) |
| `GET` | `/api/devices` | デバイス一覧(ping による状態つき) |
| `POST` | `/api/devices` | デバイス追加 |
| `PATCH` | `/api/devices/:id` | デバイス更新 |
| `DELETE` | `/api/devices/:id` | デバイス削除 |
| `POST` | `/api/devices/:id/wake` | Magic Packet 送信 + Wake ジョブ開始 |
| `GET` | `/api/jobs/:id` | Wake ジョブの進捗(`packet_sent` → `responding` → `reachable` → `ready`) |
| `DELETE` | `/api/jobs/:id` | Wake ジョブのキャンセル |
| `GET` | `/api/activity` | 操作履歴(直近50件) |
| `GET` | `/api/scan` | ARP テーブルからの LAN スキャン |

## デモモード

環境変数を設定せずに `npm run dev` すると、ネットワーク通信なしのデモアダプターで動作します。UI の確認やデザイン調整はこのモードで完結します。

## 技術構成

- サーバー: Node.js 標準ライブラリのみ(http / dgram / net / child_process)
- フロントエンド: React + Vite + Lucide React + Noto Sans JP
- デプロイ: systemd(`deploy/install.sh`)

## 今後の拡張候補

- Wake スケジュール / 自動化
- デバイスごとの接続スタック設定の永続化
- React Native / Expo とのデータ型・API クライアント共有
- ホストのシャットダウン・再起動操作(確認ダイアログつき)
