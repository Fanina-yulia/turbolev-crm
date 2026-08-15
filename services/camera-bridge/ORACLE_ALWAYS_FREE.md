# Oracle Cloud Always Free deployment

Use an OCI Ampere A1 Always Free VM for the Turbo LEV Camera Bridge.

Recommended free shape:
- VM.Standard.A1.Flex
- 2 OCPU
- 12 GB RAM
- Ubuntu

The Camera Bridge image supports both `linux/amd64` and `linux/arm64`; Oracle Ampere uses `linux/arm64` and downloads Neolink's official `neolink_linux_arm64.zip` asset.

## Network

Allow inbound TCP 22 for SSH and TCP 80/443 for Caddy HTTPS. The bridge itself remains internal to Docker and is not published directly on port 8787.

## Install

On the VM, install Git and Docker with the Docker Compose plugin, clone `Fanina-yulia/turbolev-crm`, and checkout the branch that contains the camera integration.

Create `services/camera-bridge/.env`:

```text
CAMERA_BRIDGE_TOKEN=<long-random-secret>
BRIDGE_HOSTNAME=<public-ip-with-dashes>.sslip.io
```

For example, public IP `203.0.113.10` becomes:

```text
BRIDGE_HOSTNAME=203-0-113-10.sslip.io
```

`sslip.io` resolves the embedded IP address automatically, so no paid domain is required. Caddy obtains and renews a public TLS certificate automatically.

Start:

```bash
docker compose \
  --env-file services/camera-bridge/.env \
  -f services/camera-bridge/docker-compose.oracle.yml \
  up -d --build
```

Check:

```bash
curl https://$BRIDGE_HOSTNAME/health
```

Expected response contains:

```json
{"ok":true,"service":"turbolev-camera-bridge"}
```

## Vercel

Set the following server-side environment variables in the Turbo LEV Vercel project:

```text
CAMERA_BRIDGE_URL=https://<BRIDGE_HOSTNAME>
CAMERA_BRIDGE_TOKEN=<same-secret-as-Oracle>
```

Then use CRM → Налаштування → Камери → Перевірити підключення.

## Security

- Never expose port 8787 publicly.
- Keep `CAMERA_BRIDGE_TOKEN` out of Git.
- Use HTTPS only between Vercel and the Camera Bridge.
- The camera UID and password remain in CRM; the password is stored encrypted and sent to the bridge only during a server-to-server camera operation.
