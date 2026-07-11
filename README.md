# PiWake

Tailscale を前提に、自宅の Raspberry Pi と複数デバイスを外出先から操作するための UI プロトタイプです。

Raspberry Pi を Wake-on-LAN の中継ホストとして扱いながら、ホスト自身への SSH・デスクトップ接続、管理対象 PC への Wake、SSH、Chrome Remote Desktop への導線をひとつにまとめています。

## 主な画面と操作

- Home: 選択中デバイスの状態確認、Wake & Connect、SSH、Chrome Remote Desktop
- Devices: Raspberry Pi ホストと複数の管理対象デバイス
- Add device: LAN 内の自動検出と手動追加
- Raspberry Pi host: SSH、Desktop、PiWake Web、サービス状態
- Wake flow: 確認、Magic Packet 送信、起動待機、接続開始
- Activity / Settings: 操作履歴と接続方式の設定
- Responsive UI: デスクトップはサイドバー、モバイルは操作優先のボトムナビ

## デザイン方針

- モバイルではコンセプトコピーを省き、選択中デバイスをファーストビューに配置
- デスクトップではサイドバーのコンセプトコピーを残し、プロダクトの世界観を補強
- Lucide の統一アイコンセットを使用
- squircle 対応ブラウザでは `corner-shape: squircle`、非対応環境では同系統の角丸へフォールバック
- Apple HIG を意識した階層、タップ領域、状態表示と、Rounder に着想を得た編集的な余白設計

## 開発

必要環境: Node.js 18 以降

```bash
npm install
npm run dev
```

本番ビルド:

```bash
npm run build
npm run preview
```

## 技術構成

- React
- Vite
- Lucide React
- Noto Sans JP

## デモモードとAPIモード

環境変数を設定しない場合はデモアダプターで動作します。追加したデバイスと選択状態は、バージョン付きの `localStorage` データとして保持されます。

実際の Raspberry Pi API に接続する場合:

```bash
cp .env.example .env.local
npm run dev
```

`.env.local` の例:

```dotenv
VITE_PIWAKE_API_URL=/piwake-api
PIWAKE_PROXY_TARGET=http://100.100.1.1:8787
```

`VITE_*` はブラウザへ埋め込まれる公開設定です。APIキーやTailscaleの認証情報など、秘密情報は設定しないでください。認証は Raspberry Pi 側のAPI、またはTailscaleのアクセス制御で処理します。

## API境界

フロントエンドは `src/services/piwakeClient.js` に通信を集約しています。現在準備している最小APIは以下です。

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | ホストとAPIの疎通確認 |
| `POST` | `/api/devices` | 管理対象デバイスを追加 |
| `POST` | `/api/devices/:id/wake` | Wakeジョブを開始 |

次の実装段階では、Wakeジョブの状態取得、デバイス一覧、アクティビティ履歴、接続URLの安全な払い出しを追加します。

## 実用化チェックリスト

- Raspberry Pi 上に認証付きAPIサービスを実装
- Magic Packet送信後のオンライン判定とタイムアウトをサーバー側へ移動
- Tailscale ACL / Grantsで利用者とホストを限定
- SSH・RDP・Chrome Remote DesktopのURLスキームを端末別に検証
- APIエラー、再試行、キャンセル、バックグラウンド復帰を実機で検証
- React Native / Expo と共有するデータ型・APIクライアントをパッケージ化

## 現在の位置づけ

このリポジトリは、実APIへ差し替え可能なフロントエンドプロトタイプです。Tailscale、Wake-on-LAN、SSH、Chrome Remote Desktop との実接続処理は Raspberry Pi 側のAPI実装後に有効化します。

将来的には、同じ情報設計を React Native / Expo のネイティブアプリと Web で共有する想定です。
