import { useRef, useState } from "react";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { Button } from "./echoflex/Controls";
import { pendingQuestions, questionAnswers } from "../domain/questions.mjs";
import { Dialog } from './echoflex/Dialog';
import "./workspace-feedback.css";

type Request = {
  id: string;
  worker?: boolean;
  sessionTitle?: string;
  questions: {
    question: string;
    multiple?: boolean;
    custom?: boolean;
    options: { label: string; description?: string }[];
  }[];
};

export function Questions({ requests, suspended = false, onRespond }: {
  requests: Request[];
  suspended?: boolean;
  onRespond: (id: string, response: { answers: string[][] } | { reject: true }) => Promise<void>;
}) {
  const [completed, setCompleted] = useState<Set<string>>(() => new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const queue: Request[] = pendingQuestions(requests, completed).sort((a, b) => Number(!!b.worker) - Number(!!a.worker));
  const request = queue[0];
  if (!request) return null;
  return (
    <>
      <div className="question-reminder">
        <span>{queue.length === 1 ? "An answer is needed" : `${queue.length} requests need an answer`}</span>
        <Button onClick={() => setDismissed(previous => { const next = new Set(previous); next.delete(request.id); return next; })}>Review question</Button>
      </div>
      {[queue.find(row => !row.worker), queue.find(row => row.worker)].filter(Boolean).map(row => <Question key={row!.id} request={row!} count={queue.length}
        open={!dismissed.has(row!.id) && (!suspended || !!row!.worker)}
        onLater={() => setDismissed(previous => new Set([...previous, row!.id]))}
        onReject={() => onRespond(row!.id, { reject: true })}
        onAnswer={(answers) => onRespond(row!.id, { answers })}
        onComplete={() => setCompleted((previous) => new Set([...previous, row!.id]))} />)}
    </>
  );
}

export function Question({ request, count = 1, open = true, onLater, onAnswer, onReject, onComplete }: {
  request: Request;
  count?: number;
  open?: boolean;
  onLater: () => void;
  onAnswer: (answers: string[][]) => Promise<void>;
  onReject: () => Promise<void>;
  onComplete: () => void;
}) {
  const [selected, setSelected] = useState<string[][]>(request.questions.map(() => []));
  const [custom, setCustom] = useState<string[]>(request.questions.map(() => ""));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const answers = questionAnswers(request.questions, selected, custom);
  const canAnswer = answers.length > 0 && answers.every((row) => row.length > 0);
  async function respond(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      await action();
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your answer was not sent. Please try again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return (
    <Dialog open={open} className="question-dialog" bodyClassName="question-body"
      title={request.worker ? 'Subagent question' : 'A quick question'}
      description={request.worker ? request.sessionTitle || 'A subagent needs your answer.'
        : count > 1 ? `${count} requests waiting · one at a time` : 'Your answer lets this chat continue.'}
      priority={request.worker ? 'worker' : 'decision'} busy={pending} closeLabel="Answer later"
      onClose={() => { if (!inFlight.current) onLater(); }}
      onSubmit={(e) => {
        e.preventDefault();
        if (canAnswer) void respond(() => onAnswer(answers));
      }} footer={<>
        {error && <p className="notice error" role="alert">{error}</p>}
        <Button variant="quiet" type="button" disabled={pending} onClick={onLater}>Later</Button>
        <Button variant="quiet" type="button" disabled={pending} onClick={() => void respond(onReject)}>Skip question</Button>
        <Button variant="primary" type="submit" disabled={pending || !canAnswer}>
          {pending ? <><LoaderCircle className="session-progress spin" size={15} />Sending…</>
            : <>Continue<ArrowUpRight size={15} /></>}
        </Button>
      </>}>
          {request.questions.map((q, i) => (
            <fieldset key={i} disabled={pending}>
              <legend>{q.question}</legend>
              <small>{q.multiple ? "Select all that apply." : "Choose one answer."}</small>
              {q.options.map((o) => (
                <label className="check question-option" key={o.label}>
                  <input type={q.multiple ? "checkbox" : "radio"} name={`${request.id}-${i}`}
                    checked={selected[i].includes(o.label)} onChange={(e) => {
                      const checked = e.target.checked;
                      setSelected((rows) => rows.map((row, index) => index !== i ? row
                        : q.multiple ? checked ? [...new Set([...row, o.label])]
                          : row.filter((x) => x !== o.label) : [o.label]));
                      if (!q.multiple) setCustom((rows) => rows.map((value, index) => index === i ? "" : value));
                    }} />
                  <span>{o.label}{o.description && <small>{o.description}</small>}</span>
                </label>
              ))}
              {q.custom !== false && (
                <input value={custom[i]} placeholder="Or write your answer"
                  aria-label={`Custom answer: ${q.question}`} onChange={(e) => {
                    const value = e.target.value;
                    setCustom((rows) => rows.map((text, index) => index === i ? value : text));
                    if (!q.multiple) setSelected((rows) => rows.map((row, index) => index === i ? [] : row));
                  }} />
              )}
            </fieldset>
          ))}
    </Dialog>
  );
}
