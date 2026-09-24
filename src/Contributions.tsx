import { ProviderScope, ProviderText } from "./ProviderColors";
import { useState } from "react";
import { Badge } from "./echoflex/Controls";
import { formatPercent } from "../domain/contributions.mjs";

export function ContributionRows({ breakdown }: { breakdown?: any }) {
  return (
    <div className="contribution-rows">
      {breakdown?.partial && (
        <p className="notice">Some activity is unavailable. Shares cover the observed portion only.</p>
      )}
      {!breakdown?.hasActivity && <p>No measured activity yet.</p>}
      {(breakdown?.rows ?? []).map((row) => (
        <ProviderScope key={row.id} provider={row.providerID} className="contribution-row">
          <div className="model-work">
            <span>
              <strong><ProviderText provider={row.providerID} mark>{row.name}</ProviderText></strong>
              {row.providerID && <small><ProviderText provider={row.providerID}>{row.providerID}</ProviderText></small>}
              {row.partial && <small>Partial activity</small>}
            </span>
            <Badge>{formatPercent(row.sharePercent)}</Badge>
          </div>
          {row.sharePercent !== null && (
            <div className="usage-bar provider-meter" aria-hidden="true">
              <i style={{ width: `${row.sharePercent}%` }} />
            </div>
          )}
        </ProviderScope>
      ))}
    </div>
  );
}

export function ChatContributions({ contributions }: { contributions?: any }) {
  const [group, setGroup] = useState("models");
  return (
    <section className="chat-contributions" aria-label="Contribution breakdown">
      <label className="field">
        <span>Group contributions by</span>
        <select value={group} onChange={(event) => setGroup(event.target.value)}>
          <option value="models">Model</option>
          <option value="agents">Agent</option>
        </select>
      </label>
      <ContributionRows breakdown={contributions?.[group]} />
      {contributions?.ancestryUncertain && <p className="notice">Some delegation links could not be resolved.</p>}
      <small>Estimated activity, not quality or subscription usage.</small>
    </section>
  );
}
