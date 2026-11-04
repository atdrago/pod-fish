# Live show runbook

U7 adds the checklist for the day of the show to this file. This version holds the stream section of U5.

## Stream server

| Item           | Value                                            |
| -------------- | ------------------------------------------------ |
| Fly app        | `pod-fish`                                       |
| Host           | `pod.fish`, DNS only                             |
| Mount          | `/pod-monster-cast/live.mp3`                     |
| Listener URL   | `https://pod.fish/pod-monster-cast/live.mp3`     |
| Default image  | Icecast 2.5.0, `infra/icecast/Dockerfile`        |
| Fallback image | Icecast 2.4.4, `infra/icecast/Dockerfile.debian` |
| Listener cap   | 100                                              |

`infra/icecast/README.md` explains each step in full.

### Set the secrets

**Warning:** Copy the values from the password manager. Do not put them in the repo or in a chat.

```sh
fly secrets set ICECAST_SOURCE_PASSWORD=placeholder-source-password ICECAST_ADMIN_PASSWORD=placeholder-admin-password ICECAST_RELAY_PASSWORD=placeholder-relay-password -a pod-fish
```

### Deploy

**Warning:** Keep `--ha=false` and every `--env` flag. Without `--ha=false`, the source and the listeners can land on different machines. Without an `--env` flag, the entrypoint refuses to start.

```sh
cd infra/icecast
fly deploy -a pod-fish --ha=false --primary-region iad \
  --env ICECAST_HOSTNAME=pod.fish \
  --env ICECAST_ADMIN=admin@example.com \
  --env ICECAST_LOCATION=Fly.io \
  --env ICECAST_MOUNT=/pod-monster-cast/live.mp3 \
  --env ICECAST_CLIENT_CAP=100
```

### Set up BUTT

| Setting          | Value                                    |
| ---------------- | ---------------------------------------- |
| Server type      | Icecast                                  |
| Address          | `pod.fish`                               |
| Port             | `443`                                    |
| TLS              | On                                       |
| Mount            | `pod-monster-cast/live.mp3`              |
| User             | `source`                                 |
| Password         | The source password                      |
| Format           | MP3                                      |
| Icecast protocol | PUT or SOURCE on 2.5.0. SOURCE on 2.4.4. |

### Check the server

**Warning:** Do not use `curl -I` on the mount. Icecast 2.5.0 answers a HEAD request with 405, and 2.4.4 answers with 400. Use the GET commands below.

| Check                 | Command                                                                               | Expected result                               |
| --------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------- |
| Certificate           | `fly certs check pod.fish -a pod-fish`                                                | The certificate is issued.                    |
| Mount with no source  | `curl -s -o /dev/null -w '%{http_code}\n' https://pod.fish/pod-monster-cast/live.mp3` | `404`                                         |
| Mount with a source   | `curl -s -D - -o /dev/null --max-time 3 https://pod.fish/pod-monster-cast/live.mp3`   | `200` and `Content-Type: audio/mpeg`          |
| Status with no source | `curl -s https://pod.fish/status-json.xsl`                                            | `icestats` has no `source` key.               |
| Status with a source  | `curl -s https://pod.fish/status-json.xsl`                                            | `icestats.source` is an object for the mount. |
| Admin page            | `curl -s -o /dev/null -w '%{http_code}\n' https://pod.fish/admin/stats`               | `401`                                         |

### Run the soak test

1. Start the source in BUTT.
2. Start the listener:

   ```sh
   curl -sN https://pod.fish/pod-monster-cast/live.mp3 -o /dev/null -w '%{http_code} %{time_total}\n'
   ```

3. Write down the start time.
4. Wait for two hours.
5. Stop the source in BUTT, and write down the end time.
6. Write the result in the table below.

The test passes when `time_total` is at least 7200 seconds and BUTT did not reconnect. A drop before two hours is red and starts the VPS fallback.

### Soak result

<!-- TODO: Fill in this table when the soak ends. Do not report a pass without both times. -->

| Item                                    | Result       |
| --------------------------------------- | ------------ |
| Soak start (EST)                        | NOT RECORDED |
| Soak end (EST)                          | NOT RECORDED |
| Output of the listener curl             | NOT RECORDED |
| BUTT reconnects during the soak         | NOT RECORDED |
| BUTT method that worked over TLS        | NOT RECORDED |
| `/status-json.xsl` answer on `pod.fish` | NOT RECORDED |
| Mount `Content-Type` on `pod.fish`      | NOT RECORDED |
| `/admin/stats` answer on `pod.fish`     | NOT RECORDED |
| Pass or fail                            | NOT RECORDED |
| Fallback taken                          | NOT RECORDED |

### Fallbacks

#### The 2.5.0 image fails

Set BUTT to SOURCE. Then deploy the 2.4.4 image:

```sh
cd infra/icecast
fly deploy -a pod-fish --ha=false --primary-region iad --dockerfile Dockerfile.debian \
  --env ICECAST_HOSTNAME=pod.fish \
  --env ICECAST_ADMIN=admin@example.com \
  --env ICECAST_LOCATION=Fly.io \
  --env ICECAST_MOUNT=/pod-monster-cast/live.mp3 \
  --env ICECAST_CLIENT_CAP=100
```

#### BUTT cannot connect over TLS, but curl can

Fly routes a shared IPv4 address by the domain of the TLS request. A client that sends no domain cannot reach the app on that address. To fix this condition, allocate a dedicated IPv4 address, and change the `A` record to it. A dedicated address has a monthly cost.

```sh
fly ips allocate-v4 -a pod-fish
```

#### The soak is red

Move the stream to a small VPS with the same image.

**Warning:** Do not use the Caddy `reverse_proxy` in the source path. BUTT sends a request with no length and no chunked encoding, and an HTTP proxy reads that request as one with no body. In a local test with Caddy 2.11.7, a BUTT-shaped PUT received `100 Continue` and the listener received 0 bytes. A BUTT-shaped SOURCE received a broken pipe after 0.3 seconds.

Terminate TLS at the TCP level, as Fly does. A local test with HAProxy in `mode tcp` and a self-signed certificate passed for both BUTT-shaped methods. No VPS and no certbot step has run yet.

1. Create a small VPS with Docker and HAProxy.
2. Change the `A` and `AAAA` records of `pod.fish` to the VPS, with DNS only. The TTL is 300 seconds.
3. Receive a certificate:

   ```sh
   certbot certonly --standalone -d pod.fish
   cat /etc/letsencrypt/live/pod.fish/fullchain.pem /etc/letsencrypt/live/pod.fish/privkey.pem > /etc/haproxy/site.pem
   ```

4. Build and start the image. Put the three passwords in `/root/icecast.env` with mode 600.

   ```sh
   docker build -t pod-fish-icecast infra/icecast
   docker run -d --restart=always --env-file /root/icecast.env -p 127.0.0.1:8000:8000 \
     --env ICECAST_HOSTNAME=pod.fish \
     --env ICECAST_ADMIN=admin@example.com \
     --env ICECAST_LOCATION=VPS \
     --env ICECAST_MOUNT=/pod-monster-cast/live.mp3 \
     --env ICECAST_CLIENT_CAP=100 \
     pod-fish-icecast
   ```

5. Write this config to `/etc/haproxy/haproxy.cfg`, and restart HAProxy:

   ```text
   global
       maxconn 200
   defaults
       mode tcp
       timeout connect 5s
       timeout client 1h
       timeout server 1h
   frontend stream
       bind :443 ssl crt /etc/haproxy/site.pem alpn http/1.1
       default_backend icecast
   backend icecast
       server icecast 127.0.0.1:8000
   ```

6. Run the soak test again.
