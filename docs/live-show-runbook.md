# Live show runbook

This file is the checklist for the show, the rehearsal, the fallbacks, and the stream server.

The show starts on Friday at 07:00 ET. T is the start time of the show.

| Time | ET    | Step                                    |
| ---- | ----- | --------------------------------------- |
| T-60 | 06:00 | [Hour-before steps](#hour-before-steps) |
| T-10 | 06:50 | [Go live](#go-live)                     |
| T-3  | 06:57 | Pull to refresh in Pod Monster          |
| T    | 07:00 | The show starts                         |

Run every command from the root of this repo.

## Checks that repeat

**Feed check.** This command shows what the public feed says now.

```sh
curl -s https://drago.fm/pod-monster-cast/feed.xml | grep -o -E '<podcast:liveItem [^>]*>|<ttl>[0-9]+</ttl>|<item>|<podcast:podping[^>]*>'
```

Expected result:

- One `<ttl>5</ttl>` line.
- One `<item>` line for each episode.
- One `<podcast:liveItem>` line for each live item, with the status that the step names.
- No `<podcast:podping` line.

**Mount check.** This command shows if the stream answers.

```sh
curl -s -D - -o /dev/null --max-time 3 https://pod.fish/pod-monster-cast/live.mp3
```

Expected result: `200` and `Content-Type: audio/mpeg` while BUTT streams. With no source, the answer is `404`.

**Publish.** The Live tab has no Publish button. Use this command after you create or delete a live item.

```sh
curl -s -X POST -H 'Origin: http://127.0.0.1:5174' http://127.0.0.1:5174/api/publish
```

Expected result: `"ok":true` and `"pingLabel":"index re-fetch accepted"`.

To publish without the hub ping, for example when the index must not learn of the feed yet, send a JSON body with `notify` false. The expected `pingLabel` is then `"no notification sent"`. A later publish with no body sends the ping.

```sh
curl -s -X POST -H 'Origin: http://127.0.0.1:5174' -H 'Content-Type: application/json' \
  -d '{"notify":false}' http://127.0.0.1:5174/api/publish
```

## Day-before checks

1. Check the bucket.

   ```sh
   curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://drago.fm/pod-monster-cast/feed.xml
   ```

   Expected result: `200 application/rss+xml; charset=utf-8`.

2. Check DNS. Compare the two answers with the list of Fly addresses.

   ```sh
   dig +short pod.fish A
   dig +short pod.fish AAAA
   fly ips list -a pod-fish
   ```

   Expected result: Both answers are in the Fly list. Any other address means that Cloudflare proxies the record. Set the record to DNS only.

3. Check the Fly machine.

   ```sh
   fly status -a pod-fish
   ```

   Expected result: The state of the machine is `started`, and the checks column shows `1 passing`.

4. Check the certificate.

   ```sh
   fly certs check pod.fish -a pod-fish
   ```

   Expected result: `Status = Issued`.

5. Compare the BUTT settings with [Set up BUTT](#set-up-butt).
6. Do the feed check.

   Expected result: The live item has `status="pending"` and the planned `start` and `end`.

## Hour-before steps

**Warning:** A sleeping Mac stops BUTT. Do not close the lid during the show.

1. Open System Settings, General, Date & Time. Make sure that "Set time and date automatically" is on.
2. Check the clock.

   ```sh
   sntp -t 3 time.apple.com
   ```

   Expected result: The first number is below 1 second.

3. Open a terminal, and keep this command in it until the show ends.

   ```sh
   caffeinate -i
   ```

4. Stop any app that runs now.

   ```sh
   lsof -nP -tiTCP:5174 -sTCP:LISTEN | xargs kill 2>/dev/null
   ```

5. Open another terminal, and start the app. If the code changed, do `npm run build` first.

   ```sh
   npm start
   ```

6. Open `http://127.0.0.1:5174/live`.

   Expected result: The item shows "Local: pending" and "Published: pending". "Unpublished changes" is 0. No Retry form shows.

7. Start BUTT.

   Expected result: The Live tab shows "Source connected" within 10 seconds.

8. Start the local recording.
9. Do the mount check.

## Go live

Do these steps at T-10.

**Warning:** Go live changes the public feed.

1. Press **Go live**.

   Expected result: The dialog says "Start your local recording now." and "Your source is connected."

2. Press **Confirm Go live**.

   Expected result: The Live tab shows "Done: index re-fetch accepted." and "Published: live".

3. Do the feed check.

   Expected result: The live item has `status="live"`.

4. At T-3, pull to refresh in Pod Monster.

   Expected result: The banner shows. If it does not, pull again.

5. Play the stream in Pod Monster.

   Expected result: You hear the show.

## During the show

Do these checks every 5 minutes:

- The Live tab shows "Source connected", the listener count, and "Published: live".
- The mount check answers `200`.
- The feed check shows `status="live"`.

## Stop

**Warning:** Press Stop in the app before you stop BUTT. If BUTT stops first, the feed says live while the mount answers `404`.

**Warning:** Stop has no confirmation. One press ends the live item.

1. Press **Stop**.

   Expected result: The Live tab shows "Done: index re-fetch accepted."

2. Do the feed check.

   Expected result: The live item has `status="ended"`.

3. Stop BUTT.
4. Stop the local recording, and make sure that the file is saved.
5. Pull to refresh in Pod Monster.

   Expected result: The banner clears on the next crawl, within about 5 minutes.

## After the show

1. Do the mount check.

   Expected result: `404`.

2. Commit and push the publish records in the content repo.

   ```sh
   content_folder="$(grep '^CONTENT_FOLDER=' .env | cut -d= -f2-)"
   git -C "$content_folder" status --short
   git -C "$content_folder" add .
   git -C "$content_folder" commit -m "chore: Record the show of <date>"
   git -C "$content_folder" push -u origin main
   ```

An ended item stays in the feed until you delete it. [Prepare the next show](#prepare-the-next-show) removes it.

## Prepare the next show

1. Copy the title and the description from `live/<slug>/live.json` in the content folder. The next step removes that file.
2. In the "Ended" list, press **Delete**, then **Confirm delete**.
3. In the form "Create a live item", enter these values, then press **Create**:
   - **Title:** the title that you copied.
   - **Description:** the description that you copied.
   - **Start:** the next show, in the local time of the Mac.
   - **Duration in minutes:** 120.
4. Do the publish command.
5. Do the feed check.

   Expected result: One live item has `status="pending"` and the new `start` and `end`.

## If a step fails

| The Live tab shows                                                                            | What to do                                                                                                                                                       |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Failed at mount`                                                                             | Go live found no audio. Check BUTT, do the mount check, and press Go live again.                                                                                 |
| `Failed at upload` or `Failed at feed`                                                        | The public feed stays on its old version. Check the network, select "Publish again", and press Retry.                                                            |
| `Failed at verify`, or "A publish did not finish: the public feed matches no publish record." | Press Retry one time with "Verify again". If that fails, select "Publish again". "Verify again" cannot pass when the public feed holds the bytes of another run. |
| `Failed at ping`                                                                              | The public feed is correct. Press Retry one time with "Ping again". If that fails, continue the show. Pod Monster finds the change on its next crawl.            |
| `Failed at lock`                                                                              | Another publish runs. Wait, then press the control again. A stalled upload can hold the lock for 10 seconds for each MB.                                         |
| A Retry form with a disabled button, after a page reload                                      | A publish still runs, and the form can be false. Wait until the run ends.                                                                                        |
| "No source connected"                                                                         | Check BUTT, and do the mount check.                                                                                                                              |
| "Source status unknown"                                                                       | The app cannot read the status page. Do the mount check. Go live still checks the mount.                                                                         |

## No-go for the show

Each of these conditions is a no-go. Fix the fault or move the show:

- No banner shows within 10 minutes after the pull to refresh at T-3.
- The stream does not play.
- Stop does not reach the public feed after Retry.
- "Source connected" does not show while BUTT streams.

## Rehearsal

Do this on the day before the show, and finish by 21:00. The rehearsal is a real Go live and a real Stop against the public feed, with a 10-minute stream. Anyone with the feed URL can see it.

The app allows one open item, so the rehearsal uses the pending item for the show. Step R8 replaces that item.

1. **R1.** Do the [day-before checks](#day-before-checks).
2. **R2.** Do the [hour-before steps](#hour-before-steps).
3. **R3.** Do steps 1 to 3 of [Go live](#go-live). Write down the time.
4. **R4.** Seven minutes after Go live, do steps 4 and 5 of [Go live](#go-live).
5. **R5.** Do the checks of [During the show](#during-the-show) one time.
6. **R6.** Ten minutes after Go live, force a failure at Stop. Keep BUTT on. BUTT does not use the app, so the stream continues.
   1. Press Control-C in the terminal of the app.
   2. Start the app with a wrong key. This changes the key for this run only, and `.env` does not change.

      ```sh
      R2_SECRET_ACCESS_KEY=placeholder-wrong-key npm start
      ```

   3. Reload the Live tab.

      Expected result: "Published: live", and no Retry form.

   4. Press **Stop**.

      Expected result: "Failed at upload: Could not upload `<file>`. The bucket answered 403." A Retry form shows with "Publish again". The "Ended" list shows "(still published as live)".

   5. Do the feed check.

      Expected result: The live item still has `status="live"`.

   6. Press Control-C in the terminal of the app, and start the app with the real key.

      ```sh
      npm start
      ```

   7. Reload the Live tab.

      Expected result: The Retry form still shows.

   8. Select "Publish again", and press **Retry**.

      Expected result: "Done: index re-fetch accepted." The Retry form goes away, and "(still published as live)" goes away.

   9. Do the feed check.

      Expected result: The live item has `status="ended"`.

7. **R7.** Do steps 3 to 5 of [Stop](#stop).
8. **R8.** Do [Prepare the next show](#prepare-the-next-show) for Friday at 07:00 ET.

   Expected result: The feed check shows `status="pending"`, `start="2026-11-06T12:00:00.000Z"`, and `end="2026-11-06T14:00:00.000Z"`.

9. **R9.** Do [After the show](#after-the-show), with the commit message `chore: Record the rehearsal of 2026-11-05`.

### Rehearsal result

| Step                                  | Result  | Note |
| ------------------------------------- | ------- | ---- |
| R1 Day-before checks                  | Not run |      |
| R2 Hour-before steps                  | Not run |      |
| R3 Go live reaches the public feed    | Not run |      |
| R4 Banner and playback in Pod Monster | Not run |      |
| R5 Checks during the stream           | Not run |      |
| R6 Failed Stop, then Retry            | Not run |      |
| R7 Banner clears                      | Not run |      |
| R8 Friday's item is pending           | Not run |      |
| R9 Publish records committed          | Not run |      |
| Go or no-go                           | Not run |      |

## Fallbacks for the show

### You press Stop by accident

An ended item cannot go live again. Keep BUTT on, and create a new item.

1. In the form "Create a live item", enter the same title and description, the start time now, and the minutes that remain. Press **Create**.
2. Press **Go live**, then **Confirm Go live**.
3. Do the feed check.

   Expected result: The new item has `status="live"`, and the old item has `status="ended"`.

After the show, delete the ended items and publish.

### The Podcast Index hub fails

The hub is the only ping path. No podping.cloud token exists, and the app has only the hub sender.

Go live at T-10 in every case. `<ttl>5</ttl>` keeps the crawl of Pod Monster at five minutes, with or without the hub.

## Other procedures

### Retract an episode

**Warning:** Keep at least one episode in the feed. The crawler of Pod Monster never completes a crawl of a feed with no episode. The trailer stays until another episode is public.

1. Press Control-C in the terminal of the app.
2. Remove the folder of the episode from `episodes/` in the content folder.
3. Start the app.

   ```sh
   npm start
   ```

4. Do the publish command.
5. Do the feed check.

   Expected result: The feed has one `<item>` line fewer.

6. In the Cloudflare dashboard, open the R2 bucket. Delete the objects under `<OBJECT_KEY_PREFIX>/media/<slug>/`. The app does not delete objects from the bucket.

### Rotate the credentials after a lost or compromised Mac

**Warning:** `fly secrets set` restarts the machine and stops the stream. Do not do this during a show unless the credentials are in danger.

**Warning:** Keep the new values in the password manager. Do not put them in the repo or in a chat.

1. In the Cloudflare dashboard, revoke the R2 token. Create a new token with the same one-bucket scope.
2. Create a new source password and a new admin password. Do this command one time for each password.

   ```sh
   openssl rand -hex 32
   ```

3. Set the new passwords on Fly.

   ```sh
   fly secrets set ICECAST_SOURCE_PASSWORD=placeholder-source-password ICECAST_ADMIN_PASSWORD=placeholder-admin-password -a pod-fish
   ```

4. Enter the new source password in BUTT.
5. If a podping.cloud token exists, request a new one.
6. Write the new values in `.env`, and start the app again.

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

### Wednesday results

| Item                                    | Result                                                                                                                                                                                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Soak start (EST)                        | Source 2026-11-04 12:10:45 EST. Listener 2026-11-04 12:26:25 EST.                                                                                                                                                                                                                |
| Soak end (EST)                          | Both 2026-11-04 14:24:36 EST.                                                                                                                                                                                                                                                    |
| Output of the listener curl             | `200 7091.576714`, curl exit 0                                                                                                                                                                                                                                                   |
| BUTT reconnects during the soak         | None seen. One `stream_start`, and the access log shows one PUT that lasted 8031 seconds.                                                                                                                                                                                        |
| BUTT method that worked over TLS        | PUT. Access log: `"PUT /pod-monster-cast/live.mp3 HTTP/1.1" 200 516 "-" "butt 1.47.0" 8031`.                                                                                                                                                                                     |
| `/status-json.xsl` answer on `pod.fish` | 200. `source` is present with a source and absent with none.                                                                                                                                                                                                                     |
| Mount `Content-Type` on `pod.fish`      | `audio/mpeg`, 200, HTTP/1.1, no redirect                                                                                                                                                                                                                                         |
| `/admin/stats` answer on `pod.fish`     | 401                                                                                                                                                                                                                                                                              |
| Pass or fail                            | Pass, by the decision of the owner. The owner stopped BUTT at 14:24:36 EST. The source held 8031 seconds. The listener held 7091.6 seconds, 108.4 seconds short of 7200. The owner restarted `coreaudiod` multiple times during the soak, and the access log shows no reconnect. |
| Hub test                                | Not run. The feed is not in Podcast Index, by the decision of the owner. Each publish calls the hub, and the hub answers 200.                                                                                                                                                    |
| Pod Monster live test                   | Pass, reported by the owner. Go live published at 15:44:36 EST and Stop at 16:00:15 EST on 2026-11-04. This test ran before the review fixes.                                                                                                                                    |
| Fallback taken                          | None                                                                                                                                                                                                                                                                             |

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
