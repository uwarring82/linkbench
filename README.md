# Linkbench

Browser speed tests with connection labels, local history, JSON and CSV export, and a Freiburg DSL-versus-cellular comparison. The app has no frontend build step.

## Try locally

From the repository root run `python3 -m http.server 8000` and visit <http://localhost:8000>. Select the Cloudflare demo, label your connection, and run a test. The demo uses Cloudflare's [public speed-test endpoints](https://github.com/cloudflare/speedtest), transfers up to 10 MB of application payload, and provides idle latency and basic goodput. Its upload byte count is the submitted payload size. The public edge may vary and the demo produces no Freiburg comparison. Results stay in this browser unless exported. The chosen responder receives requests and sees the client connection.

## Worldwide measurements

Select **Worldwide · M-Lab NDT7**, choose at least two sites, and confirm M-Lab's data policy before starting. The fixed site catalog spans Frankfurt, New York, Johannesburg, Singapore, and Sydney. M-Lab's [Locate v2 API](https://www.measurementlab.net/develop/locate-v2/) supplies the exact machine and expiring URLs at run time. The app starts all available downloads together, then starts all available uploads together. Endpoint errors are shown per site. Upload results prefer server application receipts, then labeled server TCP receive rates (which include protocol overhead), then labeled browser send-buffer estimates. An interrupted upload can retain a result after at least eight seconds of measured transfer and keeps its termination status in the export. Each direction can use about ten seconds' worth of application data on the shared connection, so use an unmetered connection if data cost matters.

The measurements compete for bandwidth. Per-site goodput shows what that path achieved while the other sites were active. The JSON export records actual machine names, byte counts, phase durations, and offsets from the direction's start. CSV uses one row per site. NDT7 TCP RTT is distinct from the HTTPS timings of the Freiburg pilot. M-Lab receives and publishes the IP address, timestamp, and results under its [privacy policy](https://www.measurementlab.net/privacy/). Linkbench discards access tokens and client IP fields from its own history.

## Explore network routes

Open **Explore network routes** to compare a great-circle path with a candidate corridor for each M‑Lab site. The map uses city-level endpoint coordinates and illustrative waypoints. Distances use geographic segments, with operator-published cable-system lengths where labeled. The model has no per-run route attribution. An arbitrary latitude and longitude can be entered in the details panel and stay in the current page. The model and data sources are in `routes.js`; the Natural Earth coastline is projected into `route-land.svg` for offline use.

## Publish the frontend

Create a public GitHub repository and push this project's files to `main`. In **Settings → Pages**, choose **Deploy from a branch**, **main**, and **/ (root)**. Pages serves the frontend only. All benchmark traffic goes directly from the browser to the selected responder, without a frontend proxy.

## Run a controlled responder

Use Node.js 22 or later. For local development:

```sh
node responder.mjs --origin http://localhost:8000
```

In the frontend select **Independent** or **Home LAN** and enter `http://127.0.0.1:8787`. An unshaped local link can finish too quickly for four loaded probes. This is expected. For a public or campus host use a valid certificate and point the DNS hostname directly at the host. Run behind an approved access boundary if it will serve a private pilot. Example using a separately managed TLS certificate:

```sh
node responder.mjs --host :: --port 443 --origin https://YOUR-ACCOUNT.github.io \
  --cert /path/to/fullchain.pem --key /path/to/private-key.pem --revision site-1
```

The Node server terminates TLS directly and supports HTTP/2 and HTTP/1.1. It does not advertise HTTP/3. Omit any `h3` DNS HTTPS advertisement. The server logs request ID, UTC times, HTTP version, client-facing address family, status and byte count as JSON lines on stderr. It omits IP addresses and does not collect optional kernel TCP statistics. The browser export includes the same request IDs. Set a new revision after responder changes. If your campus requires a reverse proxy, the direct TLS topology must be revisited before using its transport metadata for a pilot.

The responder caps payload sizes and limits concurrent bulk requests. CORS checks browser origins and is not authentication. Before exposing a responder, arrange operator-approved reachability, egress limits, ingress rate limiting and log retention. Keep the two pilot responders on independently operated networks appropriate to the paths under study. A provisioned Freiburg endpoint requires the university's involvement. Cloudflare infrastructure is optional.

## Pilot

Use the same protocol on the Freiburg and control responders. Budget 214 MB per run plus overhead. The upload-loaded latency compares two runs to the same Freiburg responder with the same explicit block label, interface and VPN state. The comparison requires matching endpoint revisions and negotiated HTTP versions. Schedule six blocks across days and daytime/evening windows, alternate order, and use unique labels. The UI shows the paired deltas and evaluates the predeclared five-of-six rule. It cannot independently verify the VPN route, timing of your schedule, or which access point your device used.
