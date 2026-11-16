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

**Level check.** This command shows if the stream carries sound. Speak while it runs. The mount check cannot tell silence from speech, because BUTT sends bytes either way.

```sh
curl -s --max-time 5 https://pod.fish/pod-monster-cast/live.mp3 | ffmpeg -i pipe:0 -af volumedetect -f null - 2>&1 | grep -E 'mean_volume|max_volume'
```

Expected result: `max_volume` above -30 dB while you speak. A `max_volume` near -91 dB means silence: see [If a step fails](#if-a-step-fails).

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

5. Compare the OBS settings with [Set up OBS](#set-up-obs), and the BUTT settings with [Set up BUTT](#set-up-butt).
6. Do the feed check.

   Expected result: The live item has `status="pending"` and the planned `start` and `end`.

## Hour-before steps

**Warning:** A sleeping Mac stops BUTT. Do not close the lid during the show.

Start these steps at T-60. On 2026-11-13 they started at T-22, and an audio fault ate the margin.

1. Turn on a Do Not Disturb Focus on the Mac, and silence the phone. A notification sound on the system output reaches the stream.
2. Open System Settings, General, Date & Time. Make sure that "Set time and date automatically" is on.
3. Check the clock.

   ```sh
   sntp -t 3 time.apple.com
   ```

   Expected result: The first number is below 1 second.

4. Open a terminal, and keep this command in it until the show ends.

   ```sh
   caffeinate -i
   ```

5. Stop any app that runs now.

   ```sh
   lsof -nP -tiTCP:5174 -sTCP:LISTEN | xargs kill 2>/dev/null
   ```

6. Open another terminal, and start the app. If the code changed, do `npm run build` first.

   ```sh
   npm start
   ```

7. Open `http://127.0.0.1:5174/live`.

   Expected result: The item shows "Local: pending" and "Published: pending". "Unpublished changes" is 0. No Retry form shows.

8. Open OBS, and speak into the mic.

   Expected result: The "Mic/Aux" meter in the Audio Mixer moves, and peaks above -30 dB. If it does not move, see [Set up OBS](#set-up-obs).

9. Open BUTT, and press **Play**. Speak into the mic.

   Expected result: The BUTT levels move. The Live tab shows "Source connected" within 10 seconds. If BUTT connects but its levels do not move, see [If a step fails](#if-a-step-fails).

10. Do the mount check and the level check.
11. Open the Audacity project of the episode, press **End**, then press **R**.

    Expected result: The Audacity meter moves when you speak.

12. Put a glass of water and a slice of green apple next to the mic. Drink water, not coffee or milk, from now until the show ends. Coffee and milk thicken the saliva, and that makes the tongue clicks. Eat the apple slice just before Go live. The acid cuts the clicks for a while, so keep a second slice for the half-hour mark.

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
4. Stop the Audacity recording, and press Cmd+S.
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

## Post-production

Make the episode from the Audacity master, not from the BUTT recording. The BUTT recording holds the live gate, and a gate cannot be undone.

Audacity does the cuts and holds the bed. The script `npm run master` does the rest in one command: the noise reduction, the compressor, the gate, the click removal, the loudness, the bed mix, the limiter, the de-esser, and the MP3. Its values are the Audacity values of the episode of 2026-11-06. On 2026-11-13 the result of the script won a blind listen of one minute against that episode.

1. Export the master as WAV outside the content folder before any edit.
2. Trim the head and the tail. Cut mistakes, notification sounds, sips, and swallows: select the region on the voice track and press Shift+Delete, so the gap closes. Do every cut before the bed goes in.
3. Import the bed with Cmd+Shift+I. It lands on a new track. Place the clip, set its fade, and set the track volume by ear against the voice. The script keeps that balance: it lifts the bed by the same amount as the voice, and nothing else. On 2026-11-13 the bed sat 7 LU under the voice.
4. Export with Cmd+Shift+E and choose "Export to computer". In the "Export audio" dialog, set "Type" to "Tracks as separate audio files", "Format" to WAV, "Channels" to "Mono", and "Folder" to a folder outside the content folder. Turn on "Number files in track order". Turn off "Trim blank space before first clip", so the bed file keeps its place on the timeline. Read the two names under "File name preview", then press "Export". The first file is the voice, the second is the bed.
5. Run the script from the pod-fish folder. Leave out `--bed` and `--bed-at` when the episode has no bed.

   ```sh
   npm run master -- --in <folder>/<voice file>.wav --bed <folder>/<bed file>.wav --bed-at 0 --slug <slug>
   ```

   The MP3 lands in `episodes/<slug>/media/<slug>.mp3`, and the script prints the media record. Check two log lines. `master_noise_window` names the two seconds that give the noise profile, with their level. On the master of 2026-11-06 the window sat at -64 dBFS. A level above -50 dBFS means the window holds a sound, not room noise: run the script again with `--noise-at <seconds>`, the start of two seconds of plain room noise. `master_voice` shows the measured loudness and the gain. On that master the gain was 7.1 dB.

6. Make the transcript and the chapters from the voice WAV, as the next section says.
7. Paste the media record into the `media` field of `episodes/<slug>/episode.json`, raise its revision, and do the publish command. Ask for the publish confirmation first.

The script holds the chain in `scripts/audio/masterChain.ts`, in this order:

| Stage           | ffmpeg filter | Values                                                                               |
| --------------- | ------------- | ------------------------------------------------------------------------------------ |
| Noise reduction | afftdn        | 12 dB. The profile shape comes from the quietest two seconds, the level is tracked   |
| Compressor      | acompressor   | Threshold -24 dB, ratio 2.5, knee 6 dB, make-up 8 dB, attack 3 ms, release 100 ms    |
| Noise gate      | agate         | Threshold -42 dB, reduction -24 dB, attack 10 ms, release 500 ms for hold plus decay |
| Click removal   | adeclick      | Defaults                                                                             |
| Loudness        | volume        | The gain from the measured loudness to -16 LUFS                                      |
| Bed             | amix          | The same lift as the voice, at its place in the bed file                             |
| Limiter         | alimiter      | -2 dB, on the mix                                                                    |
| De-esser        | deesser       | Intensity 0.5, max de-essing 0.5, frequency content 0.5                              |
| MP3             | libmp3lame    | 128 kbps, 44.1 kHz, mono                                                             |

The file lands 0.5 to 0.9 LU under -16 LUFS, because the limiter and the de-esser come after the gain. The episode of 2026-11-06 measured -16.4 LUFS, and the script gives -16.8 LUFS on the same master.

The gate threshold is the control that protects quiet words, and the level reduction is the control that sets the strength. To get more gate, lower the level reduction. Never raise the threshold for more gate. On 2026-11-06 the quietest word, "Spooky", had a tail at -37 to -44 dBFS in the master, 5 to 8 dB above the floor. After the reduction and the compressor it sat near -33 dBFS, and the floor near -50 dBFS, so -42 dB had 8 dB of margin on each side. The gate must stay after the compressor. Before the 8 dB of make-up gain, the same threshold is 8 dB more aggressive and cuts word tails.

The noise reduction must be the profile kind, not RNNoise. RNNoise drops every gap to silence at once and leaves noise under the words, so each pause sounds like a gate. The profile kind takes the same 12 dB off the gaps and off the words, so the room sounds the same in both.

### Transcripts and chapters

The feed links a transcript and a chapters file from each episode. Make them after step 5, from the voice WAV of step 4, with the two scripts in `scripts/transcripts/`. The speech model runs on the Mac and needs no account. On 2026-11-06 it did 80 minutes in 45 seconds.

1. Transcribe the WAV. The first run downloads the English model once.

   ```sh
   swift scripts/transcripts/transcribe.swift <export>.wav <work folder>/segments.json
   ```

2. Build the VTT, SRT, and JSON files into the episode folder. The fixes file holds the names and terms that the model mishears, as `[pattern, replacement]` pairs, and lives in the content folder as `transcript-fixes.json`. Add a pair when a new name comes up.

   ```sh
   python3 -I scripts/transcripts/build_transcripts.py <work folder>/segments.json \
     <content folder>/episodes/<slug> <slug> <content folder>/transcript-fixes.json
   ```

3. Read `<work folder>/segments.txt`, one line per sentence with its time, and write `episodes/<slug>/<slug>.chapters.json` by hand: `{"version":"1.2.0","chapters":[{"startTime":0,"title":"..."}]}` with the start in seconds.
4. Reference the files in `episode.json` and raise its revision. The publisher hashes and uploads them with the audio.

   ```json
   "podcast": {
     "transcripts": [
       { "file": "<slug>.vtt", "type": "text/vtt", "language": "en" },
       { "file": "<slug>.srt", "type": "application/x-subrip", "language": "en" },
       { "file": "<slug>.json", "type": "application/json", "language": "en" }
     ],
     "chapters": { "file": "<slug>.chapters.json", "type": "application/json+chapters" }
   }
   ```

The transcript is verbatim, so a skim of the VTT before publish catches a garbled line.

### Lessons from the show of 2026-11-06

- Turn on a Do Not Disturb Focus on the Mac, and silence the phone, before the hour-before steps. A notification played twice through the bed path and on the phone.
- The Noise Gate filter in OBS cut whole quiet words at its thresholds of that day (open -26 dB, close -35 dB, hold 200 ms, release 150 ms). The show of 2026-11-13 lowered them. [Set up OBS](#set-up-obs) holds the values.
- Drink water, not coffee or milk, before and during the show. A slice of green apple cuts tongue clicks. Step 12 of the hour-before steps holds both.
- Turn away from the mic for a sip or a swallow. The Audacity master records it either way, so cut the rest in post.

### Lessons from the show of 2026-11-13

- BUTT connected and streamed silence for 20 minutes. The OBS chain delivered no audio to BlackHole 16ch, and a restart of OBS and BUTT fixed it. The broken link is unknown. The BUTT levels show the fault at once: they must move before Go live. Steps 8 to 10 of the hour-before steps now hold that sound check, and the level check proves the sound on the public stream.
- Go live was 21 minutes late. A late Go live keeps the two-hour length from the press time, so the item ended at 09:21 instead of 09:00.
- The raw mic in BUTT is the fallback, not the setup. The stream wants the OBS filters, so the BUTT primary device is BlackHole 16ch.
- RNNoise in post-production sounds gated, even with the gate off: it drops every gap to silence at once and leaves noise under the words. A one-minute blind listen chose the profile kind of noise reduction, which takes the same 12 dB off the gaps and off the words. [Post-production](#post-production) holds the chain, and `npm run master` runs it.

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

| The Live tab shows                                                                            | What to do                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Failed at mount`                                                                             | Go live found no audio. Check BUTT, do the mount check, and press Go live again.                                                                                                                                                                                                                                                                                                                       |
| `Failed at upload` or `Failed at feed`                                                        | The public feed stays on its old version. Check the network, select "Publish again", and press Retry.                                                                                                                                                                                                                                                                                                  |
| `Failed at verify`, or "A publish did not finish: the public feed matches no publish record." | Press Retry one time with "Verify again". If that fails, select "Publish again". "Verify again" cannot pass when the public feed holds the bytes of another run.                                                                                                                                                                                                                                       |
| `Failed at ping`                                                                              | The public feed is correct. Press Retry one time with "Ping again". If that fails, continue the show. Pod Monster finds the change on its next crawl.                                                                                                                                                                                                                                                  |
| `Failed at lock`                                                                              | Another publish runs. Wait, then press the control again. A stalled upload can hold the lock for 10 seconds for each MB.                                                                                                                                                                                                                                                                               |
| A Retry form with a disabled button, after a page reload                                      | A publish still runs, and the form can be false. Wait until the run ends.                                                                                                                                                                                                                                                                                                                              |
| "No source connected"                                                                         | Check BUTT, and do the mount check.                                                                                                                                                                                                                                                                                                                                                                    |
| "Source status unknown"                                                                       | The app cannot read the status page. Do the mount check. Go live still checks the mount.                                                                                                                                                                                                                                                                                                               |
| BUTT shows connected, but its levels do not move                                              | BUTT receives silence from BlackHole 16ch. To stay on air, set the BUTT primary audio device to "Scarlett Solo USB" and press Save. That sends the raw mic with no filter. Then quit and reopen OBS, check the OBS chain in the order of [Set up OBS](#set-up-obs), quit and reopen BUTT, and switch BUTT back to "BlackHole 16ch" when the "Mic/Aux" meter moves. On 2026-11-13 the restart fixed it. |

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

## Audio chain

The mic goes through OBS, and the bed goes through the system output. BUTT mixes the two and sends the mix to Icecast. Audacity records the raw mic beside them.

| Link           | From                                                      | To                               |
| -------------- | --------------------------------------------------------- | -------------------------------- |
| Mic            | Scarlett Solo USB, input 1                                | OBS, the "Mic/Aux" source        |
| OBS filters    | "Noise Suppression", then "Noise Gate"                    | The OBS monitoring output        |
| OBS monitoring | "BlackHole 16ch"                                          | BUTT, the primary audio device   |
| Bed            | Any app that plays on the system output                   | "Streaming Audio Bed"            |
| System output  | "Streaming Audio Bed": "BlackHole 2ch" and the headphones | BUTT, the secondary audio device |
| Master         | Scarlett Solo USB, with no filter                         | Audacity                         |

"Streaming Audio Bed" is a Multi-Output Device in Audio MIDI Setup. Keep it as the system output during the show, so you hear the bed and the stream receives it. Every system sound reaches the stream the same way.

OBS must stay open during the show. Its audio stops with it.

### Set up OBS

1. Open Settings, Audio. Under "Global Audio Devices", set "Mic/Auxiliary Audio" to "Scarlett Solo USB".
2. Under "Advanced", set "Monitoring Device" to "BlackHole 16ch". Press OK.
3. In the Audio Mixer, press the gear next to "Mic/Aux", then "Advanced Audio Properties". Set "Audio Monitoring" of Mic/Aux to "Monitoring Enabled".
4. Press the gear again, then "Filters". The list must hold "Noise Suppression" first and "Noise Gate" second, both on. Set the gate values below.
5. Speak into the mic. The "Mic/Aux" meter must move. If it does not, open System Settings, Privacy & Security, Microphone, and turn on OBS.

| Control         | Value  |
| --------------- | ------ |
| Open Threshold  | -36 dB |
| Close Threshold | -42 dB |
| Attack Time     | 10 ms  |
| Hold Time       | 500 ms |
| Release Time    | 300 ms |

The gate sees the floor after the suppression, so keep the filter order. To check the thresholds, say a sentence at your quietest show voice. The open threshold must sit 3 dB under its peak. The close threshold must sit 6 dB under the open threshold, and at least 6 dB above the floor that the meter shows while you are silent.

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

| Setting                | Value                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| Server type            | Icecast                                                                                            |
| Address                | `pod.fish`                                                                                         |
| Port                   | `443`                                                                                              |
| TLS                    | On                                                                                                 |
| Mount                  | `pod-monster-cast/live.mp3`                                                                        |
| User                   | `source`                                                                                           |
| Password               | The source password                                                                                |
| Format                 | MP3                                                                                                |
| Icecast protocol       | PUT or SOURCE on 2.5.0. SOURCE on 2.4.4.                                                           |
| Primary audio device   | `BlackHole 16ch`, the OBS output. `Scarlett Solo USB` is the fallback: the raw mic with no filter. |
| Secondary audio device | `BlackHole 2ch`, the bed                                                                           |
| Record                 | On at connect, MP3 at 192 kbps, into `streams/` in the content folder                              |

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
| Hub test                                | Not run. On 2026-11-04 the feed was not in Podcast Index, by the decision of the owner. It is in the index now, as feedId 8103595. Each publish calls the hub, and the hub answers 200.                                                                                          |
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
