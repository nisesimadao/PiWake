# PiWake Mobile

PiWake Mobile は、PiWake の React Native / Expo クライアントです。
Web コンソールと同じ PiWake API を使い、スマートフォンから Wake-on-LAN、接続ショートカット、リモートシャットダウンなどを操作できます。

## Expo Go で起動する

```bash
cd mobile
npm install
npx expo start
```

表示された QR コードを [Expo Go](https://expo.dev/go) で読み取ります。

初回起動時に PiWake API の URL を設定します。
スマートフォンを Raspberry Pi と同じ tailnet へ接続し、次の形式で入力してください。

```text
http://<PiのTailscale IP>:8787
```

URL を設定しない場合はデモモードで起動します。
API token を有効にしている場合は、アプリ側にも同じ token を設定します。

## 実機向けビルド

[EAS Build](https://docs.expo.dev/build/introduction/) を利用できます。

```bash
npx eas build --platform android --profile preview   # APK
npx eas build --platform ios                          # Apple Developer account が必要
```

## 実装メモ

- `src/piwakeClient.js`：PiWake server API のクライアントです。
- API URL と API token は AsyncStorage に保存します。
- React Native では Web 版と同じ EventSource を使用していないため、デバイス状態は 10 秒ごとに取得します。
- `ssh://` / `rdp://` は `Linking.openURL` を試し、必要に応じて接続情報を clipboard へコピーします。
- PiWake server は tailnet 内で HTTP を使うため、Android の `usesCleartextTraffic` と iOS の `NSAllowsArbitraryLoads` を有効にしています。通信経路の暗号化は Tailscale / WireGuard が担当します。
