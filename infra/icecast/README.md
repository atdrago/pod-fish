# Icecast on Fly.io

This folder defines the stream server. Fly terminates TLS at its edge and forwards plain TCP to Icecast. No HTTP proxy sits in the stream path.

| File                   | Purpose                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ |
| `Dockerfile`           | Builds Icecast 2.5.0 from the pinned tarball. This is the default image.       |
| `Dockerfile.debian`    | Installs the Debian `icecast2` 2.4.4 package. This is the fallback image.      |
| `entrypoint.sh`        | Checks each value, renders `icecast.xml`, and starts Icecast as a normal user. |
| `icecast.xml.template` | The config. Both images use it.                                                |
| `fly.toml`             | One service on port 443, with the `tls` handler only and no port 80.           |

## Values

The commands below use these placeholders. Replace them with the values of your show.

| Placeholder          | Meaning                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| `<fly-app>`          | The name of the Fly app.                                                |
| `<region>`           | A Fly region near the source. `fly platform regions` lists the regions. |
| `stream.example.com` | The host name of the stream server.                                     |
| `/show/live.mp3`     | The mount. It can hold more than one path segment.                      |

The app and the domain are not in `fly.toml`, because they differ between two installs. The machine receives these variables:

| Variable                  | Source      | Purpose                                                                  |
| ------------------------- | ----------- | ------------------------------------------------------------------------ |
| `ICECAST_SOURCE_PASSWORD` | Fly secret  | The password of the source app. It needs at least 32 characters.         |
| `ICECAST_ADMIN_PASSWORD`  | Fly secret  | The password of the admin page. It needs at least 32 characters.         |
| `ICECAST_RELAY_PASSWORD`  | Fly secret  | The relay password. No relay exists, but Icecast has a default for this. |
| `ICECAST_HOSTNAME`        | Deploy flag | The stream host name.                                                    |
| `ICECAST_ADMIN`           | Deploy flag | The admin contact. The status page shows it, so use `admin@example.com`. |
| `ICECAST_LOCATION`        | Deploy flag | The server location. The status page shows it.                           |
| `ICECAST_MOUNT`           | Deploy flag | The mount. It must start with a slash.                                   |
| `ICECAST_CLIENT_CAP`      | Deploy flag | The maximum number of listeners.                                         |

The entrypoint stops with exit code 78 when one of these conditions is true:

- A variable is missing or empty.
- A password has fewer than 32 characters.
- A password equals `hackme` or `hackmemore`, which are the defaults in the Icecast sample config.
- A password starts with `placeholder-`.
- The host name, the mount, or the cap has an invalid form.

## 1. Create the app and the addresses

```sh
fly apps create <fly-app>
fly ips allocate-v4 --shared -a <fly-app>
fly ips allocate-v6 -a <fly-app>
fly ips list -a <fly-app>
```

## 2. Add the DNS records

**Warning:** Keep the proxy off on each record. A proxied record puts the HTTP proxy of Cloudflare in the stream path.

In Cloudflare DNS, add these records with DNS only and TTL Auto:

1. An `A` record for `stream.example.com` with the IPv4 address.
2. An `AAAA` record for `stream.example.com` with the IPv6 address.

## 3. Request the certificate

```sh
fly certs add stream.example.com -a <fly-app>
fly certs setup stream.example.com -a <fly-app>
```

`fly certs setup` prints an `_acme-challenge` CNAME record. Add that record in Cloudflare DNS with DNS only. Fly validates this record with no machine in the app. Then check the certificate:

```sh
fly certs check stream.example.com -a <fly-app>
```

The result must say that the certificate is issued.

## 4. Generate and set the passwords

**Warning:** Keep the passwords in the password manager, in Fly secrets, and (the source password) in BUTT only. Do not write them in the repo or in a chat.

Run this command three times, and save each result in the password manager:

```sh
openssl rand -hex 32
```

Then set the secrets, and use the values from the password manager:

```sh
fly secrets set ICECAST_SOURCE_PASSWORD=placeholder-source-password ICECAST_ADMIN_PASSWORD=placeholder-admin-password ICECAST_RELAY_PASSWORD=placeholder-relay-password -a <fly-app>
```

The entrypoint refuses a value that still starts with `placeholder-`.

## 5. Deploy

**Warning:** Keep `--ha=false`. Without it, Fly creates two machines, and the source and the listeners can land on different machines.

**Warning:** Pass every `--env` flag in each deploy. `fly.toml` holds none of these values, and the entrypoint refuses to start without them.

```sh
cd infra/icecast
fly deploy -a <fly-app> --ha=false --primary-region <region> \
  --env ICECAST_HOSTNAME=stream.example.com \
  --env ICECAST_ADMIN=admin@example.com \
  --env ICECAST_LOCATION=Fly.io \
  --env ICECAST_MOUNT=/show/live.mp3 \
  --env ICECAST_CLIENT_CAP=100
```

`fly.toml` sets the Fly hard limit to 150 connections, because the Fly default is 25. The Icecast clients limit is the cap plus 10, so the status page still answers when the mount is full. If you raise the cap above 139, raise the hard limit too.

## 6. Set up BUTT

| Setting          | Value                                         |
| ---------------- | --------------------------------------------- |
| Server type      | Icecast                                       |
| Address          | `stream.example.com`                          |
| Port             | `443`                                         |
| TLS              | On                                            |
| Mount            | `show/live.mp3`, with no leading slash        |
| User             | `source`                                      |
| Password         | The source password from the password manager |
| Format           | MP3                                           |
| Icecast protocol | PUT or SOURCE on 2.5.0. SOURCE on 2.4.4.      |

## 7. Check the server

**Warning:** Do not use `curl -I` on the mount or on the status page. Icecast 2.5.0 answers a HEAD request with 405, and 2.4.4 answers with 400. The commands below use GET.

| Check                 | Command                                                                             | Expected result                                        |
| --------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Certificate           | `fly certs check stream.example.com -a <fly-app>`                                   | The certificate is issued.                             |
| Certificate chain     | `curl -sv -o /dev/null https://stream.example.com/status-json.xsl`                  | curl verifies the chain and shows 200.                 |
| Mount with no source  | `curl -s -o /dev/null -w '%{http_code}\n' https://stream.example.com/show/live.mp3` | `404`                                                  |
| Mount with a source   | `curl -s -D - -o /dev/null --max-time 3 https://stream.example.com/show/live.mp3`   | `200` and `Content-Type: audio/mpeg`, with no redirect |
| Status with no source | `curl -s https://stream.example.com/status-json.xsl`                                | `icestats` has no `source` key.                        |
| Status with a source  | `curl -s https://stream.example.com/status-json.xsl`                                | `icestats.source` is an object for the mount.          |
| Admin page            | `curl -s -o /dev/null -w '%{http_code}\n' https://stream.example.com/admin/stats`   | `401`                                                  |

`--max-time 3` makes curl exit with code 28 on a live mount. This exit code is correct, because a stream does not end.

## 8. Run the soak test

The soak test holds a source and a listener open for the planned length of the show.

1. Start the source in BUTT.
2. Start the listener:

   ```sh
   curl -sN https://stream.example.com/show/live.mp3 -o /dev/null -w '%{http_code} %{time_total}\n'
   ```

3. Wait for two hours.
4. Stop the source in BUTT.
5. Read the output of curl. The test passes when `time_total` is at least 7200 seconds and BUTT did not reconnect.

## The 2.4.4 fallback

Use this image only when the 2.5.0 image fails. Set BUTT to SOURCE, because 2.4.4 does not decode a chunked PUT.

```sh
cd infra/icecast
fly deploy -a <fly-app> --ha=false --primary-region <region> --dockerfile Dockerfile.debian \
  --env ICECAST_HOSTNAME=stream.example.com \
  --env ICECAST_ADMIN=admin@example.com \
  --env ICECAST_LOCATION=Fly.io \
  --env ICECAST_MOUNT=/show/live.mp3 \
  --env ICECAST_CLIENT_CAP=100
```

## Known log lines

**Warning:** The access log holds client addresses. Do not commit a log.

These lines on 2.5.0 are normal:

| Line                                              | Meaning                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `Unsupported or legacy stream type: "audio/mpeg"` | Icecast 2.5.0 sends MP3 through its generic handler, which is its MP3 plugin. |
| `no PRNG seed configured`                         | The seed setting is only in 2.5, and the template is valid for 2.4.4 too.     |
| `YP server handling has been disabled`            | The image has no directory listing.                                           |
| `Input string does not parse as KVA`              | Icecast answers a refused source client with an error page.                   |
| `Wrong request type from client`                  | A client sent a HEAD request.                                                 |
| `req for file ... No such file or directory`      | A client asked for the mount with no source connected.                        |
