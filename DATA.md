# Export data dictionary

JSON exports the full history as an array of runs, adding `units` to each run. CSV exports one row per non-global run or one row per selected site for a global run. Export files stay on the user's device until shared; this does not describe the separate traffic sent during measurement.

Fields below are optional when their phase was not reached or does not apply. JSON omits undefined properties and serializes non-finite numbers as `null`. CSV quotes every value, writes missing/null values as empty strings, stringifies arrays with commas, and prefixes potentially formula-like strings with an apostrophe (`app.js:csvField`). `app.js:submit handler` means the anonymous form submission listener; export handlers are the anonymous `onclick` functions.

## JSON run fields

`{direction}` means `down` or `up`; `{phase}` means `download` or `upload`. Each nested field is listed below its container.

| Name | Type | Unit | Meaning | Where it is set (file:function) |
| --- | --- | --- | --- | --- |
| schema | number | — | Schema value `1`. | app.js:submit handler |
| appVersion | string | — | App version `0.1.0`. | app.js:submit handler |
| id | string | — | Random run UUID. | app.js:submit handler |
| time | string | UTC ISO 8601 | Run creation time. | app.js:submit handler |
| target | string | — | Selected target (`demo`, `global`, `freiburg`, `control`, `lan`). | app.js:submit handler |
| endpoint | string | URL | Demo origin, validated custom origin, or M-Lab Locate origin. | app.js:submit handler |
| iface | string | — | User-selected local interface label. | app.js:submit handler |
| uplink | string | — | User-selected uplink label. | app.js:submit handler |
| vpn | string | — | User-selected VPN label. | app.js:submit handler |
| block | string | — | Trimmed user block label. | app.js:submit handler |
| note | string | — | Trimmed user note. | app.js:submit handler |
| browser | string | — | Browser's user-agent string (`navigator.userAgent`). | app.js:submit handler |
| goodputProfile | string | — | `ndt7-parallel-v2`, `edge-demo-v1`, or `https-goodput-v1`. | app.js:submit handler |
| loadedProfile | string or null | — | `https-loaded-v1` for custom responders; null for demo/global. | app.js:submit handler |
| status | string | — | `Running`, then `Complete`, `Partial`, or `Cancelled` according to completion/error handling. | app.js:submit handler |
| flags | array of strings | — | Measurement warnings and caught error/abort reason. | app.js:submit handler; measure.js:measure |
| cancelled | boolean | — | Signal's aborted state when an error is caught; otherwise absent. | app.js:submit handler |
| goodputComplete | boolean | — | Set after both goodput directions finish; true when at least eight idle probes succeeded. | measure.js:measure |
| metrics | object | — | Non-global summary metrics; initially empty. | app.js:submit handler; measure.js:measure |
| metrics.down | number | Mbit/s | Median of download repeat rates, each bytes × 8 / (1000 × elapsed ms). | measure.js:measure, requireTransfer |
| metrics.up | number | Mbit/s | Median of upload repeat rates by the same formula. | measure.js:measure, requireTransfer |
| metrics.idle | number or null | ms | Median successful idle elapsed times if at least eight succeeded, otherwise null. | measure.js:measure |
| metrics.downLoaded | number or null | ms | `loaded.down.medianMs`. | measure.js:measure |
| metrics.upLoaded | number or null | ms | `loaded.up.medianMs`. | measure.js:measure |
| loaded | object | — | Loaded-phase summaries; initially empty. | app.js:submit handler; measure.js:measure |
| loaded.{direction} | object | — | Summary returned for that loaded phase. | measure.js:measure, loaded |
| loaded.{direction}.medianMs | number or null | ms | Probe median if at least four probes and all are successful or timed out; timeouts contribute 5000 ms. Otherwise null. | measure.js:loaded |
| loaded.{direction}.probes | number | count | Number of completed probe results. | measure.js:loaded |
| loaded.{direction}.timeouts | number | count | Timed-out probes. | measure.js:loaded |
| loaded.{direction}.goodput | number | Mbit/s | Bulk transfer rate. | measure.js:loaded, requireTransfer |
| samples[] | array of objects | — | HTTP request samples, initially empty; not populated by global measurements. | app.js:submit handler; measure.js:request |
| samples[].id | string | — | Random request UUID. | measure.js:request |
| samples[].phase | string | — | `warm`, `idle`, `down`, `up`, `down-bulk`, `up-bulk`, `down-probe`, or `up-probe`. | measure.js:request |
| samples[].time | string | UTC ISO 8601 | Request sample creation time. | measure.js:request |
| samples[].offsetMs | number or null | ms | Request start minus loaded-phase start; null outside loaded probes (including bulk requests). | measure.js:request, loaded |
| samples[].bytes | number | bytes | Received response-body bytes or acknowledged upload bytes; demo upload uses submitted size. Initially zero. | measure.js:request |
| samples[].expectedBytes | number | bytes | Requested transfer size; zero for probes. | measure.js:request |
| samples[].status | string | — | `pending`, `ok`, `cancelled`, `timeout`, or `error`. | measure.js:request |
| samples[].http | string or null | — | `x-benchmark-http` response header. | measure.js:request |
| samples[].family | string or null | — | `x-benchmark-family` response header. | measure.js:request |
| samples[].revision | string or null | — | `x-benchmark-revision` response header. | measure.js:request |
| samples[].byteCountConfirmed | boolean | — | Set to false for demo uploads. | measure.js:request |
| samples[].error | string | — | Timeout explanation, abort reason, or caught error. | measure.js:request |
| samples[].elapsedMs | number | ms | Time from request start through completion/error handling. | measure.js:request |
| regions[] | array of objects | — | Selected global sites, copied from `globalSites`; absent for non-global runs. | app.js:submit handler; global.js:globalSites |
| regions[].id | string | — | Site code used for discovery. | global.js:globalSites; app.js:submit handler |
| regions[].city | string | — | Site city label. | global.js:globalSites; app.js:submit handler |
| regions[].region | string | — | Geographic region label. | global.js:globalSites; app.js:submit handler |
| regions[].machine | string | — | Matching discovery result's machine name. | global.js:measureGlobal, discover |
| regions[].error | string | — | Discovery error, cancellation, or insufficient available sites. | global.js:measureGlobal |
| regions[].{phase} | object | — | Direction result; early failure may contain only status. | global.js:measureGlobal, transfer, runUpload |
| regions[].{phase}.status | string | — | Transfer outcome, including `ok`, `no measurement`, cancellation, connection failures, deadlines, or worker errors. | global.js:transfer, runUpload, measureGlobal |
| regions[].{phase}.startOffsetMs | number | ms | `clock() - waveStart` at transfer start; clock is timeOrigin + performance.now(). | global.js:transfer |
| regions[].{phase}.openOffsetMs | number or null | ms | `openedAt - waveStart`; openedAt uses performance.now(), while waveStart uses timeOrigin + performance.now(). Null if unopened. | global.js:transfer |
| regions[].{phase}.firstOffsetMs | number or null | ms | First download arrival uses performance.now() minus waveStart; first upload send uses clock() minus waveStart. Null if none. | global.js:transfer |
| regions[].{phase}.endOffsetMs | number | ms | `clock() - waveStart` at finish. | global.js:transfer |
| regions[].{phase}.bytes | number or null | bytes | Download bytes received, or upload reading selected from receipt, TCP receive reading, then browser estimate. | global.js:transfer |
| regions[].{phase}.elapsedMs | number or null | ms | Download last-body arrival minus open time, or selected upload reading duration. | global.js:transfer |
| regions[].{phase}.mbps | number or null | Mbit/s | 8 × bytes / (1000 × elapsedMs) if usable; interrupted non-cancelled upload may qualify with at least 8000 ms. | global.js:transfer |
| regions[].{phase}.source | string or null | — | `browser received`, `server receipt`, `server TCP receive rate`, `browser sent estimate`, or null. | global.js:transfer |
| regions[].{phase}.closeCode | number or null | — | WebSocket close event code, if received before finish. | global.js:transfer |
| regions[].{phase}.wasClean | boolean or null | — | WebSocket close event's wasClean value, if received before finish. | global.js:transfer |
| regions[].{phase}.termination | string or null | — | Original finish status if not `ok`, retained even when an interrupted upload becomes usable. | global.js:transfer |
| regions[].{phase}.queuedUploadBytes | number or null | bytes | Total bytes passed to socket.send for upload (not current buffer size); null for download. | global.js:transfer |
| regions[].{phase}.minRttMs | number or null | ms | Minimum positive finite TCPInfo.MinRTT seen, divided by 1000. | global.js:transfer |
| units | object | — | Added to every JSON-exported run. | app.js:JSON export handler |
| units.down | string | — | `Mbit/s`. | app.js:module units constant |
| units.up | string | — | `Mbit/s`. | app.js:module units constant |
| units.idle | string | — | `ms`. | app.js:module units constant |
| units.downLoaded | string | — | `ms`. | app.js:module units constant |
| units.upLoaded | string | — | `ms`. | app.js:module units constant |

## CSV columns

Types describe values before CSV stringification. Shared run fields retain their JSON meanings. Global rows use regional down/up values; their idle and loaded metric columns are empty. Regional columns are empty for non-global runs. Headers below include the exact unit suffixes.

| Name | Type | Unit | Meaning | Where it is set (file:function) |
| --- | --- | --- | --- | --- |
| time | string | UTC ISO 8601 | Run creation time. | app.js:submit handler |
| id | string | — | Run UUID. | app.js:submit handler |
| appVersion | string | — | App version. | app.js:submit handler |
| target | string | — | Target label. | app.js:submit handler |
| endpoint | string | URL | Endpoint origin. | app.js:submit handler |
| iface | string | — | Interface label. | app.js:submit handler |
| uplink | string | — | Uplink label. | app.js:submit handler |
| vpn | string | — | VPN label. | app.js:submit handler |
| block | string | — | Block label. | app.js:submit handler |
| note | string | — | User note. | app.js:submit handler |
| status | string | — | Run status. | app.js:submit handler |
| goodputProfile | string | — | Goodput profile identifier. | app.js:submit handler |
| loadedProfile | string or null | — | Loaded profile identifier. | app.js:submit handler |
| down_Mbit_s | number | Mbit/s | metrics.down or regional download.mbps. | measure.js:measure; global.js:transfer; app.js:CSV export handler |
| up_Mbit_s | number | Mbit/s | metrics.up or regional upload.mbps. | measure.js:measure; global.js:transfer; app.js:CSV export handler |
| idle_ms | number or null | ms | metrics.idle. | measure.js:measure; app.js:CSV export handler |
| downLoaded_ms | number or null | ms | metrics.downLoaded. | measure.js:measure; app.js:CSV export handler |
| upLoaded_ms | number or null | ms | metrics.upLoaded. | measure.js:measure; app.js:CSV export handler |
| flags | array of strings | — | Comma-joined run flags. | app.js:submit handler, csvField; measure.js:measure |
| site | string | — | regions[].id. | app.js:CSV export handler |
| city | string | — | regions[].city. | app.js:CSV export handler |
| machine | string | — | regions[].machine. | app.js:CSV export handler |
| minTcpRttMs_ms | number or null | ms | Minimum finite download/upload minRttMs for the site. | app.js:CSV export handler |
| downloadStatus | string | — | Download status, falling back to site error. | app.js:CSV export handler |
| uploadStatus | string | — | Upload status, falling back to site error. | app.js:CSV export handler |
| uploadSource | string or null | — | Upload source. | app.js:CSV export handler |
| uploadTermination | string or null | — | Upload termination. | app.js:CSV export handler |
| uploadCloseCode | number or null | — | Upload WebSocket close code. | app.js:CSV export handler |
| uploadWasClean | boolean or null | — | Upload WebSocket clean-close value. | app.js:CSV export handler |
