# PiWake Mobile

PiWake の React Native (Expo) アプリです。Web コンソールと同じ情報設計・デザインで、スマホからネイティブに Wake-on-LAN・リモート接続・シャットダウンを操作できます。

## 使い方(開発・Expo Go)

```bash
cd mobile
npm install
npx expo start
```

表示された QR コードをスマホの [Expo Go](https://expo.dev/go) で読み取ると起動します。

初回起動時に API URL を聞かれます。スマホに Tailscale を入れて Pi と同じアカウントでログインした状態で、`http://<PiのTailscale IP>:8787` を入力してください(未入力のままならデモモードで動きます)。

## ビルド(実機配布)

[EAS Build](https://docs.expo.dev/build/introduction/) を使います:

```bash
npx eas build --platform android --profile preview   # APK
npx eas build --platform ios                          # 要 Apple Developer
```

## 実装メモ

- `src/piwakeClient.js` — サーバー(`../server`)の API に対応したクライアント。設定(URL / APIトークン)は AsyncStorage に保存
- 状態更新は 10 秒ポーリング(React Native には EventSource がないため、Web 版の SSE の代わり)
- `ssh://` / `rdp://` は `Linking.openURL` + クリップボードコピーのフォールバック
- Pi の API は Tailscale 上の平文 HTTP のため、`usesCleartextTraffic` / `NSAllowsArbitraryLoads` を有効化しています(WireGuard レイヤーで暗号化されます)
