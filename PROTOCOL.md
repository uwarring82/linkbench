# Freiburg pilot decision rule

This document describes the rule implemented by `renderComparison` in `app.js` and the pilot guidance in `index.html`.

## Runs and pairs

The comparison uses the currently visible history. It groups Freiburg runs with a non-empty block label and an uplink of DSL or Cellular by their exact block label.

A run is eligible if it is not cancelled, has a finite upload-loaded median (`metrics.upLoaded`), and has exactly one distinct, non-empty endpoint revision across its successful upload-bulk and upload-probe samples. Negotiated HTTP version is not a run eligibility condition.

Each block must contain exactly one eligible DSL run and exactly one eligible cellular run. Otherwise the block is “unavailable or unmatched”: an extra eligible run of either kind makes it unmatched, while ineligible runs do not count.

The pair must have the same VPN state, local interface, endpoint and endpoint revision. Each run must also have exactly one distinct, non-empty negotiated HTTP version across its successful upload-bulk and upload-probe samples, and that version must be equal across the pair. A block whose pair fails any of these conditions is also “unavailable or unmatched”. An address-family difference is reported but does not exclude the pair.

## Wins and verdict

The paired difference is the DSL upload-loaded median minus the cellular upload-loaded median. The faster side wins a block only if the difference in its favour is both ≥ 20 ms and ≥ 25% of the slower side's upload-loaded median. A pair that meets neither win condition remains eligible but awards no win.

A verdict requires exactly six eligible blocks and exactly six block labels in the comparison, with one comparison key across all pairs: endpoint, revision, HTTP version, interface and VPN state. An extra unmatched block label therefore prevents a verdict. At least five cellular wins produce “Cellular wins”; at least five DSL wins produce “DSL wins”. Otherwise the verdict is “Unresolved”.

This rule has been fixed in the code since commit 8a94df1 (2026-11-14). It is a decision heuristic, not a statistical test: if each block were a coin flip, one side would reach 5 of 6 with probability 7/64 ≈ 0.11.

Here 7/64 is the probability for a specified side to reach at least five wins. The probability that either side reaches at least five wins is 14/64 ≈ 0.22. This coin-flip illustration does not model the magnitude thresholds or blocks with no win.

## Measurements and budget

A loaded latency series requires at least four probes, all successful or timed out, and a successful bulk transfer. A timed-out probe enters the median as 5000 ms; a non-timeout probe error invalidates the series. Each run's upload-loaded median is used directly in the paired comparison.

The pilot budget is 214 MB of application payload per target per run, plus overhead: two 50 MB downloads, two 16 MB uploads, a 50 MB loaded download and a 32 MB loaded upload. MB is decimal. The two goodput repeats are summarized by their median, which for two values is their arithmetic mean.

## Scheduling and limits

Use the same protocol on the Freiburg and control responders. Schedule six blocks across days and daytime/evening windows, alternate DSL/cellular order, use a unique label per paired window, and keep the browser, local interface and VPN setting fixed. The automated verdict concerns Freiburg pairs only.

The code does not check day spread, time window, order alternation, browser, access point or VPN route. Equality of the recorded interface and VPN labels does not verify the physical path. The verdict is displayed as a heuristic with schedule, order and access point not verified.
