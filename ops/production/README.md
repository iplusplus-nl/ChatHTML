# Production operations

The systemd units and root scripts in this directory back up and monitor the
alpha deployment. `chathtml-backup` creates an AES-256 encrypted bundle of the
PostgreSQL database, account Service SQLite database, and uploaded-file tree.
Every run performs a real PostgreSQL restore into a disposable database, checks
the restored SQLite database, and validates the file archive before succeeding.

Local encrypted backups are retained for 14 days. To complete off-host copies,
install a root-owned executable at `/usr/local/sbin/chathtml-backup-upload`; it
receives the verified encrypted archive path as its only argument and must exit
non-zero if the remote upload fails. The backup job fails when that hook fails.

The monitor checks the public deep-health endpoint, the local account Service,
disk usage, backup/restore freshness, and 80% of the global managed-spend
ceiling. Set `CHATHTML_ALERT_WEBHOOK_URL` in the root-only
`/etc/chathtml-monitor.env` file to deliver failures to an HTTPS webhook.

The Nginx files mirror the two production virtual hosts. Their shared zones
limit one IP to 10 new requests per second with a burst of 60 and 30 concurrent
connections; application-level per-IP and per-account limits remain the more
specific API controls.

`nginx-cloudflare-real-ip.conf` trusts only Cloudflare's published proxy
networks before accepting `CF-Connecting-IP`. This makes both Nginx zones and
the app's Nginx-supplied `X-Real-IP` account for the visitor instead of a shared
Cloudflare edge address; direct-origin requests cannot spoof the header.
