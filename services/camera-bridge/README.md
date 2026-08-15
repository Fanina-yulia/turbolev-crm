# Turbo LEV Camera Bridge

Always-on bridge for Reolink UID/P2P cameras. It is intentionally separate from Vercel Functions because the Reolink/Neolink connection can require UDP/P2P relay and a process that stays alive while the stream is being opened.

## Current endpoint

### `GET /health`

Returns service health without exposing camera credentials.

### `POST /v1/reolink/test`

Server-to-server endpoint used by Turbo LEV CRM. `CAMERA_BRIDGE_TOKEN` is required; the probe endpoint fails closed when the token is not configured.

Request:

```json
{
  "cameraId": "crm-camera-id",
  "provider": "REOLINK",
  "uid": "REOLINK_UID",
  "username": "admin",
  "password": "",
  "connectionMode": "UID_P2P"
}
```

The password may be empty. This lets CRM first try the same UID-only flow the operator may already be familiar with: Reolink UID plus the default `admin` username. If the camera requires authentication, store its actual password in CRM and repeat the test.

The bridge creates an ephemeral Neolink config with `discovery = "relay"`, starts a local RTSP bridge, captures one JPEG with FFmpeg, removes the temporary credentials file, and terminates Neolink. When the password is empty, the `password` key is omitted from the generated Neolink config.

Successful response:

```json
{
  "ok": true,
  "message": "UID/P2P relay працює, snapshot отримано.",
  "connection": "relay",
  "snapshotDataUrl": "data:image/jpeg;base64,..."
}
```

## Build

From the repository root:

```bash
docker build -t turbolev-camera-bridge ./services/camera-bridge
```

Run:

```bash
docker run --rm \
  -p 8787:8787 \
  -e CAMERA_BRIDGE_TOKEN='replace-with-a-long-random-secret' \
  turbolev-camera-bridge
```

The host/container must allow outbound Internet access required for Reolink UID discovery/relay. Do not publish the Neolink RTSP port; it is bound to `127.0.0.1` inside the container for the probe flow.

## CRM environment

Configure the same token in the Vercel project:

```text
CAMERA_BRIDGE_URL=https://your-camera-bridge-host
CAMERA_BRIDGE_TOKEN=replace-with-the-same-secret
```

The Reolink UID and camera password are not environment variables. They are entered in CRM. If a password is present, it is stored encrypted server-side and is sent to this bridge only for a connection attempt.

## Production notes

- Put the bridge behind HTTPS/TLS.
- `CAMERA_BRIDGE_TOKEN` is mandatory for the probe endpoint; never run production with an empty token.
- Do not log request bodies or camera passwords.
- Use a host that supports long-running Docker containers and outbound UDP/TCP; do not deploy this bridge as a Vercel Function.
- The current implementation is an on-demand connectivity probe. The next phase should keep registered cameras connected and publish vehicle/motion events to CRM without starting a new Neolink process per event.

## Neolink pin

The Docker image currently pins `QuantumEntangledAndy/neolink` `v0.6.2`, the latest published GitHub release at the time this bridge was added. Re-test the camera before changing that version because Neolink uses a reverse-engineered Reolink Baichuan/P2P protocol.
