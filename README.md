# PiWake UI Prototype

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

## 現在の位置づけ

このリポジトリはフロントエンドの操作・画面遷移を確認するモックです。Tailscale、Wake-on-LAN、SSH、Chrome Remote Desktop との実接続処理は未実装です。

将来的には、同じ情報設計を React Native / Expo のネイティブアプリと Web で共有する想定です。
