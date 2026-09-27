# Remote access

Open **Application settings → Remote access** on this computer. Turn on remote
access, choose a private network address and a port, then choose **Save
connection**. The setting and port survive server restarts. A port conflict is
reported instead of silently choosing a different address. A missing network
adapter leaves the desktop app working; select the available adapter and save.

Choose **Show QR code** and scan it from your phone on the same Wi-Fi. Enter a
device name and choose **Remember this device**. Alternatively, copy the pairing
link to your own device. Each code works once, expires after five minutes, and
can be cancelled or replaced. QR images are generated locally. The pairing
secret is removed from the browser address bar before the application opens.

Bookmark the plain address shown under **Connection**. The remembered browser
can open it after closing its tabs or restarting the local server, until its
trust expires or you remove it. Choose 30 days, 90 days or one year for newly
paired devices; changing this choice does not extend existing devices. Clearing
browser cookies, using a different browser or private browsing requires pairing
again. **Remembered devices → Remove** revokes one browser immediately, including
its active event streams. Turning remote access off closes the network listener
but retains remembered devices for when you enable it again.

The local desktop URL also uses a saved port. `FREELANCER_WEB_PORT` can set a
new desktop port on launch; otherwise the last saved port is reused (58633 for
new setups). The remote port defaults to 58634 and is configured in Settings.
The old tray QR window and `-Lan` launcher switch are retired.

Keep the computer running. Closing the desktop browser does not stop the server.
To keep its LAN IP address fixed across router changes, reserve that address in
your router's DHCP settings. If the phone cannot connect, check that it is not on
an isolated guest network and Windows permits Node on Private networks. Do not
add public firewall rules or router port forwarding.

## Internet access with Tailscale Funnel

For access away from the private network, install Tailscale on this computer,
sign in to your tailnet, and enable Funnel and HTTPS certificates in its admin
settings. Then open **Application settings → Remote access → Internet access**,
choose an HTTPS port and save. Freelancer runs the Tailscale Funnel command and
checks the returned route before showing an address. Funnel supports HTTPS on
ports 443, 8443 and 10000. If a port already serves something else, Freelancer
leaves it alone and asks you to choose another. [Tailscale Funnel setup and
requirements](https://tailscale.com/docs/features/tailscale-funnel) explains
the tailnet settings and public reachability.

Funnel publishes a public HTTPS address, so anyone can open the page. Freelancer
keeps project and chat APIs behind one-time pairing. The QR code expires after
five minutes and can be used once. Pairing creates a separate random credential
for that browser; the browser stores it in an HttpOnly, SameSite=Strict,
Secure cookie, while Freelancer stores only its hash. Every API request through
the public listener requires that remembered-device credential. Remote devices
cannot generate pairing codes, manage access or remove other devices. The
loopback listener binds only to `127.0.0.1`; only its verified Funnel route is
served as Internet access.

The Funnel listener uses a separate, temporary loopback port and never binds to
the LAN or public interfaces. The public HTTPS port stays saved while the local
port is renewed each time Freelancer starts. On shutdown, Freelancer closes the
listener and removes its Funnel route; the next launch verifies and starts it
again. Disabling web access closes the listener even if Tailscale is
unavailable. Freelancer removes a route only when the selected port still
contains exactly its own Funnel target. Other Tailscale services are left
untouched. If route removal fails, the local listener is still closed and
Settings reports the Tailscale error.

Web access remains enabled across Freelancer restarts when saved. If the
Tailscale CLI or daemon is unavailable at startup, the loopback listener stays
closed and no pairing link is issued until the route is verified again. The
machine's Tailscale hostname is managed by Tailscale; the selected HTTPS port
remains saved by Freelancer. Removing a remembered device revokes it
immediately, including active event streams.

## Credentials and boundaries

Each browser gets a separate random 256-bit credential in a persistent,
HttpOnly, SameSite=Strict cookie; the web connection also sets `Secure`.
Application JavaScript cannot read it. The server saves only its SHA-256 hash with the device name and expiry in ignored
`backend/.state/remote-access.json`, separately from ordinary settings exports
and bootstrap responses. Pairing secrets live only in memory. Restarting does
not rotate remembered device credentials; revocation and expiry still apply.

**The LAN connection uses HTTP, not HTTPS, and is not encrypted.** HttpOnly
protects the cookie from JavaScript access, not network interception. Use only
your own devices on a trusted private network. The optional Internet connection
uses Tailscale Funnel over HTTPS, but still grants a paired browser access to
the whole Freelancer workspace. Only the loopback desktop can configure access,
generate pairing codes or remove devices. Exact Host, same-origin request
checks and the application request header apply to APIs and pairing. Shutdown
and the native Git bridge remain loopback-only. The Internet listener does not
trust forwarded host or client-IP headers.
