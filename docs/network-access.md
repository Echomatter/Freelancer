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

## Credentials and boundaries

Each browser gets a separate random 256-bit credential in a persistent,
HttpOnly, SameSite=Strict cookie. Application JavaScript cannot read it. The
server saves only its SHA-256 hash with the device name and expiry in ignored
`backend/.state/remote-access.json`, separately from ordinary settings exports
and bootstrap responses. Pairing secrets live only in memory. Restarting does
not rotate remembered device credentials; revocation and expiry still apply.

**The LAN connection uses HTTP, not HTTPS, and is not encrypted.** HttpOnly
protects the cookie from JavaScript access, not network interception. Use only
your own devices on a trusted private network. A paired browser can use the app,
including its chats and normal permission controls. Only the loopback desktop
can configure access, generate pairing codes or remove devices. Exact Host,
same-origin request checks and the application request header apply to APIs and
pairing. Shutdown and the native Git bridge remain loopback-only. Public remote
addresses are rejected.
