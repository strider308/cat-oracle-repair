const app = document.querySelector("#app");
const cases = [
  ["node-cache-ttl-zero-001", "Rejected · zero TTL"],
  ["h0-1-authority-preflight-001", "Human required · authority ambiguity"],
];

function formatEnum(value) {
  return String(value).replaceAll("_", " ");
}

function element(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined && text !== null) item.textContent = String(text);
  if (className) item.className = className;
  return item;
}

function copyButton(value, label) {
  const button = element("button", "Copy", "copy-button");
  button.type = "button";
  button.setAttribute("aria-label", "Copy " + label);
  button.addEventListener("click", async () => {
    const announcer = document.querySelector("#copy-announcer");
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      announcer.textContent = "Copied";
    } catch {
      announcer.textContent = "Copy failed";
    }
  });
  return button;
}

function normalizeEvidence(value) {
  if (value && value.version === 1 && !value.schema && value.case && value.decision && value.authority && value.gates && value.privacy?.publicSafe === true) {
    const decision = value.decision.decision || "INCONCLUSIVE";
    return {
      id: value.case.id, title: value.case.title, headline: value.case.headline, kind: "historical-execution", decision,
      scope: "RECORDED EXECUTION · HISTORICAL",
      explanation: decision === "REJECTED" ? "The recorded public behavior gates found a contradiction." : value.decision.summary,
      intent: value.authority.expectedBehavior,
      counterexampleLabel: "OBSERVED BEHAVIOR",
      counterexample: value.authority.observedBehavior,
      counterfactual: value.intervention.counterfactualSummary,
      calibration: {explanation: value.intervention.reason, originalSuite: value.ci.existingSuite},
      repair: {
        label: "HISTORICAL MODEL RESULT",
        detail: "This public record describes a past generated candidate. It does not show a live repair in the current release; candidate source and raw model I/O are withheld.",
        fields: [
          ...(value.inference.provider ? [["Provider", value.inference.provider]] : []),
          ...(value.inference.model ? [["Model", value.inference.model]] : []),
          ...(value.candidate.candidateHash ? [["Candidate SHA-256", value.candidate.candidateHash]] : []),
          ...(value.candidate.patchSha256 ? [["Patch SHA-256", value.candidate.patchSha256]] : []),
          ...(value.candidate.changedPaths.length ? [["Changed paths", value.candidate.changedPaths.join(", ")]] : []),
        ],
      },
      statuses: [
        {label: "Existing suite", value: value.ci.existingSuite},
        {label: "Candidate execution", value: value.execution.backend},
        {label: "Blinded verification", value: value.hiddenVerification.state},
      ],
      gates: value.gates.map((gate) => ({label: gate.label, result: gate.result, detail: gate.failureKind === "SEMANTIC" ? "Recorded behavioral contradiction." : gate.failureKind.replaceAll("_", " ")})),
      provenance: [
        ...(value.inference.provider ? [{label: "Recorded provider", value: value.inference.provider}] : []),
        ...(value.inference.model ? [{label: "Recorded model", value: value.inference.model, mono: true}] : []),
        {label: "Candidate execution backend", value: value.execution.backend === "LOCAL_DOCKER_FALLBACK" ? "Isolated local Docker" : formatEnum(value.execution.backend)},
        {label: "Historical run ID", value: value.provenance.historicalRunId, mono: true},
        {label: "Public receipt SHA-256", value: value.provenance.publicReceiptSha256, mono: true},
        ...(value.provenance.sourceImplementationSha ? [{label: "Source implementation SHA", value: value.provenance.sourceImplementationSha, mono: true}] : []),
        ...(value.provenance.verifierImplementationSha ? [{label: "Verifier implementation SHA", value: value.provenance.verifierImplementationSha, mono: true}] : []),
      ], omittedClasses: value.privacy.omittedClasses,
    };
  }
  if (value?.schema === "PublicAuthorityPreflightV1" && value.version === 1 && value.decision === "HUMAN_REQUIRED" && value.candidateAccepted === false && value.execution === "NOT_RUN" && value.hiddenVerification === "NOT_APPLICABLE" && value.authorityStatus === "AMBIGUOUS" && value.privacy?.publicSafe === true) {
    return {
      id: value.case.id, title: value.case.title, headline: value.case.headline, kind: "authority-preflight", decision: value.decision,
      scope: "RECORDED PREFLIGHT · NOT RUN",
      explanation: "The preflight stopped because authority was ambiguous. No candidate decision was made.",
      intent: "The preflight could not bind one authoritative behavior from the available record.",
      counterexampleLabel: "EXECUTION STATUS",
      counterexample: "Candidate execution and hidden verification were not run.",
      counterfactual: "",
      calibration: {explanation: "This record demonstrates an authority stop before candidate execution; it is not an oracle result.", originalSuite: "NOT_RUN"},
      repair: {label: "NO MODEL OR REPAIR RUN", detail: "The public record states model inference NOT_RUN and execution NOT_RUN.", fields: []},
      statuses: [{label: "Automation", value: "STOPPED"}, {label: "Execution", value: value.execution}, {label: "Blinded verification", value: value.hiddenVerification}, {label: "Authority", value: value.authorityStatus}],
      gates: [{label: "Authority preflight", result: value.decision, detail: formatEnum(value.reason)}],
      provenance: [
        {label: "Authority document path", value: value.provenance.authorityDocumentPath},
        {label: "Authority document SHA-256", value: value.provenance.authorityDocumentSha256, mono: true},
        {label: "Authority contract", value: value.provenance.authorityContractId},
        {label: "Scenario definition path", value: value.provenance.scenarioDefinitionPath},
        {label: "Scenario definition SHA-256", value: value.provenance.scenarioDefinitionSha256, mono: true},
      ], omittedClasses: value.privacy.omittedClasses,
    };
  }
  throw new Error("Unsupported public evidence schema");
}
function makeSection(id, kicker, title, intro) {
  const section = element("section", undefined, "section");
  section.id = id;
  const heading = element("div", undefined, "section-heading");
  const titleBlock = document.createElement("div");
  titleBlock.append(element("p", kicker, "section-kicker"), element("h2", title));
  heading.append(titleBlock);
  if (intro) heading.append(element("p", intro, "section-intro"));
  section.append(heading);
  return section;
}

function stageNavigation() {
  const nav = element("nav", undefined, "stage-nav");
  nav.setAttribute("aria-label", "Hero case stages");
  const list = element("ol", undefined, "stage-list");
  const stages = [["intent", "Intent"], ["counterexample", "Counterexample"], ["oracle", "Oracle calibration"], ["repair", "Repair"], ["evidence", "Evidence"]];
  for (const [id, label] of stages) {
    const row = document.createElement("li");
    const link = element("a", label, "stage-link");
    link.href = "#" + id;
    row.append(link);
    list.append(row);
  }
  nav.append(list);
  return nav;
}

function textPanel(section, label, text, className = "story-panel") {
  const panel = element("article", undefined, className);
  panel.append(element("span", label, "card-label"), element("p", text));
  section.append(panel);
  return panel;
}

function consoleHeader(activeView) {
  const header = element("header", undefined, "console-header");
  const topbar = element("div", undefined, "topbar");
  const brand = element("div", undefined, "brand");
  brand.append(element("span", "CAT", "brand-mark"));
  const brandCopy = element("div", undefined, "brand-copy");
  brandCopy.append(element("strong", "Evidence Console"), element("span", "Counterfactual Acceptance Testing"));
  brand.append(brandCopy);
  const picker = element("label", undefined, "case-selector");
  picker.append(element("span", "VIEW"));
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Select report or public evidence case");
  const reportOption = element("option", "Test Discrimination Summary");
  reportOption.value = "report";
  reportOption.selected = activeView === "report";
  select.append(reportOption);
  cases.forEach(([id, label]) => {
    const option = element("option", label);
    option.value = "case:" + id;
    option.selected = activeView === option.value;
    select.append(option);
  });
  select.addEventListener("change", () => {
    const query = new URLSearchParams();
    if (select.value === "report") query.set("view", "discrimination");
    else query.set("case", select.value.slice(5));
    window.location.search = query.toString();
  });
  picker.append(select);
  const meta = element("div", "STATIC PUBLIC RECORDS", "topbar-meta");
  topbar.append(brand, picker, meta);
  header.append(topbar);
  return header;
}

function renderEvidence(evidence, normalized, rawJson) {
  const header = consoleHeader("case:" + normalized.id);
  const main = element("main", undefined, "page");
  main.id = "main";
  main.append(stageNavigation());
  main.append(element("p", "CASE / " + normalized.id, "eyebrow case-id"));

  const hero = element("section", undefined, "hero");
  const heroCopy = document.createElement("div");
  heroCopy.append(element("p", normalized.scope, "eyebrow"));
  heroCopy.append(element("h1", normalized.headline), element("p", normalized.title, "hero-copy"));
  const stamp = element("div", undefined, "decision-stamp decision-stamp--" + normalized.decision.toLowerCase());
  stamp.setAttribute("aria-label", "Recorded CAT decision: " + formatEnum(normalized.decision));
  stamp.append(element("span", "RECORDED DECISION"), element("strong", formatEnum(normalized.decision)));
  hero.append(heroCopy, stamp);
  main.append(hero);

  const banner = element("aside", undefined, "recorded-banner");
  banner.setAttribute("aria-label", "Demo scope");
  banner.append(element("strong", "Recorded public evidence"), element("span", "This page reads fixed public records. It does not run candidate code or call a model. No live sponsor-backed repair has run for this release."));
  main.append(banner);

  const statusGrid = element("div", undefined, "status-grid");
  normalized.statuses.forEach((status) => {
    const card = element("article", undefined, "status-card");
    card.append(element("span", status.label, "card-label"), element("strong", formatEnum(status.value)));
    statusGrid.append(card);
  });
  const summary = makeSection("record-summary", "RECORDED RUN", "What this public record contains", null);
  summary.append(statusGrid);
  main.append(summary);

  const intent = makeSection("intent", "01 / INTENT", "Behavior under review", "The approved behavior is shown as recorded in the public evidence.");
  textPanel(intent, "APPROVED BEHAVIOR", normalized.intent);
  main.append(intent);

  const counterexample = makeSection("counterexample", "02 / COUNTEREXAMPLE", "Where behavior diverged", null);
  if (normalized.counterfactual) textPanel(counterexample, "COUNTERFACTUAL", normalized.counterfactual, "counterfactual-panel");
  textPanel(counterexample, normalized.counterexampleLabel, normalized.counterexample);
  main.append(counterexample);

  const oracle = makeSection("oracle", "03 / ORACLE CALIBRATION", "What the original evidence could distinguish", null);
  textPanel(oracle, "RECORDED EXPLANATION", normalized.calibration.explanation);
  if (normalized.calibration.originalSuite) textPanel(oracle, "EXISTING SUITE", "Existing suite: " + formatEnum(normalized.calibration.originalSuite));
  const gates = element("ol", undefined, "evidence-chain");
  normalized.gates.forEach((gate, index) => {
    const row = element("li", undefined, "gate-row");
    row.append(element("span", String(index + 1).padStart(2, "0"), "gate-index"));
    const copy = element("div", undefined, "gate-copy");
    copy.append(element("strong", gate.label), element("span", gate.detail));
    row.append(copy, element("span", formatEnum(gate.result), "gate-status gate-status--" + gate.result.toLowerCase().replaceAll(" ", "_")));
    gates.append(row);
  });
  oracle.append(gates);
  if (normalized.kind === "authority-preflight") {
    const stop = element("p", undefined, "automation-stop");
    stop.append(element("strong", "AUTOMATION STOPPED"), element("span", "Execution: NOT RUN"));
    oracle.append(stop);
  }
  main.append(oracle);

  const repair = makeSection("repair", "04 / REPAIR", "What happened after the finding", null);
  textPanel(repair, normalized.repair.label, normalized.repair.detail, "repair-panel");
  if (normalized.repair.fields.length) {
    const list = element("dl", undefined, "repair-list");
    normalized.repair.fields.forEach(([label, value]) => {
      const row = document.createElement("div");
      row.className = "repair-item";
      row.append(element("dt", label));
      const definition = document.createElement("dd");
      definition.append(element("code", value));
      row.append(definition);
      list.append(row);
    });
    repair.append(list);
  }
  main.append(repair);

  const evidenceSection = makeSection("evidence", "05 / EVIDENCE", "Decision, provenance and public record", null);
  const decisionPanel = element("article", undefined, "decision-panel decision-panel--" + normalized.decision.toLowerCase());
  decisionPanel.append(element("h2", formatEnum(normalized.decision)));
  const decisionCopy = element("div", undefined, "decision-explanation");
  decisionCopy.append(element("p", normalized.explanation));
  decisionPanel.append(decisionCopy);
  evidenceSection.append(decisionPanel);

  const provenance = element("dl", undefined, "provenance-list");
  normalized.provenance.forEach((item) => {
    const row = document.createElement("div");
    row.className = "provenance-item";
    row.append(element("dt", item.label));
    const value = document.createElement("dd");
    value.append(element("span", item.value, item.mono ? "provenance-value provenance-value--mono" : "provenance-value"));
    if (item.mono) value.append(copyButton(item.value, item.label.toLowerCase()));
    row.append(value);
    provenance.append(row);
  });
  evidenceSection.append(provenance);

  const privacy = element("div", undefined, "privacy-strip");
  privacy.append(element("span", "PUBLIC-SAFE PROJECTION", "safe-badge"));
  const omitted = element("ul", undefined, "omitted-list");
  normalized.omittedClasses.forEach((value) => omitted.append(element("li", value)));
  const privacyDetails = document.createElement("details");
  privacyDetails.className = "privacy-details";
  privacyDetails.append(element("summary", "What the public record omits"), omitted);
  privacy.append(privacyDetails);
  evidenceSection.append(privacy);

  const recordLink = element("a", "Open this public JSON record", "record-link");
  recordLink.href = "./cases/" + normalized.id + ".json";
  evidenceSection.append(recordLink);
  const raw = makeSection("raw-evidence", "SOURCE OBJECT", "Public evidence JSON", null);
  const details = document.createElement("details");
  details.className = "raw-details";
  const pre = document.createElement("pre");
  pre.append(element("code", rawJson));
  details.append(element("summary", "View public evidence JSON"), pre);
  raw.append(details);
  evidenceSection.append(raw);
  main.append(evidenceSection);

  const footer = element("footer", undefined, "console-footer");
  footer.append(element("p", "CAT · Counterfactual Acceptance Testing"), element("p", "Public oracle status: WEAK · No accepted control is exposed while strict P04 verification is unavailable.", "footer-note"));
  const announcer = element("div", undefined, "sr-only");
  announcer.id = "copy-announcer";
  announcer.setAttribute("aria-live", "polite");
  announcer.setAttribute("aria-atomic", "true");
  app.replaceChildren(header, main, footer, announcer);
  app.setAttribute("aria-busy", "false");
}

function toHex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readManifest() {
  const response = await fetch("./site-manifest.json", {headers: {accept: "application/json"}});
  if (!response.ok) throw new Error("Package manifest unavailable");
  const manifest = await response.json();
  if (manifest.schema !== "CatStaticConsoleManifestV1" || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit) || !Array.isArray(manifest.files)) {
    throw new Error("Package manifest invalid");
  }
  return manifest;
}

async function readVerifiedJson(route, manifest) {
  if (!/^(?:cases\/[a-z0-9-]+\.json|sources\/[a-z0-9-]+\.json|executions\/[a-z0-9-]+\.json|test-discrimination-summary\.json)$/.test(route)) throw new Error("Evidence path not allowlisted");
  const entry = manifest.files.find((file) => file.path === route);
  if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("Evidence is not bound by package manifest");
  if (!globalThis.crypto?.subtle) throw new Error("Browser SHA-256 verification unavailable");
  const response = await fetch("./" + route, {headers: {accept: "application/json"}});
  if (!response.ok) throw new Error("Evidence request failed");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== entry.bytes || toHex(await crypto.subtle.digest("SHA-256", bytes)) !== entry.sha256) throw new Error("Evidence package hash mismatch");
  return {text: new TextDecoder("utf-8", {fatal: true}).decode(bytes), value: JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes))};
}

function resultBadge(value) {
  const normalized = String(value).toLowerCase().replaceAll("_", "-");
  return element("span", formatEnum(value), "result-badge result-badge--" + normalized);
}

function renderDiscriminationReport(summary, rawJson) {
  const header = consoleHeader("report");
  const main = element("main", undefined, "page report-page");
  main.id = "main";
  main.append(element("p", "CAT / TEST DISCRIMINATION", "eyebrow case-id"));

  const hero = element("section", undefined, "report-hero");
  const heroCopy = document.createElement("div");
  heroCopy.append(element("p", "COUNTERFACTUAL ACCEPTANCE REPORT", "eyebrow"));
  heroCopy.append(element("h1", summary.productQuestion), element("p", "H0-2 contract: cross-tenant export must be denied. Ordinary suite PASS; the bypass survived. CAT generated and ran response === \"DENY\"; good/equivalent ACCEPT, survivor REJECT.", "hero-copy"));
  const stamp = element("aside", undefined, "report-stamp");
  stamp.append(element("span", "PUBLIC ORACLE STATUS"), element("strong", "WEAK"), element("span", "H0-2 is process-controlled, not Docker-sealed. P03 is case-scoped historical evidence."));
  hero.append(heroCopy, stamp);
  main.append(hero);

  const recorded = element("aside", undefined, "recorded-banner report-recorded");
  recorded.setAttribute("aria-label", "Evidence scope");
  recorded.append(element("strong", "Recorded historical controls · not a fresh replay"), element("span", "Pinned artifact bytes and cross-record control results are checked for this package. The archived P03 receipt is incomplete because its controller-runner artifact is missing."));
  main.append(recorded);

  const chain = element("section", undefined, "section");
  chain.append(element("p", "THE DISCRIMINATING CASE", "section-kicker"), element("h2", "One missing observation lets the wrong behavior survive"));
  const steps = element("ol", undefined, "report-chain");
  for (const text of [
    "Approved behavior: ttl(key, 0) keeps an existing entry without expiry.",
    "The recorded known-wrong candidate passed the ordinary suite: 8 of 8 tests.",
    "The current oracle misses the finite-expiry survivor because it does not observe expiresAt.",
    "CAT proposes expiresAt = 0 as the smallest addition found in these recorded controls.",
    "The proposed observation rejects the survivor and preserves the known-good and equivalent controls.",
    "Archived V2 agrees with this result; its missing controller-runner means this is not a fresh replay.",
  ]) steps.append(element("li", text));
  chain.append(steps);

  const demos = element("section", undefined, "section execution-demos");
  demos.append(element("p", "FRESH CONTROLLED FIXTURE RUNS", "section-kicker"), element("h2", "Find and execute the missing observation"),
    element("p", "CAT runs each control through the ordinary suite and the same counterfactual input, then executes the proposed assertion against every result.", "section-intro"));
  for (const receipt of summary.executableOracleRepairs ?? []) {
    const card = element("article", undefined, "execution-demo");
    const heading = receipt.caseId === "h0-2-export" ? "H0-2 · Tenant-scoped export" : "Synthetic · Duplicate-operation idempotency";
    card.append(element("h3", heading), element("span", receipt.specificationStatus.replaceAll("_", " "), "execution-scope"));
    card.append(element("p", receipt.caseId === "h0-2-export" ? "Ordinary suite passes the tenant bypass. The cross-tenant export returns ALLOW for that survivor." : "Ordinary suite misses duplicate application. Replaying operation op-1 produces balance 10 for the survivor."));
    const assertion = receipt.proposedAssertion?.fields?.map((field) => `${field} = ${JSON.stringify(receipt.proposedAssertion.expected[field])}`).join(" + ") ?? "UNRESOLVED";
    card.append(element("p", "Proposed assertion · " + assertion, "report-observable"));
    const wrap = element("div", undefined, "execution-table-wrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", `${heading} control comparison table`);
    const table = document.createElement("table");
    table.append(element("caption", "Same scenario · independently hashed candidate sources"));
    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const label of ["Control", "Original suite", "New assertion", "Combined decision"]) {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = label;
      headerRow.append(cell);
    }
    head.append(headerRow);
    const body = document.createElement("tbody");
    for (const control of receipt.controls) {
      const row = document.createElement("tr");
      const label = document.createElement("th");
      label.scope = "row";
      label.textContent = `${control.id} · ${control.role.replaceAll("_", " ")}`;
      row.append(label);
      for (const value of [control.originalSuiteOutcome, control.proposedAssertionOutcome, control.combinedFinalAcceptance]) row.append(element("td", value));
      body.append(row);
    }
    table.append(head, body);
    wrap.append(table);
    card.append(wrap);
    const details = document.createElement("details");
    details.className = "execution-details";
    details.append(element("summary", "Execution receipt, source hashes and limits"));
    details.append(element("p", `Scenario SHA-256 ${receipt.scenarioBytesSha256} · input SHA-256 ${receipt.inputBytesSha256}`));
    details.append(element("p", `Repeated child runs: ${receipt.executions.every((run) => run.deterministic) ? "identical" : "UNRESOLVED"} · ${receipt.securityBoundary.replaceAll("_", " ")}`));
    const link = element("a", "Open machine-readable execution receipt");
    link.href = "./" + receipt.receiptFile;
    details.append(link);
    card.append(details);
    demos.append(card);
  }
  main.append(demos);

  const behavior = element("section", undefined, "story-panel report-requirement");
  behavior.append(element("span", "APPROVED BEHAVIOR · HASH-BOUND CONTRACT", "card-label"));
  behavior.append(element("p", summary.approvedBehavior.statement));
  behavior.append(element("p", "Observable: " + summary.approvedBehavior.observable, "report-observable"));
  main.append(behavior);

  const proposal = summary.oracleGap;
  const proposalCard = element("section", undefined, "story-panel report-proposal");
  proposalCard.append(element("span", "CAT PROPOSAL · NOT AN ACCEPTED SPECIFICATION", "card-label"));
  proposalCard.append(element("h2", proposal.status === "PROPOSAL" ? "Observe expiresAt = 0" : "Oracle gap analysis unresolved"));
  proposalCard.append(element("p", proposal.limitation));
  const additions = proposal.minimumAdditions.map(({fields, expected}) => fields.map((field) => field + " = " + JSON.stringify(expected[field])).join(" + ")).join(" or ");
  proposalCard.append(element("p", "Minimal addition: " + additions + " among " + proposal.searchBound.candidateObservations + " declared observation(s), bounded at " + proposal.searchBound.maximumCandidateObservations + ". Positive controls preserved: " + (proposal.positiveControlsPreserved ? "yes" : "no") + "."));
  proposalCard.append(element("p", "CAT differs from mutation scoring: it names the missing behavior to observe. Models may suggest candidates, but deterministic comparisons decide these recorded outcomes.", "report-observable"));
  main.append(proposalCard);
  main.append(chain);

  const controls = element("section", undefined, "section");
  controls.append(element("p", "SIDE-BY-SIDE CONTROLS", "section-kicker"), element("h2", "What each check accepted"));
  const grid = element("div", undefined, "control-grid");
  summary.controls.forEach((control) => {
    const card = element("article", undefined, "control-card" + (control.id === "finite-expiry-survivor" ? " control-card--survivor" : ""));
    card.append(element("h3", control.label));
    const hash = element("code", control.candidateSha, "control-sha");
    card.append(hash);
    const results = element("dl", undefined, "control-results");
    const proposed = proposal.calibrationAgainstHistoricalV2[control.id]?.proposed ?? control.v1;
    for (const [label, value] of [["Ordinary suite", control.existingSuite === "PASS" ? "PASS · 8/8" : "Not recorded"], ["Current V1", control.v1], ["CAT proposal", proposed], ["Recorded V2", control.v2]]) {
      const row = document.createElement("div");
      row.append(element("dt", label));
      const dd = document.createElement("dd");
      dd.append(resultBadge(value));
      row.append(dd);
      results.append(row);
    }
    card.append(results);
    if (control.id === "finite-expiry-survivor") card.append(element("p", "Observed a finite expiry; the requirement expects 0.", "survivor-note"));
    card.append(element("span", "RECORDED RESULT", "recorded-tag"));
    grid.append(card);
  });
  controls.append(grid);
  main.append(controls);

  const comparison = element("section", undefined, "section oracle-comparison");
  comparison.append(element("p", "WHY V2 CHANGES THE ANSWER", "section-kicker"), element("h2", "V1 cannot see the expiry difference"));
  const compareGrid = element("div", undefined, "comparison-grid");
  const v1 = element("article", undefined, "comparison-card");
  v1.append(element("h3", "Oracle V1"), element("p", "Observes ttlReturned, found, and value."), element("p", "The survivor matches those fields, so V1 records PASS."));
  const v2 = element("article", undefined, "comparison-card comparison-card--v2");
  v2.append(element("h3", "Oracle V2"), element("p", "Adds expiresAt and expects 0."), element("p", "The survivor retains a finite expiry, so V2 records FAIL."));
  compareGrid.append(v1, v2);
  comparison.append(compareGrid, element("p", "This P03 control set records CALIBRATED for the evaluated case. CAT’s public oracle remains WEAK; this does not establish broad oracle strength.", "report-limit"));
  main.append(comparison);

  const sources = element("section", undefined, "section report-sources");
  sources.append(element("p", "SOURCE NAVIGATION", "section-kicker"), element("h2", "Inspect the recorded evidence"));
  const receipt = summary.historicalP03;
  const identities = element("dl", undefined, "report-identities");
  for (const [label, value] of [
    ["Sprint 5 baseline source", summary.baselineReleaseSha],
    ["P03 run", receipt.runId],
    ["P03 receipt hash", receipt.receiptHash],
    ["P03 receipt file SHA-256", receipt.receiptFileSha256],
    ["Wrong candidate SHA-256", receipt.knownWrongCandidateSha],
    ["Package source", summary.packageSourceSha],
  ]) {
    const row = document.createElement("div");
    row.append(element("dt", label), element("dd", value, "report-mono"));
    identities.append(row);
  }
  sources.append(identities);
  const sourceList = element("ul", undefined, "source-list");
  summary.sourceBindings.forEach((source) => {
    const row = document.createElement("li");
    const link = element("a", source.path.replace("sources/", ""));
    link.href = "./" + source.path;
    row.append(link, element("code", source.sha256));
    sourceList.append(row);
  });
  sources.append(sourceList);
  sources.append(element("p", "Historical receipt verification: " + receipt.archivedReceiptVerification + " · missing " + receipt.missingArtifactIds.join(", ") + ".", "report-limit"));
  const raw = document.createElement("details");
  raw.className = "raw-details";
  const pre = document.createElement("pre");
  pre.append(element("code", rawJson));
  raw.append(element("summary", "View machine-readable summary"), pre);
  sources.append(raw);
  main.append(sources);

  const footer = element("footer", undefined, "console-footer");
  footer.append(element("p", "CAT · Counterfactual Acceptance Testing"), element("p", "PUBLIC_ORACLE_STATUS=WEAK · No P04 accepted control is included.", "footer-note"));
  app.replaceChildren(header, main, footer);
  app.setAttribute("aria-busy", "false");
}

async function loadEvidence() {
  let safeCaseId = cases[0][0];
  try {
    const query = new URLSearchParams(window.location.search);
    const selected = query.getAll("case");
    const views = query.getAll("view");
    if ([...query.keys()].some((key) => key !== "case" && key !== "view") || selected.length > 1 || views.length > 1 || selected.length && views.length ||
        selected.length === 1 && !cases.some(([id]) => id === selected[0]) || views.length && views[0] !== "discrimination") throw new Error("Invalid view selection");
    if (selected.length === 1) safeCaseId = selected[0];
    const manifest = await readManifest();
    if (selected.length === 1) {
      const route = "cases/" + safeCaseId + ".json";
      const verified = await readVerifiedJson(route, manifest);
      renderEvidence(verified.value, normalizeEvidence(verified.value), verified.text);
    } else {
      const verified = await readVerifiedJson("test-discrimination-summary.json", manifest);
      if (verified.value.packageSourceSha !== manifest.sourceCommit || verified.value.schema !== "CatTestDiscriminationSummaryV3" || verified.value.publicOracleStatus !== "WEAK") throw new Error("Report source binding invalid");
      for (const receipt of verified.value.executableOracleRepairs || []) {
        const checked = await readVerifiedJson(receipt.receiptFile, manifest);
        if (checked.value.runId !== receipt.runId || checked.value.receiptSha256 !== receipt.receiptSha256 || checked.value.verificationStatus !== "EXECUTED_VERIFIED_CASE_SCOPE") throw new Error("Execution receipt binding invalid");
      }
      for (const source of verified.value.sourceBindings || []) {
        const checkedSource = await readVerifiedJson(source.path, manifest);
        if (await crypto.subtle.digest("SHA-256", new TextEncoder().encode(checkedSource.text)).then(toHex) !== source.sha256) throw new Error("Report evidence binding mismatch");
      }
      renderDiscriminationReport(verified.value, verified.text);
    }
  } catch {
    const error = element("main", undefined, "error-state");
    error.id = "main";
    error.setAttribute("role", "alert");
    error.append(element("h1", "Evidence could not be verified."), element("p", "No decision is shown until the package manifest and allowlisted evidence match."));
    const reportLink = element("a", "Open the machine-readable Test Discrimination Summary");
    reportLink.href = "./test-discrimination-summary.json";
    error.append(reportLink);
    if (cases.some(([id]) => id === safeCaseId)) {
      const link = element("a", "Open the fixed public JSON record");
      link.href = "./cases/" + safeCaseId + ".json";
      error.append(link);
    }
    app.replaceChildren(error);
    app.setAttribute("aria-busy", "false");
  }
}

loadEvidence();
