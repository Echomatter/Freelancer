import { ProviderText } from "./ProviderColors";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ExternalLink, LoaderCircle } from "lucide-react";
import { Button, Field } from "./echoflex/Controls";
import { Dialog } from './echoflex/Dialog';
import { api } from "./api";
import { authInputs, initialInputs, promptVisible } from "../domain/auth.mjs";

export function ProviderConnection({
  provider,
  name,
  methods,
  onClose,
  onConnected,
}: {
  provider: string;
  name: string;
  methods: any[];
  onClose: () => void;
  onConnected: () => Promise<void>;
}) {
  const [index, setIndex] = useState(methods.length === 1 ? 0 : -1);
  const [inputs, setInputs] = useState<Record<string, string>>(
    methods.length === 1 ? initialInputs(methods[0]) : {},
  );
  const [secret, setSecret] = useState(""),
    [authorization, setAuthorization] = useState<any>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef<AbortController>();
  useEffect(() => {
    return () => request.current?.abort();
  }, []);
  const method = methods[index];
  async function submit() {
    if (!method || busy) return;
    const abort = new AbortController();
    request.current = abort;
    setBusy(true);
    setError("");
    try {
      if (method.type === "api") {
        await api(
          "auth",
          { provider, action: "key", key: secret },
          "POST",
          abort.signal,
        );
      } else if (!authorization) {
        const next = await api(
          "auth",
          {
            provider,
            action: "authorize",
            method: index,
            inputs: authInputs(method, inputs),
          },
          "POST",
          abort.signal,
        );
        if (!/^https?:\/\//.test(next.url ?? ""))
          throw Error("This provider did not return a sign-in link.");
        setAuthorization(next);
        return;
      } else {
        await api(
          "auth",
          {
            provider,
            action: "callback",
            method: index,
            code: secret || undefined,
          },
          "POST",
          abort.signal,
        );
      }
      setSecret("");
      await onConnected();
      onClose();
    } catch (e) {
      if (!abort.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Could not connect. Try again.",
        );
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  return (
    <Dialog title={<>Connect <ProviderText provider={provider} mark>{name}</ProviderText></>}
      footer={<>
          <Button type="button" variant="quiet" onClick={onClose}>
            Close
          </Button>
          {method && (
            <Button
              type="submit"
              variant="primary"
              disabled={busy || (method.type === "api" && !secret.trim())}
            >
              {busy ? (
                <>
                  <LoaderCircle size={15} className="spin" />
                  Connecting…
                </>
              ) : authorization ? (
                "Finish connection"
              ) : method.type === "api" ? (
                "Connect"
              ) : (
                "Continue"
              )}
            </Button>
          )}
        </>}
      ariaLabel="Connect provider" onClose={onClose} initialFocus="first"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {!method ? (
          <>
            {methods.map((m, i) => (
              <Button
                type="button"
                key={i}
                onClick={() => {
                  setIndex(i);
                  setInputs(initialInputs(m));
                  setError("");
                }}
              >
                {m.label}
                <ArrowRight size={15} />
              </Button>
            ))}
            {!methods.length && (
              <p>No connection methods are available. Refresh and try again.</p>
            )}
          </>
        ) : authorization ? (
          <>
            <p>{authorization.instructions}</p>
            <a
              className="button primary"
              href={authorization.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              Continue in browser
              <ExternalLink size={16} />
            </a>
            {authorization.method === "code" && (
              <Field label="Authorization code">
                <input
                  autoComplete="off"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  required
                  disabled={busy}
                />
              </Field>
            )}
          </>
        ) : method.type === "api" ? (
          <Field label={method.label || "API key"}>
            <input
              type="password"
              autoComplete="off"
              required
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              disabled={busy}
            />
          </Field>
        ) : (
          <>
            {(method.prompts ?? [])
              .filter((p) => promptVisible(p, inputs))
              .map((p) => (
                <Field label={p.message} key={p.key}>
                  {p.type === "select" ? (
                    <select
                      value={inputs[p.key] ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        setInputs((values) => ({
                          ...values,
                          [p.key]: e.target.value,
                        }))
                      }
                    >
                      {p.options.map((o) => (
                        <option value={o.value} key={o.value}>
                          {o.label}
                          {o.hint ? ` · ${o.hint}` : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      required
                      placeholder={p.placeholder}
                      value={inputs[p.key] ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        setInputs((values) => ({
                          ...values,
                          [p.key]: e.target.value,
                        }))
                      }
                    />
                  )}
                </Field>
              ))}
          </>
        )}

    </Dialog>
  );
}
